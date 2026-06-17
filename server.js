// ============================================================
// server.js : Express バックエンド
// ------------------------------------------------------------
// 認証(登録/ログイン/ログアウト) と スケジュールCRUD のAPIを提供。
// セッションでログイン状態を管理し、ユーザーは自分の予定のみ操作可能。
// データの保存先は db.js（Turso / ローカルファイル）。
// ============================================================
require('dotenv').config(); // .env の内容を process.env に読み込む（ローカル開発用）

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// --- ミドルウェア -------------------------------------------
app.use(express.json());                                  // JSONボディを解析
app.use(express.static(path.join(__dirname, 'public')));  // 静的ファイル配信

app.use(session({
  // 本番は環境変数 SESSION_SECRET を設定する（Renderでは自動生成した値を渡す）
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,             // JSからCookieを読めなくする（XSS対策）
    maxAge: 1000 * 60 * 60 * 24 // 1日
  }
}));

// async なルートのエラーを Express のエラーハンドラに渡すためのラッパー
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- 認証チェック用ミドルウェア -----------------------------
// ログインしていなければ401を返す。各APIの前段で利用。
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'ログインが必要です' });
}

// === 認証API ================================================

// 新規登録
app.post('/api/register', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'パスワードは4文字以上にしてください' });
  }

  // ユーザー名の重複チェック
  const exists = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) {
    return res.status(409).json({ error: 'そのユーザー名は既に使われています' });
  }

  // パスワードをハッシュ化して保存
  const hash = bcrypt.hashSync(password, 10);
  const info = await db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);

  // 登録と同時にログイン状態にする
  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.json({ id: info.lastInsertRowid, username });
}));

// ログイン
app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
  }

  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username });
}));

// ログアウト
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ログイン中のユーザー情報を取得（画面の初期表示判定に使用）
app.get('/api/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ id: req.session.userId, username: req.session.username });
  }
  res.status(401).json({ error: '未ログイン' });
});

// === スケジュールAPI（すべてログイン必須） ==================

// 指定月の予定を取得  GET /api/schedules?month=YYYY-MM
app.get('/api/schedules', requireLogin, wrap(async (req, res) => {
  const month = req.query.month; // 'YYYY-MM'
  let rows;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    rows = await db.all(
      `SELECT * FROM schedules
       WHERE user_id = ? AND date LIKE ?
       ORDER BY date, start_time`,
      [req.session.userId, month + '-%']
    );
  } else {
    rows = await db.all(
      `SELECT * FROM schedules WHERE user_id = ? ORDER BY date, start_time`,
      [req.session.userId]
    );
  }
  res.json(rows);
}));

// 予定を追加  POST /api/schedules
app.post('/api/schedules', requireLogin, wrap(async (req, res) => {
  const { date, start_time, end_time, content } = req.body || {};
  if (!date || !content) {
    return res.status(400).json({ error: '日付と内容は必須です' });
  }
  const info = await db.run(
    `INSERT INTO schedules (user_id, date, start_time, end_time, content)
     VALUES (?, ?, ?, ?, ?)`,
    [req.session.userId, date, start_time || null, end_time || null, content]
  );

  const created = await db.get('SELECT * FROM schedules WHERE id = ?', [info.lastInsertRowid]);
  res.json(created);
}));

// 予定を削除  DELETE /api/schedules/:id  （自分の予定のみ）
app.delete('/api/schedules/:id', requireLogin, wrap(async (req, res) => {
  const info = await db.run(
    'DELETE FROM schedules WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.userId]
  );
  if (info.changes === 0) {
    return res.status(404).json({ error: '対象の予定が見つかりません' });
  }
  res.json({ ok: true });
}));

// --- エラーハンドラ（async内で投げられた例外をまとめて処理）---
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'サーバー内部でエラーが発生しました' });
});

// --- 起動 ---------------------------------------------------
// 先にDB（テーブル作成）を初期化してから待ち受け開始する。
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n✅ サーバー起動: http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('[起動失敗] データベース初期化に失敗しました:', err);
    process.exit(1);
  });
