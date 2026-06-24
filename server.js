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

// === 認証API（LINE / LIFF） =================================

// フロントにLIFF IDを渡す（LIFF IDは公開情報なのでそのまま返してよい）
app.get('/api/config', (req, res) => {
  res.json({ liffId: process.env.LIFF_ID || '' });
});

// LINEログイン: フロントから受け取ったIDトークンをLINEに検証してもらい、
// 正当ならそのLINEユーザーでセッションを作る（無ければ新規作成）。
app.post('/api/line-login', wrap(async (req, res) => {
  const { accessToken } = req.body || {};
  if (!accessToken) {
    return res.status(400).json({ error: 'アクセストークンがありません' });
  }
  const channelId = process.env.LINE_CHANNEL_ID;
  if (!channelId) {
    return res.status(500).json({ error: 'サーバー側で LINE_CHANNEL_ID が未設定です' });
  }

  // ① アクセストークンを検証（このチャネル向けか・有効期限内か）
  //    IDトークンと違い、LIFFのアクセストークンは期限切れになりにくい。
  const verifyRes = await fetch(
    'https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(accessToken)
  );
  const verify = await verifyRes.json();
  if (!verifyRes.ok) {
    console.error('[line-login] token検証失敗:', verifyRes.status, JSON.stringify(verify));
    const detail = (verify && (verify.error_description || verify.error)) || `status ${verifyRes.status}`;
    return res.status(401).json({ error: `LINE認証に失敗しました（${detail}）` });
  }
  // このアクセストークンが本当に自分のチャネル向けに発行されたものか確認（なりすまし防止）
  if (verify.client_id !== channelId) {
    console.error('[line-login] channel不一致:', verify.client_id, '≠', channelId);
    return res.status(401).json({ error: 'LINE認証に失敗しました（チャネル不一致）' });
  }

  // ② プロフィールを取得（ユーザーID・表示名）
  const profRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const profile = await profRes.json();
  if (!profRes.ok || !profile.userId) {
    console.error('[line-login] profile取得失敗:', profRes.status, JSON.stringify(profile));
    return res.status(401).json({ error: 'LINEプロフィールの取得に失敗しました' });
  }

  const lineUserId = profile.userId;              // LINEのユーザーID
  const displayName = profile.displayName || 'LINEユーザー';

  // 既存ユーザーを探す → 無ければ作成（upsert）
  let user = await db.get('SELECT * FROM users WHERE line_user_id = ?', [lineUserId]);
  if (!user) {
    // 旧スキーマでは username/password が NOT NULL のため値を入れる
    // （LINEログインでは未使用。username=LINEユーザーID, password=空文字。新スキーマでも問題なし）
    const info = await db.run(
      'INSERT INTO users (line_user_id, display_name, username, password) VALUES (?, ?, ?, ?)',
      [lineUserId, displayName, lineUserId, '']
    );
    user = { id: info.lastInsertRowid, display_name: displayName };
  } else if (user.display_name !== displayName) {
    await db.run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, user.id]);
  }

  req.session.userId = user.id;
  req.session.username = displayName; // 画面表示用（/api/me 互換）
  res.json({ id: user.id, username: displayName });
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
