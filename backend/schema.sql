PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bars (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    short_code  TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    address     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bars_short_code ON bars(short_code);

CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    bar_id              INTEGER NOT NULL REFERENCES bars(id) ON DELETE RESTRICT,
    username            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash       TEXT    NOT NULL,
    display_name        TEXT,
    accepted_policy_at  TEXT    NOT NULL,
    is_admin            INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_bar ON users(bar_id);

CREATE TABLE IF NOT EXISTS one_time_keys (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    key              TEXT    NOT NULL UNIQUE,
    bar_id           INTEGER NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
    used_at          TEXT,
    used_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note             TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (length(key) = 8)
);
CREATE INDEX IF NOT EXISTS idx_keys_bar ON one_time_keys(bar_id);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL,
    user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
    code      TEXT PRIMARY KEY,
    label_ru  TEXT NOT NULL
);
INSERT OR IGNORE INTO categories (code, label_ru) VALUES
    ('ingredients', 'Ингредиенты'),
    ('syrups',      'Сиропы'),
    ('cookies',     'Печенье'),
    ('other',       'Прочее');

CREATE TABLE IF NOT EXISTS positions (
    id                TEXT    PRIMARY KEY,
    bar_id            INTEGER NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
    tob               TEXT    NOT NULL,
    name              TEXT    NOT NULL,
    category          TEXT    NOT NULL REFERENCES categories(code),
    production_date   TEXT,
    closed_shelf_days INTEGER,
    honest_mark       TEXT,
    expiry_closed     TEXT    NOT NULL,
    shelf_open_days   INTEGER,
    is_open           INTEGER NOT NULL DEFAULT 0,
    opened_at         TEXT,
    created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (length(tob) = 6),
    CHECK (tob GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'),
    CHECK (is_open IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_positions_open_siblings
    ON positions (bar_id, lower(name), category, is_open);

CREATE INDEX IF NOT EXISTS idx_positions_bar_expiry ON positions (bar_id, expiry_closed);
CREATE INDEX IF NOT EXISTS idx_positions_bar_category ON positions (bar_id, category);

CREATE TRIGGER IF NOT EXISTS positions_updated
AFTER UPDATE ON positions
FOR EACH ROW
BEGIN
    UPDATE positions SET updated_at = datetime('now') WHERE id = NEW.id;
END;
