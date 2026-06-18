// ============================================================
// script.js : フロントエンド（Vanilla JS）
// ------------------------------------------------------------
// 認証は LINE(LIFF) でログイン。カレンダー描画・予定モーダルの操作を担当。
// サーバーとは fetch + JSON でやり取りする。
// ============================================================

// --- API ヘルパー -------------------------------------------
// credentials:'same-origin' でセッションCookieを送受信する。
async function api(method, url, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body) opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || 'エラーが発生しました');
  return data;
}

// --- 要素参照 -----------------------------------------------
const authView    = document.getElementById('auth-view');
const appView     = document.getElementById('app-view');
const authError   = document.getElementById('auth-error');
const authStatus  = document.getElementById('auth-status');
const lineLoginBtn = document.getElementById('line-login-btn');

const monthLabel = document.getElementById('month-label');
const calGrid    = document.getElementById('calendar-grid');
const userLabel  = document.getElementById('user-label');

const overlay      = document.getElementById('modal-overlay');
const modalDate    = document.getElementById('modal-date');
const scheduleList = document.getElementById('schedule-list');
const scheduleForm = document.getElementById('schedule-form');

// --- 状態 ---------------------------------------------------
let viewDate = new Date();          // 表示中の月
let monthSchedules = [];            // 表示月の予定（キャッシュ）
let selectedDate = null;            // モーダルで選択中の日付 'YYYY-MM-DD'
let liffId = '';                    // サーバーから受け取るLIFF ID

// ============================================================
// 認証（LINE / LIFF）
// ============================================================
function showAuthMessage(msg) {
  authStatus.textContent = '';
  authError.textContent = msg;
}

// LINEのIDトークンをサーバーに送ってログイン（セッション確立）
async function loginWithLine() {
  authError.textContent = '';
  authStatus.textContent = 'ログイン中…';
  const idToken = liff.getIDToken();
  if (!idToken) {
    showAuthMessage('IDトークンを取得できませんでした。LINEログインをやり直してください。');
    lineLoginBtn.classList.remove('hidden');
    return;
  }
  try {
    const user = await api('POST', '/api/line-login', { idToken });
    enterApp(user);
  } catch (err) {
    showAuthMessage('ログインに失敗しました: ' + err.message);
    lineLoginBtn.classList.remove('hidden');
  }
}

// ボタン押下：未ログインならLINEログインへ、ログイン済みならセッション確立
lineLoginBtn.addEventListener('click', () => {
  if (window.liff && liff.isLoggedIn()) {
    loginWithLine();
  } else if (window.liff) {
    liff.login(); // LINEのログイン画面へ（戻ってくると再度initが走る）
  }
});

// ============================================================
// 画面切り替え
// ============================================================
function enterApp(user) {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  userLabel.textContent = `👤 ${user.username}`;
  viewDate = new Date();
  renderCalendar();
}

function exitApp() {
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
  authError.textContent = '';
  authStatus.textContent = '';
  lineLoginBtn.classList.remove('hidden');
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await api('POST', '/api/logout'); } catch (_) {}
  try { if (window.liff && liff.isLoggedIn()) liff.logout(); } catch (_) {}
  exitApp();
});

// ============================================================
// カレンダー描画
// ============================================================
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m は 0始まり

async function renderCalendar() {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0始まり
  monthLabel.textContent = `${year}年 ${month + 1}月`;

  // その月の予定をまとめて取得
  const monthStr = `${year}-${pad(month + 1)}`;
  try {
    monthSchedules = await api('GET', `/api/schedules?month=${monthStr}`);
  } catch (err) {
    // セッション切れなどでログイン画面へ戻す
    exitApp();
    return;
  }

  // 日付ごとに予定をまとめる
  const byDate = {};
  for (const s of monthSchedules) {
    (byDate[s.date] = byDate[s.date] || []).push(s);
  }

  calGrid.innerHTML = '';
  const firstWeekday = new Date(year, month, 1).getDay(); // 月初の曜日(0=日)
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  // 月初までの空白セル
  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-cell empty';
    calGrid.appendChild(empty);
  }

  // 各日付セル
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = ymd(year, month, d);
    const weekday = new Date(year, month, d).getDay();

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (weekday === 0) cell.classList.add('sun');
    if (weekday === 6) cell.classList.add('sat');
    if (dateStr === todayStr) cell.classList.add('today');

    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = d;
    cell.appendChild(num);

    // 予定を最大3件まで表示、超過分は「+N」
    const events = byDate[dateStr] || [];
    events.slice(0, 3).forEach((ev) => {
      const pill = document.createElement('div');
      pill.className = 'event-pill';
      pill.textContent = (ev.start_time ? ev.start_time + ' ' : '') + ev.content;
      cell.appendChild(pill);
    });
    if (events.length > 3) {
      const more = document.createElement('div');
      more.className = 'more-count';
      more.textContent = `+${events.length - 3}件`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => openModal(dateStr));
    calGrid.appendChild(cell);
  }
}

