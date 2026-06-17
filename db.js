// ============================================================
// db.js : SQLite データベースの初期化と接続
// ------------------------------------------------------------
// - calendar.db を開く（無ければ自動作成）
// - init_db.sql のテーブル定義を実行（無ければ作成）
// - 接続インスタンスを他ファイルから使えるよう export する
// ============================================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// データベースファイルの場所（このファイルと同じフォルダ）
const DB_PATH = path.join(__dirname, 'calendar.db');

// 接続を開く
const db = new Database(DB_PATH);

// 外部キー制約を有効化（SQLiteはデフォルトOFFのため明示的に有効化）
db.pragma('foreign_keys = ON');

// init_db.sql を読み込んでテーブルを作成
const initSql = fs.readFileSync(path.join(__dirname, 'init_db.sql'), 'utf-8');
db.exec(initSql);

console.log('[db] SQLite 初期化完了 ->', DB_PATH);

module.exports = db;
