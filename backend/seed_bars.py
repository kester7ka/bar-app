"""Засыпает в БД список баров.

Берёт коды из таблицы графика на Яндекс.Диске (если доступен интернет)
либо использует встроенный fallback-список, собранный из последней версии файла.

Запуск:
    python seed_bars.py
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from typing import Optional

from db import connect, init_db

PUBLIC_KEY = "https://disk.360.yandex.ru/d/YPIq80g1M7G1SA"
API = "https://cloud-api.yandex.net/v1/disk/public/resources"

# Известные на момент написания бары. Используются, если интернета нет.
FALLBACK = [
    {"code": "АВПМ-97",  "short_code": "ПМ97",  "name": "АВПМ-97 Алексеевская", "address": ""},
    {"code": "АВЯР-01",  "short_code": "ЯР01",  "name": "АВЯР-01",              "address": ""},
    {"code": "АВКШ78",   "short_code": "КШ78",  "name": "АВКШ-78",              "address": ""},
    {"code": "АВКОСМ04", "short_code": "КОСМ04","name": "АВКОСМ-04",            "address": ""},
    {"code": "АВКО04",   "short_code": "КО04",  "name": "АВКО-04",              "address": ""},
    {"code": "АВПМ-58",  "short_code": "ПМ58",  "name": "АВПМ-58",              "address": ""},
    {"code": "АВДШ-02",  "short_code": "ДШ02",  "name": "АВДШ-02",              "address": ""},
    {"code": "АВЛБ96",   "short_code": "ЛБ96",  "name": "АВЛБ-96",              "address": ""},
    {"code": "АВОШ59",   "short_code": "ОШ59",  "name": "АВОШ-59",              "address": ""},
    {"code": "АВПФ-64",  "short_code": "ПФ64",  "name": "АВПФ-64",              "address": ""},
    {"code": "АВНП",     "short_code": "НП",    "name": "АВНП",                 "address": ""},
    {"code": "АВЗ514",   "short_code": "З514",  "name": "АВ-з514 (круглосуточно)", "address": ""},
]


def fetch_bars_from_disk() -> Optional[list[dict]]:
    """Скачивает xlsx и достаёт уникальные шапки баров.
    Если openpyxl нет — возвращает None и используется fallback.
    """
    try:
        import openpyxl  # type: ignore
    except ImportError:
        return None

    try:
        # Получаем download href.
        url = f"{API}/download?public_key={urllib.parse.quote(PUBLIC_KEY)}"
        with urllib.request.urlopen(url, timeout=10) as r:
            href = json.loads(r.read())["href"]
        # Скачиваем файл.
        import tempfile
        with urllib.request.urlopen(href, timeout=30) as r, tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            f.write(r.read())
            path = f.name
    except Exception as e:
        print(f"⚠️  Не получилось скачать таблицу: {e}", file=sys.stderr)
        return None

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    bar_pat = re.compile(r"^АВ.+")
    month_pat = re.compile(r"^(ЯНВАРЬ|ФЕВРАЛЬ|МАРТ|АПРЕЛЬ|МАЙ|ИЮНЬ|ИЮЛЬ|АВГУСТ|СЕНТЯБРЬ|ОКТЯБРЬ|НОЯБРЬ|ДЕКАБРЬ)\b", re.I)

    found: dict[str, dict] = {}
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            for cell in row:
                if not isinstance(cell, str):
                    continue
                s = cell.strip()
                if not s or not bar_pat.match(s) or month_pat.match(s) or s.upper() == "АВАНС":
                    continue
                code = re.sub(r"\(.*?\)", "", s).strip()
                code = re.sub(r"\s+", " ", code)
                key = re.sub(r"[^А-ЯA-Z0-9]", "", code.upper())
                if key in found:
                    continue
                short = re.sub(r"^АВ", "", key)
                found[key] = {"code": code, "short_code": short, "name": code, "address": ""}
    return list(found.values())


def main() -> None:
    init_db()
    bars = fetch_bars_from_disk() or FALLBACK
    print(f"Заливаем {len(bars)} баров…")
    with connect() as conn:
        for b in bars:
            conn.execute(
                """INSERT INTO bars (code, short_code, name, address)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(code) DO UPDATE SET
                       short_code = excluded.short_code,
                       name = excluded.name""",
                (b["code"], b["short_code"], b["name"], b["address"]),
            )
    print("Готово. Список:")
    with connect() as conn:
        for row in conn.execute("SELECT code, name FROM bars ORDER BY code"):
            print(f"  {row['code']:14} — {row['name']}")


if __name__ == "__main__":
    main()
