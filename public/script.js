// ============================================================
// script.js : フロントエンド（Vanilla JS）
// ------------------------------------------------------------
// 認証画面の制御、カレンダー描画、予定モーダルの操作を担当。
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
const authView   = document.getElementById('auth-view');
const appView    = document.getElementById('app-view');
const authForm   = document.getElementById('auth-form');
const authError  = document.getElementById('auth-error');
const authSubmit = document.getElementById('auth-submit');
const tabLogin   = document.getElementById('tab-login');
const tabRegister= document.getElementById('tab-register');

const monthLabel = document.getElementById('month-label');
const calGrid    = document.getElementById('calendar-grid');
const userLabel  = document.getElementById('user-label');

const overlay      = document.getElementById('modal-overlay');
const modalDate    = document.getElementById('modal-date');
const scheduleList = document.getElementById('schedule-list');
const scheduleForm = document.getElementById('schedule-form');

// --- 状態 ---------------------------------------------------
let mode = 'login';                 // 'login' or 'register'
let viewDate = new Date();          // 表示中の月
let monthSchedules = [];            // 表示月の予定（キャッシュ）
let selectedDate = null;            // モーダルで選択中の日付 'YYYY-MM-DD'

// ============================================================
// 認証画面の制御
// ============================================================
function setMode(next) {
  mode = next;
  const isLogin = mode === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabRegister.classList.toggle('active', !isLogin);
  authSubmit.textContent = isLogin ? 'ログイン' : '登録する';
  authError.textContent = '';
}
tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const url = mode === 'login' ? '/api/login' : '/api/register';
  try {
    const user = await api('POST', url, { username, password });
    enterApp(user);
  } catch (err) {
    authError.textContent = err.message;
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
  authForm.reset();
  setMode('login');
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout');
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
// 起動時：ログイン済みか確認
// ============================================================
(async function init() {
  try {
    const user = await api('GET', '/api/me');
    enterApp(user);
  } catch (_) {
    exitApp(); // 未ログインなら認証画面
  }
})();
