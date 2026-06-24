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
const contentHistory = document.getElementById('content-history'); // 入力候補(datalist)
const historyList    = document.getElementById('history-list');    // 履歴一覧

// --- 状態 ---------------------------------------------------
let viewDate = new Date();          // 表示中の月
let monthSchedules = [];            // 表示月の予定（キャッシュ）
let allSchedules = [];              // 全期間の予定（履歴・入力候補用）
let selectedDate = null;            // モーダルで選択中の日付 'YYYY-MM-DD'
let liffId = '';                    // サーバーから受け取るLIFF ID

// ============================================================
// 認証（LINE / LIFF）
// ============================================================
function showAuthMessage(msg) {
  authStatus.textContent = '';
  authError.textContent = msg;
}

// LINEのアクセストークンをサーバーに送ってログイン（セッション確立）
// （IDトークンは期限切れになりやすいため、期限切れしにくいアクセストークンを使う）
async function loginWithLine() {
  authError.textContent = '';
  authStatus.textContent = 'ログイン中…';
  const accessToken = liff.getAccessToken();
  if (!accessToken) {
    // トークンが取れない場合はLINEログインをやり直す
    liff.login();
    return;
  }
  try {
    const user = await api('POST', '/api/line-login', { accessToken });
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
  loadAllSchedules();   // 履歴・入力候補のための全予定を読み込み
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
      // 内容（予定名）を先頭にして、狭いマスでも予定の最初の文字が見えるようにする
      pill.textContent = ev.content + (ev.start_time ? ' ' + ev.start_time : '');
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

// --- 年・月を指定してジャンプ ---------------------------------
const jumpBtn     = document.getElementById('jump-btn');
const monthPicker = document.getElementById('month-picker');
const yearSelect  = document.getElementById('year-select');
const monthSelect = document.getElementById('month-select');

// 年（今年の前後10年）と月（1〜12）の選択肢を一度だけ用意
(function fillPickerOptions() {
  const thisYear = new Date().getFullYear();
  for (let y = thisYear - 10; y <= thisYear + 10; y++) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y + '年';
    yearSelect.appendChild(o);
  }
  for (let m = 1; m <= 12; m++) {
    const o = document.createElement('option');
    o.value = m; o.textContent = m + '月';
    monthSelect.appendChild(o);
  }
})();

// 「🗓 月を選択」で開閉。開く時は今表示中の年月を初期選択にする
jumpBtn.addEventListener('click', () => {
  if (monthPicker.classList.contains('hidden')) {
    yearSelect.value = viewDate.getFullYear();
    monthSelect.value = viewDate.getMonth() + 1;
  }
  monthPicker.classList.toggle('hidden');
});

// 「移動」で指定した年月へジャンプ
document.getElementById('picker-go').addEventListener('click', () => {
  const y = Number(yearSelect.value);
  const m = Number(monthSelect.value) - 1; // 0始まり
  viewDate = new Date(y, m, 1);
  renderCalendar();
  monthPicker.classList.add('hidden');
});

// ============================================================
// 予定一覧（全予定を箇条書き表示・並び替え）
// ============================================================
const listBtn     = document.getElementById('list-btn');
const listOverlay = document.getElementById('list-overlay');
const sortSelect  = document.getElementById('sort-select');
const allList     = document.getElementById('all-list');
const searchInput = document.getElementById('search-input');

function renderAllList() {
  // 予定名で絞り込み（大文字小文字を無視した部分一致）
  const q = searchInput.value.trim().toLowerCase();
  let items = [...allSchedules];
  if (q) {
    items = items.filter((s) => (s.content || '').toLowerCase().includes(q));
  }
  const st = (s) => s.start_time || '';
  switch (sortSelect.value) {
    case 'date-asc':
      items.sort((a, b) => (a.date + st(a)).localeCompare(b.date + st(b))); break;
    case 'date-desc':
      items.sort((a, b) => (b.date + st(b)).localeCompare(a.date + st(a))); break;
    case 'time-asc':
      items.sort((a, b) => st(a).localeCompare(st(b)) || a.date.localeCompare(b.date)); break;
    case 'content-asc':
      items.sort((a, b) => (a.content || '').localeCompare(b.content || '', 'ja')); break;
  }

  if (items.length === 0) {
    allList.innerHTML = `<li class="empty-note">${q ? '該当する予定がありません' : '予定はまだありません'}</li>`;
    return;
  }
  allList.innerHTML = '';
  for (const s of items) {
    const [y, m, d] = s.date.split('-');
    const li = document.createElement('li');
    li.className = 'all-item';

    const dateEl = document.createElement('span');
    dateEl.className = 'a-date';
    dateEl.textContent = `${y}/${Number(m)}/${Number(d)}`;

    const timeEl = document.createElement('span');
    timeEl.className = 'a-time';
    timeEl.textContent = (s.start_time || s.end_time)
      ? `${s.start_time || ''}${s.end_time ? '-' + s.end_time : ''}`
      : '終日';

    const textEl = document.createElement('span');
    textEl.className = 'a-text';
    textEl.textContent = s.content;

    li.appendChild(dateEl);
    li.appendChild(timeEl);
    li.appendChild(textEl);
    allList.appendChild(li);
  }
}

// 「📋 予定一覧」で開く（最新の全予定を取得して表示）
listBtn.addEventListener('click', async () => {
  searchInput.value = '';   // 開くたびに検索をリセット
  await loadAllSchedules();
  renderAllList();
  listOverlay.classList.remove('hidden');
});
sortSelect.addEventListener('change', renderAllList);
searchInput.addEventListener('input', renderAllList); // 入力するたび絞り込み
document.getElementById('list-close').addEventListener('click', () => listOverlay.classList.add('hidden'));
listOverlay.addEventListener('click', (e) => {
  if (e.target === listOverlay) listOverlay.classList.add('hidden');
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
  renderHistoryList();   // これまでの予定（履歴）も表示
  overlay.classList.remove('hidden');
}

function closeModal() {
  overlay.classList.add('hidden');
  selectedDate = null;
}

// ============================================================
// 履歴・入力候補（全期間の予定を使う）
// ============================================================
// 全期間の予定を取得（month指定なし＝本人の全件）。候補も更新。
async function loadAllSchedules() {
  try {
    allSchedules = await api('GET', '/api/schedules');
  } catch (_) {
    allSchedules = [];
  }
  renderContentHistory();
  renderWeekList();      // サイドバー（今後1週間）も更新
}

// ============================================================
// サイドバー：今日から1週間の予定（今日に近い順＝上から）
// ============================================================
const weekList = document.getElementById('week-list');

function renderWeekList() {
  const t = new Date();
  const startStr = ymd(t.getFullYear(), t.getMonth(), t.getDate());            // 今日
  const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 6);        // 6日後
  const endStr = ymd(end.getFullYear(), end.getMonth(), end.getDate());

  // 今日〜6日後（計7日間）を、今日に近い順（昇順）に並べる
  const items = allSchedules
    .filter((s) => s.date >= startStr && s.date <= endStr)
    .sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));

  if (items.length === 0) {
    weekList.innerHTML = '<p class="week-empty">今後1週間の予定はありません</p>';
    return;
  }

  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  weekList.innerHTML = '';
  for (const s of items) {
    const [y, m, d] = s.date.split('-').map(Number);
    const wd = WD[new Date(y, m - 1, d).getDay()];

    const row = document.createElement('div');
    row.className = 'week-item';
    if (s.date === startStr) row.classList.add('today');
    row.title = 'クリックでその日を開く';

    const day = document.createElement('div');
    day.className = 'w-day';
    day.textContent = `${m}/${d}(${wd})` + (s.date === startStr ? ' 今日' : '');

    const text = document.createElement('div');
    text.className = 'w-text';
    text.textContent = s.content;

    const time = document.createElement('div');
    time.className = 'w-time';
    time.textContent = (s.start_time || s.end_time)
      ? `${s.start_time || ''}${s.end_time ? '-' + s.end_time : ''}`
      : '終日';

    row.appendChild(day);
    row.appendChild(text);
    row.appendChild(time);

    // クリックでその予定の月へ移動し、その日のモーダルを開く
    row.addEventListener('click', async () => {
      viewDate = new Date(y, m - 1, 1);
      await renderCalendar();
      openModal(s.date);
    });

    weekList.appendChild(row);
  }
}

