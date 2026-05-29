-- Полная схема Bar Manager.
-- Применить: sqlite3 bar.db < schema.sql (или вызывается из db.init_db()).

PRAGMA foreign_keys = ON;

-- ----- Бары -----
CREATE TABLE IF NOT EXISTS bars (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- 'АВПМ-97'
    short_code  TEXT    NOT NULL,                          -- 'ПМ97' (нормализованное, для поиска в таблице графика)
    name        TEXT    NOT NULL,                          -- 'АВПМ-97 Алексеевская'
    address     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bars_short_code ON bars(short_code);

-- ----- Пользователи -----
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

-- ----- Одноразовые ключи -----
-- Каждый ключ привязан к бару и сгорает после использования.
CREATE TABLE IF NOT EXISTS one_time_keys (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    key              TEXT    NOT NULL UNIQUE,              -- 8 цифр
    bar_id           INTEGER NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
    used_at          TEXT,                                  -- NULL пока не активирован
    used_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note             TEXT,                                  -- свободное поле для админа: кому выдали
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (length(key) = 8)
);
CREATE INDEX IF NOT EXISTS idx_keys_bar ON one_time_keys(bar_id);

-- ----- Сессии -----
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL,
    user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ----- Категории (справочник) -----
CREATE TABLE IF NOT EXISTS categories (
    code      TEXT PRIMARY KEY,
    label_ru  TEXT NOT NULL
);
INSERT OR IGNORE INTO categories (code, label_ru) VALUES
    ('ingredients', 'Ингредиенты'),
    ('syrups',      'Сиропы'),
    ('cookies',     'Печенье'),
    ('other',       'Прочее');

-- ----- Позиции (бар-скоупные) -----
CREATE TABLE IF NOT EXISTS positions (
    id                TEXT    PRIMARY KEY,
    bar_id            INTEGER NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
    tob               TEXT    NOT NULL,                          -- 6 цифр
    name              TEXT    NOT NULL,
    category          TEXT    NOT NULL REFERENCES categories(code),
    production_date   TEXT,                                       -- YYYY-MM-DDTHH:MM, момент производства
    closed_shelf_days INTEGER,                                    -- срок годности в днях от производства
    expiry_closed     TEXT    NOT NULL,                           -- production_date + closed_shelf_days
    shelf_open_days   INTEGER,                                    -- срок после вскрытия
    is_open           INTEGER NOT NULL DEFAULT 0,
    opened_at         TEXT,                                       -- YYYY-MM-DD
    created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (length(tob) = 6),
    CHECK (tob GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'),
    CHECK (is_open IN (0, 1))
    -- TOB не уникален в пределах бара: один и тот же товар может
    -- быть в нескольких упаковках. Для сиропов дубликат TOB
    -- помечается на фронте предупреждением.
);

-- Лимит открытых регулируется на уровне приложения и зависит от категории:
--   syrups → до 2 открытых одновременно (UI пометит ⚠)
--   остальные → одна открытая
-- Индекс — обычный, для быстрого поиска «братьев».
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
