"""REST-сервер Bar Manager.

Запуск:
    pip install -r requirements.txt
    python server.py           # БД и список баров создаются автоматически

Все эндпоинты, кроме /api/auth/* и /api/health, требуют Authorization: Bearer <token>.
Каждый запрос работает только с позициями бара, к которому привязан пользователь.
Генерация одноразовых ключей регистрации — отдельный инструмент (вне репозитория).
"""
from __future__ import annotations

import logging
import os
import re
import secrets
import uuid
from collections import deque
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from http import HTTPStatus
from time import time
from typing import Optional

from flask import Flask, g, jsonify, request
from flask_cors import CORS

from auth_lib import (
    hash_password, verify_password,
    new_token, session_expiry, is_session_valid,
)
from db import connect, init_db, row_to_bar, row_to_position, row_to_user

app = Flask(__name__, static_folder="..", static_url_path="")

logger = logging.getLogger("bar-app")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ----- Конфиг из окружения -----
# CORS: '*' для локалки. В продакшене перечислить домены через запятую.
CORS_ORIGINS = os.environ.get("BAR_APP_CORS_ORIGINS", "*").strip()

# flask-cors сам обрабатывает preflight (OPTIONS) и проставляет заголовки.
# Это надёжнее ручной логики — поддерживает credentials, списки origin'ов и т.д.
if CORS_ORIGINS == "*":
    CORS(app, resources={r"/api/*": {"origins": "*"}})
else:
    _origins = [o.strip().rstrip("/") for o in CORS_ORIGINS.split(",") if o.strip()]
    CORS(app, resources={r"/api/*": {"origins": _origins}})

TOB_RE = re.compile(r"^\d{6}$")
KEY_RE = re.compile(r"^\d{8}$")
USERNAME_RE = re.compile(r"^[A-Za-zА-Яа-яЁё0-9_.-]{3,32}$")
ALLOWED_CATEGORIES = {"ingredients", "syrups", "cookies", "other"}

# ----- Лимиты длин (защита от DoS через гигантские строки) -----
MAX_USERNAME = 32
MAX_DISPLAY_NAME = 64
MAX_PASSWORD = 128
MAX_NAME = 120
MAX_NOTE = 200

# ----- Rate-limit для авторизации -----
# Простой in-memory store. На один Flask-процесс хватает; для нескольких
# воркеров нужен Redis, но это уже задача деплоя.
_attempts: dict[str, deque] = {}
AUTH_RATE_LIMIT = 10        # попыток в окне
AUTH_RATE_WINDOW = 300      # 5 минут

# «Болванка» для timing-safe сравнения, чтобы по времени ответа нельзя
# было понять, существует ли никнейм. Считается лениво при первом обращении.
_dummy_hash_cache: Optional[str] = None


def _client_ip() -> str:
    return (request.headers.get("X-Forwarded-For", "") or request.remote_addr or "?").split(",")[0].strip()


def _rate_ok(bucket: str) -> bool:
    now = time()
    dq = _attempts.setdefault(bucket, deque())
    while dq and now - dq[0] > AUTH_RATE_WINDOW:
        dq.popleft()
    return len(dq) < AUTH_RATE_LIMIT


def _rate_hit(bucket: str) -> None:
    _attempts.setdefault(bucket, deque()).append(time())


def _dummy_hash() -> str:
    global _dummy_hash_cache
    if _dummy_hash_cache is None:
        _dummy_hash_cache = hash_password("__timing_safe_placeholder__")
    return _dummy_hash_cache


# ----------------- Security headers -----------------
# CORS обрабатывает flask-cors (см. выше). Здесь — только security-заголовки.

@app.after_request
def add_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=()")
    return resp


# ----------------- Auth middleware -----------------

def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = _extract_token()
        if not token:
            return jsonify({"error": "auth required"}), HTTPStatus.UNAUTHORIZED
        with connect() as conn:
            session = conn.execute(
                "SELECT s.token, s.user_id, s.expires_at, u.bar_id, u.is_admin "
                "FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token = ?",
                (token,),
            ).fetchone()
            if not session or not is_session_valid(session["expires_at"]):
                return jsonify({"error": "session expired"}), HTTPStatus.UNAUTHORIZED
            g.user_id = session["user_id"]
            g.bar_id = session["bar_id"]
            g.is_admin = bool(session["is_admin"])
            # Админ может смотреть любой бар: переопределение через X-Bar-Id.
            if g.is_admin:
                override = request.headers.get("X-Bar-Id", "")
                if override.isdigit():
                    g.bar_id = int(override)
        return fn(*args, **kwargs)
    return wrapper


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not getattr(g, "is_admin", False):
            return _err("Доступно только администратору", HTTPStatus.FORBIDDEN)
        return fn(*args, **kwargs)
    return wrapper


