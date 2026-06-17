// ============================================================
// db.js : SQLite データベースの初期化と接続
// ------------------------------------------------------------
// - DBファイルを開く（無ければ自動作成）
// - init_db.sql のテーブル定義を実行（無ければ作成）
// - 接続インスタンスを他ファイルから使えるよう export する
// ============================================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// データベースファイルの保存先。
//   - 環境変数 DATABASE_PATH があればそれを使う
//     （例: Renderの永続ディスクを /data にマウントし DATABASE_PATH=/data/calendar.db）
//   - 無ければ従来どおり、このフォルダの calendar.db
// ★永続ディスクや別ストレージを用意したら「保存先を指すだけ」でデータが残るようになる。
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'calendar.db');

// 保存先フォルダが無ければ作成（/data など別フォルダを指定した場合に対応）
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// 接続を開く
const db = new Database(DB_PATH);

// WALモード: 書き込み途中で強制終了されてもDBが壊れにくく、読み書きも速くなる
db.pragma('journal_mode = WAL');
// 外部キー制約を有効化（SQLiteはデフォルトOFFのため明示的に有効化）
db.pragma('foreign_keys = ON');

// init_db.sql を読み込んでテーブルを作成
const initSql = fs.readFileSync(path.join(__dirname, 'init_db.sql'), 'utf-8');
db.exec(initSql);

console.log('[db] SQLite 初期化完了 ->', DB_PATH);

// --- 安全なシャットダウン -----------------------------------
// Renderはスリープ・再デプロイ時にプロセスへ SIGTERM を送る。Ctrl+C は SIGINT。
// これを受けてWALを本体に書き出し、DBを正しく閉じることで破損を防ぐ。
// （※無料プランではディスクごと消えるため「消失」は防げないが、整合性は守られる）
let closed = false;
function closeDb() {
  if (closed) return;
  closed = true;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)'); // WALの内容を本体ファイルへ反映
    db.close();
    console.log('[db] SQLite を安全に閉じました');
  } catch (e) {
    console.error('[db] クローズ時エラー:', e.message);
  }
}
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
process.on('SIGINT',  () => { closeDb(); process.exit(0); });

module.exports = db;