document.getElementById('prev-month').addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById('next-month').addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  renderCalendar();
});
document.getElementById('today-btn').addEventListener('click', () => {
  viewDate = new Date();
  renderCalendar();
});

// ============================================================
// 予定モーダル
// ============================================================
function openModal(dateStr) {
  selectedDate = dateStr;
  const [y, m, d] = dateStr.split('-');
  modalDate.textContent = `${y}年${Number(m)}月${Number(d)}日 の予定`;
  scheduleForm.reset();
  renderModalList();
  overlay.classList.remove('hidden');
}

function closeModal() {
  overlay.classList.add('hidden');
  selectedDate = null;
}

function renderModalList() {
  const items = monthSchedules
    .filter((s) => s.date === selectedDate)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

  if (items.length === 0) {
    scheduleList.innerHTML = '<p class="empty-note">予定はまだありません</p>';
    return;
  }

  scheduleList.innerHTML = '';
  for (const s of items) {
    const row = document.createElement('div');
    row.className = 'schedule-item';

    const time = document.createElement('div');
    time.className = 'time';
    if (s.start_time || s.end_time) {
      time.textContent = `${s.start_time || ''}${s.end_time ? ' - ' + s.end_time : ''}`;
    } else {
      time.textContent = '終日';
    }

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = s.content;

    const del = document.createElement('button');
    del.className = 'del-btn';
    del.textContent = '🗑';
    del.title = '削除';
    del.addEventListener('click', async () => {
      await api('DELETE', `/api/schedules/${s.id}`);
      await renderCalendar();   // キャッシュ更新
      renderModalList();        // 一覧再描画
    });

    row.appendChild(time);
    row.appendChild(text);
    row.appendChild(del);
    scheduleList.appendChild(row);
  }
}

scheduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const start_time = document.getElementById('start-time').value;
  const end_time   = document.getElementById('end-time').value;
  const content    = document.getElementById('content').value.trim();
  if (!content) return;

  await api('POST', '/api/schedules', {
    date: selectedDate, start_time, end_time, content
  });
  scheduleForm.reset();
  await renderCalendar();  // カレンダーのキャッシュと表示を更新
  renderModalList();       // モーダル内一覧も更新
});

document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal(); // 背景クリックで閉じる
});

// ============================================================
// 画面内キーボード対応（デザインは変えず、挙動だけ追加）
//  ① 入力欄がキーボードに隠れない（focus時にスクロールして見える位置へ）
//  ② キーボードで画面が狭くなってもUIが収まる/スクロールできる
// ============================================================
(function setupKeyboardHandling() {
  const vv = window.visualViewport;
  if (!vv) return; // 非対応環境では何もしない（デザインそのまま）

  function onViewport() {
    // 実際に見えている高さをCSS変数へ（キーボード分を除いた高さ）
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    // キーボードが出ている（=元の高さより大きく縮んだ）かを判定
    const keyboardOpen = (window.innerHeight - vv.height) > 150;
    document.body.classList.toggle('keyboard-open', keyboardOpen);
  }
  vv.addEventListener('resize', onViewport);
  vv.addEventListener('scroll', onViewport);
  onViewport();

  // 入力欄にフォーカスしたら、その欄が見える位置へスクロール
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input, textarea')) {
      setTimeout(() => {
        e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 150);
    }
  });
})();

// ============================================================
// 起動時の流れ
//  1) 既にセッションがあればそのままカレンダーへ
//  2) 無ければ LIFF を初期化し、LINEログイン状態なら自動ログイン
// ============================================================
(async function init() {
  // 1) 既存セッションを確認
  try {
    const user = await api('GET', '/api/me');
    enterApp(user);
    return;
  } catch (_) { /* 未ログイン → LINE認証へ */ }

  // 2) LIFF 初期化
  authStatus.textContent = '読み込み中…';
  try {
    const cfg = await api('GET', '/api/config');
    liffId = cfg.liffId;
  } catch (_) {
    showAuthMessage('サーバー設定の取得に失敗しました。');
    return;
  }

  if (!liffId) {
    showAuthMessage('LIFF IDが未設定です。環境変数 LIFF_ID（.env / Render）を設定してください。');
    return;
  }
  if (!window.liff) {
    showAuthMessage('LIFF SDKを読み込めませんでした（ネットワークをご確認ください）。');
    return;
  }

  try {
    await liff.init({ liffId });
    if (liff.isLoggedIn()) {
      await loginWithLine();          // ログイン済み → 自動でセッション確立
    } else {
      authStatus.textContent = '';
      lineLoginBtn.classList.remove('hidden'); // 「LINEでログイン」ボタンを表示
    }
  } catch (err) {
    showAuthMessage('LINEの初期化に失敗しました: ' + (err.message || err));
  }
})();