def _extract_token() -> Optional[str]:
    h = request.headers.get("Authorization", "")
    if h.startswith("Bearer "):
        return h[7:].strip()
    return None


# ----------------- Auth endpoints -----------------

@app.post("/api/auth/register")
def register():
    """Регистрация по одноразовому ключу.
    body: { key, username, password, display_name?, accepted_policy: true }
    """
    bucket = f"auth:{_client_ip()}"
    if not _rate_ok(bucket):
        return _err("Слишком много попыток. Подожди 5 минут.", HTTPStatus.TOO_MANY_REQUESTS)

    data = request.get_json(silent=True) or {}
    key = str(data.get("key", "")).strip()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    display_name = (data.get("display_name") or "").strip() or None
    # СТРОГИЙ check: только Python True (bool из JSON). Строка "false" сюда не попадёт.
    accepted_policy = data.get("accepted_policy") is True

    if not KEY_RE.match(key):
        _rate_hit(bucket)
        return _err("Ключ должен состоять из 8 цифр")
    if not USERNAME_RE.match(username):
        _rate_hit(bucket)
        return _err("Никнейм: 3–32 символа, буквы/цифры/._-")
    if len(password) < 6 or len(password) > MAX_PASSWORD:
        _rate_hit(bucket)
        return _err(f"Пароль: от 6 до {MAX_PASSWORD} символов")
    if display_name and len(display_name) > MAX_DISPLAY_NAME:
        return _err(f"Имя не длиннее {MAX_DISPLAY_NAME} символов")
    if not accepted_policy:
        return _err("Нужно принять условия использования")

    try:
        with connect() as conn:
            # Никнейм свободен?
            if conn.execute("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", (username,)).fetchone():
                _rate_hit(bucket)
                return _err("Никнейм уже занят", HTTPStatus.CONFLICT)

            # Ключ валиден и не использован?
            key_row = conn.execute(
                "SELECT id, bar_id, used_at FROM one_time_keys WHERE key = ?",
                (key,),
            ).fetchone()
            if not key_row:
                _rate_hit(bucket)
                return _err("Ключ не найден", HTTPStatus.NOT_FOUND)
            if key_row["used_at"]:
                _rate_hit(bucket)
                return _err("Этот ключ уже использован", HTTPStatus.GONE)

            # Создаём пользователя.
            cur = conn.execute(
                """INSERT INTO users (bar_id, username, password_hash, display_name, accepted_policy_at)
                   VALUES (?, ?, ?, ?, datetime('now'))""",
                (key_row["bar_id"], username, hash_password(password), display_name),
            )
            user_id = cur.lastrowid

            conn.execute(
                "UPDATE one_time_keys SET used_at = datetime('now'), used_by_user_id = ? WHERE id = ?",
                (user_id, key_row["id"]),
            )

            token = _create_session(conn, user_id)
            bar = conn.execute("SELECT * FROM bars WHERE id = ?", (key_row["bar_id"],)).fetchone()
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    except Exception:
        logger.exception("register failed")
        return _err("Не удалось зарегистрировать", HTTPStatus.INTERNAL_SERVER_ERROR)

    logger.info("registered user_id=%s bar_id=%s ip=%s", user_id, key_row["bar_id"], _client_ip())
    return jsonify({"token": token, "user": row_to_user(user), "bar": row_to_bar(bar)}), HTTPStatus.CREATED


