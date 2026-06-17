// ============================================================
// db.js : Turso (libSQL) データベース接続
// ------------------------------------------------------------
// 接続先の決め方:
//   - 環境変数 TURSO_DATABASE_URL があれば Turso クラウドに接続（データが消えない）
//   - 無ければローカルファイル file:calendar.db に接続（開発用・従来どおり）
// 起動時に init_db.sql を実行してテーブルを用意する。
// 呼び出し側を短く保つため get / all / run のヘルパーを提供する。
// ============================================================
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

// 接続先URL。Tursoの接続情報が無ければローカルファイルにフォールバック。
const url = process.env.TURSO_DATABASE_URL || 'file:calendar.db';
const authToken = process.env.TURSO_AUTH_TOKEN; // ローカルファイル接続時は不要(undefinedでOK)

const client = createClient({ url, authToken });

// libSQLの行オブジェクトを「列名: 値」の素のオブジェクトに変換（res.jsonで素直に返すため）
function rowToObject(row, columns) {
  const obj = {};
  for (const col of columns) obj[col] = row[col];
  return obj;
}

// --- クエリ用ヘルパー ---------------------------------------
// 1行だけ取得（無ければ undefined）
async function get(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows.length ? rowToObject(rs.rows[0], rs.columns) : undefined;
}

// 全行取得（配列）
async function all(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows.map((r) => rowToObject(r, rs.columns));
}

// 追加/更新/削除。lastInsertRowid（採番されたID）と changes（変更件数）を返す
async function run(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return {
    lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : undefined,
    changes: rs.rowsAffected,
  };
}

// --- 起動時にテーブルを用意 ---------------------------------
// init_db.sql（複数のCREATE文）をまとめて実行。IF NOT EXISTS なので何度でも安全。
async function init() {
  const initSql = fs.readFileSync(path.join(__dirname, 'init_db.sql'), 'utf-8');
  await client.executeMultiple(initSql);
  const where = url.startsWith('libsql://') ? 'Turso(クラウド)' : 'ローカルファイル';
  console.log(`[db] 初期化完了 -> ${where} : ${url}`);
}

module.exports = { client, get, all, run, init };
