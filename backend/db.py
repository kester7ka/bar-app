from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DB_PATH = Path(os.environ.get("BAR_APP_DB_PATH") or (Path(__file__).parent / "bar.db"))
SCHEMA_PATH = Path(__file__).parent / "schema.sql"

def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        _migrate(conn)

def _migrate(conn) -> None:

    conn.execute("DROP INDEX IF EXISTS idx_positions_one_open")

    conn.execute(
        "UPDATE positions SET is_open = 0, opened_at = NULL "
        "WHERE category = 'cookies' AND is_open = 1"
    )

    cols = {r[1] for r in conn.execute("PRAGMA table_info(positions)")}
    if "production_date" not in cols:
        conn.execute("ALTER TABLE positions ADD COLUMN production_date TEXT")
    if "closed_shelf_days" not in cols:
        conn.execute("ALTER TABLE positions ADD COLUMN closed_shelf_days INTEGER")

    ucols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
    if "is_admin" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")

    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'"
    ).fetchone()
    if not row or not row["sql"]:
        return
    sql_upper = " ".join(row["sql"].split()).upper()
    if "UNIQUE (BAR_ID, TOB)" in sql_upper or "UNIQUE(BAR_ID, TOB)" in sql_upper:
        conn.executescript(
            """
            BEGIN;
            CREATE TABLE positions_new (
                id              TEXT    PRIMARY KEY,
                bar_id          INTEGER NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
                tob             TEXT    NOT NULL,
                name            TEXT    NOT NULL,
                category        TEXT    NOT NULL REFERENCES categories(code),
                expiry_closed   TEXT    NOT NULL,
                shelf_open_days INTEGER,
                is_open         INTEGER NOT NULL DEFAULT 0,
                opened_at       TEXT,
                created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
                CHECK (length(tob) = 6),
                CHECK (tob GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'),
                CHECK (is_open IN (0, 1))
            );
            INSERT INTO positions_new
                (id, bar_id, tob, name, category, expiry_closed, shelf_open_days,
                 is_open, opened_at, created_by, created_at, updated_at)
            SELECT id, bar_id, tob, name, category, expiry_closed, shelf_open_days,
                   is_open, opened_at, created_by, created_at, updated_at
              FROM positions;
            DROP TABLE positions;
            ALTER TABLE positions_new RENAME TO positions;
            CREATE INDEX IF NOT EXISTS idx_positions_open_siblings
                ON positions (bar_id, lower(name), category, is_open);
            CREATE INDEX IF NOT EXISTS idx_positions_bar_expiry
                ON positions (bar_id, expiry_closed);
            CREATE INDEX IF NOT EXISTS idx_positions_bar_category
                ON positions (bar_id, category);
            COMMIT;
            """
        )

@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def row_to_position(row: sqlite3.Row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "tob": row["tob"],
        "name": row["name"],
        "category": row["category"],
        "production_date": row["production_date"] if "production_date" in keys else None,
        "closed_shelf_days": row["closed_shelf_days"] if "closed_shelf_days" in keys else None,
        "expiry_closed": row["expiry_closed"],
        "shelf_open_days": row["shelf_open_days"],
        "is_open": bool(row["is_open"]),
        "opened_at": row["opened_at"],
        "created_at": row["created_at"],
    }

def row_to_bar(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "short_code": row["short_code"],
        "name": row["name"],
        "address": row["address"],
    }

def row_to_user(row: sqlite3.Row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "bar_id": row["bar_id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "is_admin": bool(row["is_admin"]) if "is_admin" in keys else False,
        "created_at": row["created_at"],
    }