@app.post("/api/auth/login")
def login():
    """body: { username, password }"""
    bucket = f"auth:{_client_ip()}"
    if not _rate_ok(bucket):
        return _err("Слишком много попыток. Подожди 5 минут.", HTTPStatus.TOO_MANY_REQUESTS)

    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    # Лимиты длин: без них можно прислать гигантскую строку и заDOSить хеш.
    if not username or not password:
        _rate_hit(bucket)
        return _err("Никнейм и пароль обязательны")
    if len(username) > MAX_USERNAME or len(password) > MAX_PASSWORD:
        _rate_hit(bucket)
        return _err("Неверный никнейм или пароль", HTTPStatus.UNAUTHORIZED)

    try:
        with connect() as conn:
            user = conn.execute(
                "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()
            # Timing-safe: всегда прогоняем pbkdf2, даже если пользователя нет.
            # Иначе по времени ответа можно понять, существует ли ник.
            if user:
                ok = verify_password(password, user["password_hash"])
            else:
                verify_password(password, _dummy_hash())
                ok = False

            if not ok:
                _rate_hit(bucket)
                logger.info("login failed username=%s ip=%s", username, _client_ip())
                return _err("Неверный никнейм или пароль", HTTPStatus.UNAUTHORIZED)

            token = _create_session(conn, user["id"])
            bar = conn.execute("SELECT * FROM bars WHERE id = ?", (user["bar_id"],)).fetchone()
    except Exception:
        logger.exception("login failed")
        return _err("Не удалось войти", HTTPStatus.INTERNAL_SERVER_ERROR)

    return jsonify({"token": token, "user": row_to_user(user), "bar": row_to_bar(bar)})


@app.post("/api/auth/logout")
@require_auth
def logout():
    token = _extract_token()
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return "", HTTPStatus.NO_CONTENT


@app.get("/api/auth/me")
@require_auth
def me():
    with connect() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (g.user_id,)).fetchone()
        bar = conn.execute("SELECT * FROM bars WHERE id = ?", (g.bar_id,)).fetchone()
    return jsonify({"user": row_to_user(user), "bar": row_to_bar(bar)})


# ----------------- Admin: генерация ключей -----------------

def _gen_unique_key(conn) -> str:
    for _ in range(50):
        k = "".join(str(secrets.randbelow(10)) for _ in range(8))
        if not conn.execute("SELECT 1 FROM one_time_keys WHERE key = ?", (k,)).fetchone():
            return k
    raise RuntimeError("cannot generate unique key")


@app.post("/api/admin/keys")
@require_auth
@require_admin
def admin_create_keys():
    data = request.get_json(silent=True) or {}
    try:
        bar_id = int(data.get("bar_id"))
        count = int(data.get("count", 1))
    except (TypeError, ValueError):
        return _err("Неверные параметры")
    note = (data.get("note") or "").strip()[:MAX_NOTE] or None
    if count < 1 or count > 50:
        return _err("Количество ключей: от 1 до 50")

    with connect() as conn:
        bar = conn.execute("SELECT id, code, name FROM bars WHERE id = ?", (bar_id,)).fetchone()
        if not bar:
            return _err("Бар не найден", HTTPStatus.NOT_FOUND)
        keys = []
        for _ in range(count):
            k = _gen_unique_key(conn)
            conn.execute(
                "INSERT INTO one_time_keys (key, bar_id, note) VALUES (?, ?, ?)",
                (k, bar_id, note),
            )
            keys.append(k)
    logger.info("admin %s generated %d keys for bar %s", g.user_id, count, bar["code"])
    return jsonify({"keys": keys, "bar": {"id": bar["id"], "code": bar["code"], "name": bar["name"]}})


@app.get("/api/admin/keys")
@require_auth
@require_admin
def admin_list_keys():
    bar_id = request.args.get("bar_id", "")
    sql = ("SELECT k.key, k.created_at, k.used_at, k.note, b.code AS bar_code "
           "FROM one_time_keys k JOIN bars b ON b.id = k.bar_id")
    args: list = []
    if bar_id.isdigit():
        sql += " WHERE k.bar_id = ?"
        args.append(int(bar_id))
    sql += " ORDER BY (k.used_at IS NULL) DESC, k.created_at DESC LIMIT 200"
    with connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    return jsonify([
        {
            "key": r["key"],
            "bar_code": r["bar_code"],
            "note": r["note"],
            "used": bool(r["used_at"]),
            "used_at": r["used_at"],
            "created_at": r["created_at"],
        }
        for r in rows
    ])


# ----------------- Positions (scoped by bar) -----------------

@app.get("/api/positions")
@require_auth
def list_positions():
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM positions WHERE bar_id = ? ORDER BY expiry_closed ASC",
            (g.bar_id,),
        ).fetchall()
    return jsonify([row_to_position(r) for r in rows])