// 新しい順に並べた予定（履歴表示・候補で共通利用）
function schedulesNewestFirst() {
  return [...allSchedules].sort((a, b) =>
    (b.date + (b.start_time || '')).localeCompare(a.date + (a.start_time || ''))
  );
}

// 入力候補(datalist): 過去に使った「内容」を新しい順・重複なしで最大50件
function renderContentHistory() {
  const seen = new Set();
  const options = [];
  for (const s of schedulesNewestFirst()) {
    const c = (s.content || '').trim();
    if (c && !seen.has(c)) {
      seen.add(c);
      options.push(c);
    }
  }
  contentHistory.innerHTML = '';
  for (const c of options.slice(0, 50)) {
    const opt = document.createElement('option');
    opt.value = c;
    contentHistory.appendChild(opt);
  }
}

// 履歴一覧（モーダル内）: 全予定を新しい順に表示。クリックで内容を入力欄へ。
function renderHistoryList() {
  const items = schedulesNewestFirst();
  if (items.length === 0) {
    historyList.innerHTML = '<p class="empty-note">まだ予定がありません</p>';
    return;
  }
  historyList.innerHTML = '';
  for (const s of items) {
    const [, m, d] = s.date.split('-');
    const row = document.createElement('div');
    row.className = 'history-item';
    row.title = 'クリックで内容を入力欄に入れる';

    const when = document.createElement('span');
    when.className = 'h-date';
    when.textContent = `${Number(m)}/${Number(d)}` + (s.start_time ? ' ' + s.start_time : '');

    const text = document.createElement('span');
    text.className = 'h-text';
    text.textContent = s.content;

    // クリックで内容（と時間）を入力欄に流し込み、再利用しやすく
    row.addEventListener('click', () => {
      document.getElementById('content').value = s.content;
      if (s.start_time) document.getElementById('start-time').value = s.start_time;
      if (s.end_time) document.getElementById('end-time').value = s.end_time;
      document.getElementById('content').focus();
    });

    row.appendChild(when);
    row.appendChild(text);
    historyList.appendChild(row);
  }
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
      await loadAllSchedules(); // 履歴・候補を更新
      renderModalList();        // 一覧再描画
      renderHistoryList();      // 履歴一覧も更新
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
  await loadAllSchedules(); // 履歴・入力候補を更新
  renderModalList();       // モーダル内一覧も更新
  renderHistoryList();     // 履歴一覧も更新
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

  // 2) サーバー設定を取得
  authStatus.textContent = '読み込み中…';
  try {
    const cfg = await api('GET', '/api/config');
    liffId = cfg.liffId;
  } catch (_) {
    showAuthMessage('サーバー設定の取得に失敗しました。');
    return;
  }

  // 3) LIFF 初期化（LINEログイン）
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
