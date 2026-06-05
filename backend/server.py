from __future__ import annotations

import json
import logging
import os
import re
import secrets
import uuid
from collections import deque
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from http import HTTPStatus
from pathlib import Path
from time import time
from typing import Optional

from flask import Flask, g, jsonify, request
from flask_cors import CORS

from auth_lib import (
    hash_password, verify_password,
    new_token, hash_token, session_expiry, is_session_valid,
)
from db import connect, init_db, row_to_bar, row_to_position, row_to_user

app = Flask(__name__, static_folder="..", static_url_path="")

MAX_BODY_BYTES = 2 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

logger = logging.getLogger("bar-app")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

DEFAULT_ORIGIN = "https://kester7ka.github.io"
CORS_ORIGINS = os.environ.get("BAR_APP_CORS_ORIGINS", DEFAULT_ORIGIN).strip()

if CORS_ORIGINS == "*":
    logger.warning("CORS is open to all origins (*). Set BAR_APP_CORS_ORIGINS to your site origin.")
    CORS(app, resources={r"/api/*": {"origins": "*"}})
else:
    _origins = [o.strip().rstrip("/") for o in CORS_ORIGINS.split(",") if o.strip()]
    CORS(app, resources={r"/api/*": {"origins": _origins}})

TOB_RE = re.compile(r"^\d{6}$")
KEY_RE = re.compile(r"^\d{8}$")
USERNAME_RE = re.compile(r"^[A-Za-zА-Яа-яЁё0-9_.-]{3,32}$")
ALLOWED_CATEGORIES = {"ingredients", "syrups", "cookies", "other"}

MAX_USERNAME = 32
MAX_DISPLAY_NAME = 64
MAX_PASSWORD = 128
MAX_NAME = 120
MAX_NOTE = 200
MAX_POSITIONS_PER_BAR = 5000

_attempts: dict[str, deque] = {}
AUTH_RATE_LIMIT = 10
AUTH_RATE_WINDOW = 300

_dummy_hash_cache: Optional[str] = None

def _client_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return (request.remote_addr or "?").strip()

_LOG_SAFE_RE = re.compile(r"[\r\n\t\x00-\x1f\x7f]")

def _safe_log(value: str, limit: int = 64) -> str:
    return _LOG_SAFE_RE.sub("?", str(value))[:limit]

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

@app.after_request
def add_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=()")
    return resp

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
                (hash_token(token),),
            ).fetchone()
            if not session or not is_session_valid(session["expires_at"]):
                return jsonify({"error": "session expired"}), HTTPStatus.UNAUTHORIZED
            g.user_id = session["user_id"]
            g.bar_id = session["bar_id"]
            g.is_admin = bool(session["is_admin"])

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

@app.post("/api/auth/register")
def register():
    bucket = f"auth:{_client_ip()}"
    if not _rate_ok(bucket):
        return _err("Слишком много попыток. Подожди 5 минут.", HTTPStatus.TOO_MANY_REQUESTS)

    data = request.get_json(silent=True) or {}
    key = str(data.get("key", "")).strip()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    display_name = (data.get("display_name") or "").strip() or None

    accepted_policy = data.get("accepted_policy") is True

    if not KEY_RE.match(key):
        _rate_hit(bucket)
        return _err("Ключ должен состоять из 8 цифр")
    if not USERNAME_RE.match(username):
        _rate_hit(bucket)
        return _err("Никнейм: 3–32 символа, буквы/цифры/._-")
    if len(password) < 8 or len(password) > MAX_PASSWORD:
        _rate_hit(bucket)
        return _err(f"Пароль: от 8 до {MAX_PASSWORD} символов")
    if display_name and len(display_name) > MAX_DISPLAY_NAME:
        return _err(f"Имя не длиннее {MAX_DISPLAY_NAME} символов")
    if not accepted_policy:
        return _err("Нужно принять условия использования")

    try:
        with connect() as conn:

            if conn.execute("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", (username,)).fetchone():
                _rate_hit(bucket)
                return _err("Никнейм уже занят", HTTPStatus.CONFLICT)

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
    bucket = f"auth:{_client_ip()}"
    if not _rate_ok(bucket):
        return _err("Слишком много попыток. Подожди 5 минут.", HTTPStatus.TOO_MANY_REQUESTS)

    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

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

            if user:
                ok = verify_password(password, user["password_hash"])
            else:
                verify_password(password, _dummy_hash())
                ok = False

            if not ok:
                _rate_hit(bucket)
                logger.info("login failed username=%s ip=%s", _safe_log(username), _client_ip())
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
        conn.execute("DELETE FROM sessions WHERE token = ?", (hash_token(token),))
    return "", HTTPStatus.NO_CONTENT