@app.post("/api/positions")
@require_auth
def create_position():
    payload, err = _validate(request.get_json(silent=True) or {})
    if err:
        return _err(err)

    pid = str(uuid.uuid4())
    opened_at = date.today().isoformat() if payload["is_open"] else None

    with connect() as conn:
        if payload["is_open"]:
            limit = _max_open_for(payload["category"])
            if limit == 0:
                return _err("Эту категорию нельзя пометить как открытую", HTTPStatus.CONFLICT)
            if not _can_open_more(conn, g.bar_id, payload["name"], payload["category"]):
                return _err(f"Уже открыто максимум ({limit}) — закрой предыдущую", HTTPStatus.CONFLICT)
        try:
            conn.execute(
                """INSERT INTO positions
                   (id, bar_id, tob, name, category, production_date, closed_shelf_days,
                    expiry_closed, shelf_open_days, is_open, opened_at, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (pid, g.bar_id, payload["tob"], payload["name"], payload["category"],
                 payload["production_date"], payload["closed_shelf_days"],
                 payload["expiry_closed"], payload["shelf_open_days"],
                 payload["is_open"], opened_at, g.user_id),
            )
        except Exception:
            logger.exception("create_position failed user=%s", g.user_id)
            return _err("Не удалось сохранить позицию", HTTPStatus.CONFLICT)
        row = conn.execute("SELECT * FROM positions WHERE id = ?", (pid,)).fetchone()
    return jsonify(row_to_position(row)), HTTPStatus.CREATED


@app.put("/api/positions/<pid>")
@require_auth
def update_position(pid):
    payload, err = _validate(request.get_json(silent=True) or {})
    if err:
        return _err(err)
    with connect() as conn:
        cur = conn.execute(
            "SELECT * FROM positions WHERE id = ? AND bar_id = ?", (pid, g.bar_id)
        ).fetchone()
        if not cur:
            return _err("Позиция не найдена", HTTPStatus.NOT_FOUND)
        opened_at = cur["opened_at"] if cur["is_open"] else None
        if payload["is_open"] and not cur["is_open"]:
            opened_at = date.today().isoformat()
        elif not payload["is_open"]:
            opened_at = None
        try:
            conn.execute(
                """UPDATE positions SET
                       tob=?, name=?, category=?,
                       production_date=?, closed_shelf_days=?, expiry_closed=?,
                       shelf_open_days=?, is_open=?, opened_at=?
                   WHERE id = ? AND bar_id = ?""",
                (payload["tob"], payload["name"], payload["category"],
                 payload["production_date"], payload["closed_shelf_days"],
                 payload["expiry_closed"], payload["shelf_open_days"],
                 payload["is_open"], opened_at, pid, g.bar_id),
            )
        except Exception:
            logger.exception("update_position failed user=%s pid=%s", g.user_id, pid)
            return _err("Не удалось обновить позицию", HTTPStatus.CONFLICT)
        row = conn.execute(
            "SELECT * FROM positions WHERE id = ? AND bar_id = ?",
            (pid, g.bar_id),
        ).fetchone()
    return jsonify(row_to_position(row))


@app.post("/api/positions/<pid>/open")
@require_auth
def open_position(pid):
    """Открыть позицию. Тело необязательное:
        { opened_at: ISO datetime, shelf_open_days?: int }
    Если opened_at не задан — берём текущую дату.
    Если shelf_open_days задан — обновляем у позиции (полезно при первом вскрытии).
    """
    data = request.get_json(silent=True) or {}
    opened_at = (data.get("opened_at") or "").strip() or None
    shelf_open_days_raw = data.get("shelf_open_days")
    shelf_open_days: int | None = None
    if shelf_open_days_raw not in (None, ""):
        try:
            shelf_open_days = int(shelf_open_days_raw)
            if shelf_open_days < 1:
                return _err("Срок после вскрытия должен быть положительным")
        except (TypeError, ValueError):
            return _err("shelf_open_days должно быть числом")

    with connect() as conn:
        cur = conn.execute(
            "SELECT * FROM positions WHERE id = ? AND bar_id = ?", (pid, g.bar_id)
        ).fetchone()
        if not cur:
            return _err("Позиция не найдена", HTTPStatus.NOT_FOUND)
        limit = _max_open_for(cur["category"])
        if limit == 0:
            return _err("Эту категорию нельзя пометить как открытую", HTTPStatus.CONFLICT)
        if not _can_open_more(conn, g.bar_id, cur["name"], cur["category"], exclude_id=pid):
            return _err(f"Уже открыто максимум ({limit}) — закрой предыдущую", HTTPStatus.CONFLICT)

        if not opened_at:
            opened_at = date.today().isoformat()

        if shelf_open_days is not None:
            conn.execute(
                "UPDATE positions SET is_open = 1, opened_at = ?, shelf_open_days = ? "
                "WHERE id = ? AND bar_id = ?",
                (opened_at, shelf_open_days, pid, g.bar_id),
            )
        else:
            conn.execute(
                "UPDATE positions SET is_open = 1, opened_at = ? WHERE id = ? AND bar_id = ?",
                (opened_at, pid, g.bar_id),
            )
        row = conn.execute(
            "SELECT * FROM positions WHERE id = ? AND bar_id = ?",
            (pid, g.bar_id),
        ).fetchone()
    return jsonify(row_to_position(row))


@app.post("/api/positions/<pid>/close")
@require_auth
def close_position(pid):
    with connect() as conn:
        conn.execute(
            "UPDATE positions SET is_open = 0, opened_at = NULL WHERE id = ? AND bar_id = ?",
            (pid, g.bar_id),
        )
        # Финальный SELECT ТОЖЕ фильтруется по bar_id — иначе через
        # угаданный/перехваченный чужой pid можно было бы вытащить позицию
        # другого бара (UPDATE её не тронет, но SELECT вернул бы данные).
        row = conn.execute(
            "SELECT * FROM positions WHERE id = ? AND bar_id = ?",
            (pid, g.bar_id),
        ).fetchone()
    if not row:
        return _err("Позиция не найдена", HTTPStatus.NOT_FOUND)
    return jsonify(row_to_position(row))


@app.delete("/api/positions/<pid>")
@require_auth
def delete_position(pid):
    with connect() as conn:
        conn.execute("DELETE FROM positions WHERE id = ? AND bar_id = ?", (pid, g.bar_id))
    return "", HTTPStatus.NO_CONTENT


# ----------------- Bars (read only) -----------------

@app.get("/api/bars")
def list_bars():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM bars ORDER BY code").fetchall()
    return jsonify([row_to_bar(r) for r in rows])


# ----------------- helpers -----------------

def _err(msg: str, code: int = HTTPStatus.BAD_REQUEST):
    return jsonify({"error": msg}), code


def _create_session(conn, user_id: int) -> str:
    token = new_token()
    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)",
        (token, user_id, session_expiry(), request.headers.get("User-Agent", "")[:200]),
    )
    return token


def _validate(payload: dict):
    name = (payload.get("name") or "").strip()
    tob = (payload.get("tob") or "").strip()
    category = payload.get("category")
    expiry_closed = (payload.get("expiry_closed") or "").strip() or None
    shelf_open_days = payload.get("shelf_open_days")
    # Строгий boolean — иначе строка "false" приведётся к True.
    is_open = payload.get("is_open") is True

    production_date = (payload.get("production_date") or "").strip() or None
    closed_shelf_days_raw = payload.get("closed_shelf_days")
    closed_shelf_days = None
    if closed_shelf_days_raw not in (None, ""):
        try:
            closed_shelf_days = int(closed_shelf_days_raw)
            if closed_shelf_days < 1:
                return None, "Срок годности (дней) должен быть положительным"
        except (TypeError, ValueError):
            return None, "closed_shelf_days должно быть числом"

    if not name:
        return None, "Название обязательно"
    if len(name) > MAX_NAME:
        return None, f"Название не длиннее {MAX_NAME} символов"
    if not TOB_RE.match(tob):
        return None, "TOB — ровно 6 цифр"
    if category not in ALLOWED_CATEGORIES:
        return None, "Неизвестная категория"

    # Если есть дата производства и срок в днях — считаем expiry_closed сами.
    if production_date and closed_shelf_days:
        try:
            base = datetime.fromisoformat(production_date)
        except ValueError:
            return None, "Неверная дата производства"
        exp = base + timedelta(days=closed_shelf_days)
        expiry_closed = exp.isoformat(timespec="minutes")
    if not expiry_closed:
        return None, "Срок годности обязателен"

    if shelf_open_days is not None and str(shelf_open_days) != "":
        try:
            shelf_open_days = int(shelf_open_days)
        except (TypeError, ValueError):
            return None, "shelf_open_days должно быть числом"
    else:
        shelf_open_days = None

    return {
        "name": name,
        "tob": tob,
        "category": category,
        "production_date": production_date,
        "closed_shelf_days": closed_shelf_days,
        "expiry_closed": expiry_closed,
        "shelf_open_days": shelf_open_days,
        "is_open": 1 if is_open else 0,
    }, None


def _max_open_for(category: str) -> float:
    """Сколько открытых позиций одного товара разрешено в баре.
        syrups       → 2 (вторую можно открыть с предупреждением на фронте)
        cookies      → 0 (печенье вообще не «открывают»)
        ingredients,
        other        → без ограничений
    """
    if category == "syrups":
        return 2
    if category == "cookies":
        return 0
    return float("inf")


def _open_sibling_count(conn, bar_id: int, name: str, category: str,
                         exclude_id: Optional[str] = None) -> int:
    sql = ("SELECT COUNT(*) AS c FROM positions WHERE bar_id = ? "
           "AND lower(name) = lower(?) AND category = ? AND is_open = 1")
    args: list = [bar_id, name, category]
    if exclude_id:
        sql += " AND id <> ?"
        args.append(exclude_id)
    return conn.execute(sql, args).fetchone()["c"]


def _can_open_more(conn, bar_id: int, name: str, category: str,
                    exclude_id: Optional[str] = None) -> bool:
    """True, если ещё одну открытую позицию можно добавить."""
    return _open_sibling_count(conn, bar_id, name, category, exclude_id) \
        < _max_open_for(category)


# ----------------- root -----------------

@app.get("/api/health")
def health():
    """Лёгкий пинг для индикатора статуса в Инструментах.
    Не требует авторизации. Поля:
        server — всегда True если ответ дошёл
        db     — True, если SELECT 1 отработал
        api    — True, если сервер вообще откликается (по сути == server)
    """
    db_ok = False
    try:
        with connect() as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception:
        pass
    return jsonify({
        "server": True,
        "db": db_ok,
        "api": True,
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


@app.route("/")
def index():
    # На облачном деплое фронт может жить отдельно (GitHub Pages), тогда
    # index.html рядом нет — отдаём короткий JSON, чтобы '/' не падал.
    try:
        return app.send_static_file("index.html")
    except Exception:
        return jsonify({"app": "Bar Manager API", "health": "/api/health"})


def _bootstrap() -> None:
    """Готовит БД к работе. Вызывается и при `python server.py`,
    и при импорте gunicorn'ом (`gunicorn server:app`)."""
    init_db()
    # Авто-сид баров, если таблица пуста — удобно для облака,
    # где не получится вручную дёрнуть seed_bars.py.
    try:
        with connect() as conn:
            empty = conn.execute("SELECT COUNT(*) AS c FROM bars").fetchone()["c"] == 0
        if empty:
            from seed_bars import FALLBACK
            with connect() as conn:
                for b in FALLBACK:
                    conn.execute(
                        "INSERT OR IGNORE INTO bars (code, short_code, name, address) "
                        "VALUES (?, ?, ?, ?)",
                        (b["code"], b["short_code"], b["name"], b["address"]),
                    )
            logger.info("auto-seeded %d bars", len(FALLBACK))
    except Exception:
        logger.exception("bootstrap seed failed")

    # Создаём админа из переменных окружения, если задан и ещё не существует.
    admin_user = (os.environ.get("BAR_APP_ADMIN_USER") or "").strip()
    admin_pass = os.environ.get("BAR_APP_ADMIN_PASSWORD") or ""
    if admin_user and admin_pass:
        try:
            with connect() as conn:
                exists = conn.execute(
                    "SELECT id, is_admin FROM users WHERE username = ? COLLATE NOCASE",
                    (admin_user,),
                ).fetchone()
                if exists:
                    # Уже есть — на всякий случай поднимаем флаг админа.
                    if not exists["is_admin"]:
                        conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (exists["id"],))
                        logger.info("promoted existing user to admin: %s", admin_user)
                else:
                    bar = conn.execute("SELECT id FROM bars ORDER BY id LIMIT 1").fetchone()
                    if bar:
                        conn.execute(
                            "INSERT INTO users (bar_id, username, password_hash, display_name, "
                            "accepted_policy_at, is_admin) VALUES (?, ?, ?, ?, datetime('now'), 1)",
                            (bar["id"], admin_user, hash_password(admin_pass), "Администратор"),
                        )
                        logger.info("admin user created: %s", admin_user)
        except Exception:
            logger.exception("admin bootstrap failed")


# Выполняется при импорте модуля (в т.ч. gunicorn'ом).
_bootstrap()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("BAR_APP_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=port, debug=debug)
