-- ============================================================
-- テーブル作成用SQL (SQLite)
-- server.js 起動時に db.js が自動でこの内容を実行しますが、
-- 手動で確認・実行したい場合は以下を利用できます:
--   sqlite3 calendar.db < init_db.sql
-- ============================================================

-- 1. users テーブル（LINEログイン用）
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT    UNIQUE,                   -- LINEのユーザーID（IDトークンの sub）
  display_name TEXT,                             -- LINEの表示名
  username     TEXT    UNIQUE,                   -- （旧）ユーザー名: 後方互換のため残す
  password     TEXT,                             -- （旧）パスワード: 後方互換のため残す
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 2. schedules テーブル（ユーザーID・日付・時間・内容を保存）
CREATE TABLE IF NOT EXISTS schedules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,                   -- どのユーザーの予定か
  date       TEXT    NOT NULL,                   -- 日付 'YYYY-MM-DD'
  start_time TEXT,                               -- 開始時間 'HH:MM'
  end_time   TEXT,                               -- 終了時間 'HH:MM'
  content    TEXT    NOT NULL,                   -- 予定の内容
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 検索高速化用インデックス（ユーザー＋日付）
CREATE INDEX IF NOT EXISTS idx_schedules_user_date
  ON schedules (user_id, date);