@app.get("/api/auth/me")
@require_auth
def me():
    with connect() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (g.user_id,)).fetchone()
        bar = conn.execute("SELECT * FROM bars WHERE id = ?", (g.bar_id,)).fetchone()
    return jsonify({"user": row_to_user(user), "bar": row_to_bar(bar)})

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

@app.delete("/api/admin/keys/<key>")
@require_auth
@require_admin
def admin_delete_key(key):
    with connect() as conn:
        cur = conn.execute("DELETE FROM one_time_keys WHERE key = ?", (key,))
        if cur.rowcount == 0:
            return _err("Ключ не найден", HTTPStatus.NOT_FOUND)
    logger.info("admin %s deleted key %s", g.user_id, key)
    return ("", HTTPStatus.NO_CONTENT)

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


KB_OVERRIDES_PATH = Path(
    os.environ.get("BAR_APP_KB_PATH")
    or (Path(os.environ.get("BAR_APP_DB_PATH", "")).parent / "kb_overrides.json"
        if os.environ.get("BAR_APP_DB_PATH") else Path(__file__).parent / "kb_overrides.json")
)


def _load_kb_overrides() -> dict:
    if not KB_OVERRIDES_PATH.exists():
        return {"shelf": [], "tov": [], "updated_at": None, "uploaded_by": None}
    try:
        with open(KB_OVERRIDES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("shelf", [])
        data.setdefault("tov", [])
        data.setdefault("updated_at", None)
        data.setdefault("uploaded_by", None)
        return data
    except Exception:
        return {"shelf": [], "tov": [], "updated_at": None, "uploaded_by": None}


def _save_kb_overrides(data: dict) -> None:
    KB_OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(KB_OVERRIDES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.get("/api/kb")
@require_auth
def kb_get():
    return jsonify(_load_kb_overrides())


@app.post("/api/kb/upload")
@require_auth
@require_admin
def kb_upload():
    payload = request.get_json(silent=True) or {}
    incoming_shelf = payload.get("shelf") or []
    incoming_tov = payload.get("tov") or []
    if not isinstance(incoming_shelf, list) or not isinstance(incoming_tov, list):
        return _err("Неверный формат данных", HTTPStatus.BAD_REQUEST)

    existing = _load_kb_overrides()

    def merge(target: list, incoming: list) -> int:
        idx = {it.get("tov"): i for i, it in enumerate(target) if isinstance(it, dict) and it.get("tov")}
        added = 0
        updated = 0
        for it in incoming:
            if not isinstance(it, dict):
                continue
            tov = str(it.get("tov") or "").strip()[:32]
            if not tov:
                continue
            record = {
                "tov": tov,
                "name": (str(it.get("name") or "").strip()[:200]) or None,
                "group": (str(it.get("group") or "Прочее").strip()[:100]) or "Прочее",
            }
            life = it.get("life")
            if life is not None:
                record["life"] = str(life).strip()[:200] or None
            if tov in idx:
                target[idx[tov]] = record
                updated += 1
            else:
                target.append(record)
                idx[tov] = len(target) - 1
                added += 1
        return added + updated

    n_shelf = merge(existing["shelf"], incoming_shelf)
    n_tov = merge(existing["tov"], incoming_tov)
    existing["updated_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
    existing["uploaded_by"] = g.user_id
    _save_kb_overrides(existing)
    logger.info("kb upload by %s: shelf=%d tov=%d", g.user_id, n_shelf, n_tov)
    return jsonify({
        "ok": True,
        "shelf_changed": n_shelf,
        "tov_changed": n_tov,
        "total_shelf": len(existing["shelf"]),
        "total_tov": len(existing["tov"]),
        "updated_at": existing["updated_at"],
    })


@app.delete("/api/kb")
@require_auth
@require_admin
def kb_reset():
    if KB_OVERRIDES_PATH.exists():
        KB_OVERRIDES_PATH.unlink()
    return ("", HTTPStatus.NO_CONTENT)


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
        total = conn.execute(
            "SELECT COUNT(*) AS c FROM positions WHERE bar_id = ?", (g.bar_id,)
        ).fetchone()["c"]
        if total >= MAX_POSITIONS_PER_BAR:
            return _err("Достигнут лимит позиций для бара", HTTPStatus.CONFLICT)
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
                    expiry_closed, shelf_open_days, is_open, opened_at, honest_mark, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (pid, g.bar_id, payload["tob"], payload["name"], payload["category"],
                 payload["production_date"], payload["closed_shelf_days"],
                 payload["expiry_closed"], payload["shelf_open_days"],
                 payload["is_open"], opened_at, payload.get("honest_mark"), g.user_id),
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
                       shelf_open_days=?, is_open=?, opened_at=?, honest_mark=?
                   WHERE id = ? AND bar_id = ?""",
                (payload["tob"], payload["name"], payload["category"],
                 payload["production_date"], payload["closed_shelf_days"],
                 payload["expiry_closed"], payload["shelf_open_days"],
                 payload["is_open"], opened_at, payload.get("honest_mark"), pid, g.bar_id),
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


HONEST_MARK_URL = os.environ.get(
    "HONEST_MARK_URL",
    "https://mobile.api.crpt.ru/mobile/check",
)
HONEST_MARK_SOLD_STATUSES = {
    "RETIRED", "SOLD", "WITHDRAWN", "DECOMMISSIONED",
    "OUT_OF_CIRCULATION", "DISPOSED",
}


def _hz_is_sold(data):
    if not isinstance(data, dict):
        return False
    for key in ("status", "statusEx", "code_status", "circulation_status",
                "cisStatus", "documentStatus"):
        val = data.get(key)
        if isinstance(val, str) and val.upper() in HONEST_MARK_SOLD_STATUSES:
            return True
    for key in ("isWithdrawn", "isRetired", "isSold", "sold",
                "withdrawn", "retired"):
        if data.get(key) is True:
            return True
    for nested in ("cis", "cisInfo", "code_data", "data"):
        inner = data.get(nested)
        if isinstance(inner, dict) and _hz_is_sold(inner):
            return True
    return False


def _hzn_request(code, timeout=10):
    import json as _json
    import urllib.request as _urlreq
    req = _urlreq.Request(
        HONEST_MARK_URL,
        data=_json.dumps({"code": code}).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": "BarManager/0.6 (consumer-check)",
        },
        method="POST",
    )
    with _urlreq.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8", errors="replace")
    return _json.loads(body)


def _hzn_extract_info(data):
    result = {"name": None, "gtin": None, "production_date": None, "expiry_date": None}
    if not isinstance(data, dict):
        return result

    def dig(d, *keys):
        for k in keys:
            if isinstance(d, dict) and k in d and d[k] not in (None, ""):
                return d[k]
        return None

    candidates = [data]
    for nested in ("cis", "cisInfo", "code_data", "data", "product", "productInfo"):
        v = data.get(nested) if isinstance(data, dict) else None
        if isinstance(v, dict):
            candidates.append(v)

    for c in candidates:
        if not result["name"]:
            result["name"] = dig(c, "productName", "name", "title", "shortName")
        if not result["gtin"]:
            result["gtin"] = dig(c, "gtin", "GTIN", "productCode")
        if not result["production_date"]:
            result["production_date"] = dig(c, "productionDate", "producedDate", "prodDate")
        if not result["expiry_date"]:
            result["expiry_date"] = dig(c, "expirationDate", "expiryDate", "expireDate", "exp_date")
    return result


@app.get("/api/honest-mark/health")
@require_auth
def hzn_health():
    import json as _json
    import time as _time
    import urllib.error as _urlerr
    import urllib.request as _urlreq
    start = _time.monotonic()
    try:
        req = _urlreq.Request(
            HONEST_MARK_URL,
            data=_json.dumps({"code": "00000000000000"}).encode("utf-8"),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": "BarManager/0.6 (consumer-check)",
            },
            method="POST",
        )
        with _urlreq.urlopen(req, timeout=6) as r:
            r.read(512)
        return jsonify({
            "ok": True,
            "ms": int((_time.monotonic() - start) * 1000),
            "status": 200,
        })
    except _urlerr.HTTPError as e:
        return jsonify({
            "ok": True,
            "ms": int((_time.monotonic() - start) * 1000),
            "status": e.code,
            "note": "сервер отвечает",
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "ms": int((_time.monotonic() - start) * 1000),
            "error": f"{type(e).__name__}: {str(e)[:120]}",
            "url": HONEST_MARK_URL,
        })


@app.post("/api/honest-mark/info")
@require_auth
def hzn_info():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    if not code:
        return _err("Нужен код")
    if len(code) > 256:
        return _err("Слишком длинный код")
    try:
        raw = _hzn_request(code, timeout=10)
        info = _hzn_extract_info(raw)
        return jsonify({"ok": True, "info": info})
    except Exception as e:
        logger.warning("hzn info failed: %s", str(e)[:80])
        return jsonify({"ok": False, "error": "Не удалось получить информацию"})


HZN_MAX_CODES_PER_CHECK = 25


def _check_honest_marks(codes):
    if not codes:
        return []
    import time as _time
    sold = []
    for code in codes:
        try:
            data = _hzn_request(code, timeout=10)
            if _hz_is_sold(data):
                sold.append(code)
                logger.info("hzn SOLD: %s", _safe_log(code, 40))
        except Exception as e:
            logger.warning("hzn check failed (%s): %s", type(e).__name__, _safe_log(code, 40))
        _time.sleep(0.25)
    return sold


@app.post("/api/honest-mark/check")
@require_auth
def honest_mark_check():
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, honest_mark FROM positions "
            "WHERE bar_id = ? AND honest_mark IS NOT NULL AND honest_mark != '' "
            "ORDER BY expiry_closed ASC LIMIT ?",
            (g.bar_id, HZN_MAX_CODES_PER_CHECK),
        ).fetchall()

    if not rows:
        return jsonify({"checked": 0, "removed": 0, "ids": []})

    code_to_id = {r["honest_mark"]: r["id"] for r in rows}
    sold_codes = _check_honest_marks(list(code_to_id.keys()))
    sold_ids = [code_to_id[c] for c in sold_codes if c in code_to_id]

    if sold_ids:
        with connect() as conn:
            placeholders = ",".join("?" * len(sold_ids))
            conn.execute(
                f"DELETE FROM positions WHERE id IN ({placeholders}) AND bar_id = ?",
                (*sold_ids, g.bar_id),
            )
        logger.info("honest-mark removed %d positions for bar=%s", len(sold_ids), g.bar_id)

    return jsonify({"checked": len(rows), "removed": len(sold_ids), "ids": sold_ids})

@app.get("/api/schedule/xlsx")
def schedule_xlsx():
    import json as _json
    import urllib.parse
    import urllib.request
    from flask import Response

    public_key = "https://disk.360.yandex.ru/d/YPIq80g1M7G1SA"
    meta_url = (
        "https://cloud-api.yandex.net/v1/disk/public/resources/download"
        "?public_key=" + urllib.parse.quote(public_key)
    )
    try:
        with urllib.request.urlopen(meta_url, timeout=15) as r:
            href = _json.loads(r.read().decode("utf-8")).get("href")
        if not href:
            return _err("Не получили ссылку на файл", HTTPStatus.BAD_GATEWAY)
        with urllib.request.urlopen(href, timeout=30) as r:
            data = r.read()
        return Response(
            data,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Cache-Control": "public, max-age=900"},
        )
    except Exception:
        logger.exception("schedule xlsx proxy failed")
        return _err("Не удалось получить таблицу", HTTPStatus.BAD_GATEWAY)

@app.get("/api/bars")
@require_auth
def list_bars():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM bars ORDER BY code").fetchall()
    return jsonify([row_to_bar(r) for r in rows])

def _err(msg: str, code: int = HTTPStatus.BAD_REQUEST):
    return jsonify({"error": msg}), code

@app.errorhandler(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
def _too_large(_e):
    return jsonify({"error": "Слишком большой запрос"}), HTTPStatus.REQUEST_ENTITY_TOO_LARGE

def _create_session(conn, user_id: int) -> str:
    token = new_token()
    conn.execute(
        "DELETE FROM sessions WHERE expires_at < ?",
        (datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),),
    )
    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)",
        (hash_token(token), user_id, session_expiry(),
         request.headers.get("User-Agent", "")[:200]),
    )
    return token

def _validate(payload: dict):
    name = (payload.get("name") or "").strip()
    tob = (payload.get("tob") or "").strip()
    category = payload.get("category")
    expiry_closed = (payload.get("expiry_closed") or "").strip() or None
    shelf_open_days = payload.get("shelf_open_days")

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

    honest_mark = (payload.get("honest_mark") or "").strip() or None
    if honest_mark and len(honest_mark) > 256:
        honest_mark = honest_mark[:256]

    return {
        "name": name,
        "tob": tob,
        "category": category,
        "production_date": production_date,
        "closed_shelf_days": closed_shelf_days,
        "expiry_closed": expiry_closed,
        "shelf_open_days": shelf_open_days,
        "honest_mark": honest_mark,
        "is_open": 1 if is_open else 0,
    }, None

def _max_open_for(category: str) -> float:
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
    return _open_sibling_count(conn, bar_id, name, category, exclude_id) \
        < _max_open_for(category)

@app.get("/api/health")
def health():
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

    try:
        return app.send_static_file("index.html")
    except Exception:
        return jsonify({"app": "Bar Manager API", "health": "/api/health"})

def _bootstrap() -> None:
    init_db()

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

_bootstrap()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("BAR_APP_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=port, debug=debug)
