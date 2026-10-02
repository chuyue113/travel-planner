'use strict';

/* ==================================================================
   團體旅遊協作平台 — 前端應用
   ================================================================== */

/* ------------------------------ 常數 ------------------------------ */

const CATS = ['transport', 'stay', 'food', 'sight', 'shop', 'activity', 'ticket', 'other'];
const CAT_COLOR = {
  transport: '#3b82f6', stay: '#8b5cf6', food: '#f59e0b', sight: '#10b981',
  shop: '#ec4899', activity: '#06b6d4', ticket: '#6366f1', other: '#94a3b8',
};
const SYMBOL = {
  TWD: 'NT$', CNY: '¥', USD: '$', JPY: 'JP¥', EUR: '€', HKD: 'HK$',
  KRW: '₩', THB: '฿', SGD: 'S$', MYR: 'RM', VND: '₫', GBP: '£', AUD: 'A$',
};
const CURRENCIES = Object.keys(SYMBOL);
const PALETTES = [
  { id: 'teal', swatch: ['#0f766e', '#e4572e', '#e3f3f1'] },
  { id: 'rose', swatch: ['#D48D95', '#B7D5C6', '#E6A6AC'] },
];
const PALETTE = ['#e4572e', '#17bebb', '#8e6ec8', '#f2a541', '#2f8fd8',
  '#d64570', '#3fa66b', '#b07d3a', '#6b7c85', '#a855f7'];

/* 每個資料夾／每個項目可放置的圖片張數上限（與伺服器端一致） */
const IMAGE_MAX = 10;
const TABS = [
  { id: 'overview', icon: '📊', key: 'nav.overview' },
  { id: 'itinerary', icon: '🗓️', key: 'nav.itinerary' },
  { id: 'expenses', icon: '💰', key: 'nav.expenses' },
  { id: 'rooms', icon: '🛏️', key: 'nav.rooms' },
  { id: 'folders', icon: '📁', key: 'nav.folders' },
  { id: 'reminders', icon: '🔔', key: 'nav.reminders' },
  { id: 'members', icon: '👥', key: 'nav.members' },
];

/* ------------------------------ 狀態 ------------------------------ */

let S = null;                       // 伺服器狀態
const UI = {
  tab: 'overview',
  lang: localStorage.getItem('tp.lang') || detectLang(),
  theme: localStorage.getItem('tp.theme') || 'auto',
  palette: localStorage.getItem('tp.palette') || 'teal',
  me: localStorage.getItem('tp.me') || '',
  /* 解鎖狀態只存在記憶體：重新整理後需再次輸入密碼（金鑰不會留在瀏覽器） */
  unlock: false,
  gate: localStorage.getItem('tp.gate') === '1',
  itView: 'list',
  exView: 'actual',
  calMonth: null,
  calSelected: null,
  openFolder: null,
  folderCat: '',
  sortByVotes: false,
  showDone: false,
  saving: 0,
  pendingAdmin: null,
};
const notified = new Set(JSON.parse(localStorage.getItem('tp.notified') || '[]'));

function detectLang() {
  const n = (navigator.language || 'zh-Hant').toLowerCase();
  if (n.startsWith('zh')) return (n.includes('hans') || n.includes('cn') || n.includes('sg')) ? 'zh-Hans' : 'zh-Hant';
  if (n.startsWith('en')) return 'en';
  return 'zh-Hant';
}

/* ------------------------------ 小工具 ---------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function t(key, vars) {
  const dict = I18N[UI.lang] || I18N['zh-Hant'];
  let str = dict[key] !== undefined ? dict[key] : (I18N['zh-Hant'][key] !== undefined ? I18N['zh-Hant'][key] : key);
  if (vars) {
    for (const k of Object.keys(vars)) str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  }
  return str;
}

function locale() {
  return UI.lang === 'zh-Hans' ? 'zh-CN' : UI.lang === 'en' ? 'en-US' : 'zh-TW';
}

function uid(p) {
  return (p || 'id') + '_' + Math.random().toString(36).slice(2, 10);
}

function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(javascript|data|vbscript|file):/i.test(s)) return '';
  if (s.startsWith('/')) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return 'https://' + s.replace(/^\/+/, '');
}

function hostOf(u) {
  const s = safeUrl(u);
  try { return new URL(s, location.origin).hostname.replace(/^www\./, ''); }
  catch (_) { return s.slice(0, 40); }
}

/* ------------------------------ 管理員 ---------------------------- */

/* 同一組管理員密碼同時保護「記帳資料」與「資料夾編輯」 */
function isAdmin() { return !!UI.unlock; }

/* 需要管理員權限才執行；未解鎖時先跳密碼視窗，解鎖成功後自動接續原動作 */
function withAdmin(fn) {
  if (isAdmin()) { fn(); return; }
  openAdminPrompt(fn);
}

function openAdminPrompt(fn) {
  UI.pendingAdmin = typeof fn === 'function' ? fn : null;
  openModal({
    title: t('adm.title'),
    body: `<div class="lockbox" style="padding:6px 0 0">
        <div class="lockicon">🔐</div>
        <p class="muted small">${esc(t('adm.hint'))}</p>
        <form id="admForm" autocomplete="off">
          <input type="password" id="admPwd" inputmode="numeric" autocomplete="off"
            placeholder="${esc(t('lock.placeholder'))}" aria-label="${esc(t('lock.placeholder'))}">
          <button class="btn primary" type="submit">${esc(t('lock.submit'))}</button>
        </form>
        <p class="small lock-err" id="admErr"></p>
      </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>`,
  });
}

async function doAdminUnlock() {
  const el = $('#admPwd');
  const err = $('#admErr');
  if (!el) return;
  const pwd = el.value.trim();
  if (!pwd) return;
  el.disabled = true;
  const ok = await unlockExpenses(pwd);
  if (ok) {
    toast(t('adm.unlocked'));
    closeModal();
    render();
    const fn = UI.pendingAdmin;
    UI.pendingAdmin = null;
    if (fn) setTimeout(fn, 80);
  } else {
    if (err) err.textContent = t('lock.wrong');
    el.disabled = false;
    el.value = '';
    el.focus();
  }
}

/* ------------------------------ 圖片工具 -------------------------- */

/* 取得項目圖片（相容舊資料的單張 image） */
function itemImages(it) {
  if (!it) return [];
  const arr = Array.isArray(it.images) ? it.images.filter(Boolean) : [];
  if (arr.length) return arr.slice(0, IMAGE_MAX);
  return it.image ? [it.image] : [];
}

/* 資料夾封面：資料夾本身不存圖片，取「內第一個有圖內容」的第一張圖 */
function folderCover(f) {
  for (const it of f.items || []) {
    const imgs = itemImages(it);
    if (imgs.length) return imgs[0];
  }
  return '';
}

/* 資料夾內所有內容的圖片總張數 */
function folderImageTotal(f) {
  let n = 0;
  for (const it of f.items || []) n += itemImages(it).length;
  return n;
}

/* 資料夾內所有內容的圖片（依內容順序攤平），點進資料夾時顯示全部 */
function folderAllImages(f) {
  const out = [];
  for (const it of f.items || []) for (const u of itemImages(it)) out.push(u);
  return out;
}

/* 地址：填網址就直接開，填文字就自動產生 Google 地圖搜尋連結 */
function addrPill(addr) {
  const s = String(addr || '').trim();
  if (!s) return '';
  if (/^(https?:)?\/\//i.test(s) || s.startsWith('/')) {
    const u = safeUrl(s);
    return `<a class="link-pill wide" href="${esc(u)}" target="_blank" rel="noopener noreferrer">📍 <span class="u">${esc(hostOf(u))}</span> ↗</a>`;
  }
  const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s);
  return `<a class="link-pill wide" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">📍 <span class="u">${esc(s)}</span> 🗺 ↗</a>`;
}

/* 官網連結膠囊 */
function websitePill(web) {
  const u = safeUrl(web);
  if (!u) return '';
  return `<a class="link-pill wide" href="${esc(u)}" target="_blank" rel="noopener noreferrer">🌐 <span class="u">${esc(hostOf(u))}</span> ↗</a>`;
}

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d)) return iso;
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', weekday: 'short' }).format(d);
}

function fmtDateLong(iso) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d)) return iso;
  return new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(d);
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return new Intl.DateTimeFormat(locale(), {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function daysBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  return Math.round((d2 - d1) / 86400000);
}

function money(v, cur) {
  const c = cur || (S && S.meta.baseCurrency) || 'TWD';
  const n = Number(v) || 0;
  const dec = Math.abs(n % 1) < 0.005 ? 0 : 2;
  return (SYMBOL[c] || c + ' ') + n.toLocaleString('en-US', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  });
}

function toBase(amount, cur) {
  const rates = (S && S.meta.usdRates) || {};
  const base = (S && S.meta.baseCurrency) || 'TWD';
  const r = (rates[cur] || 1) / (rates[base] || 1);
  return Number(amount || 0) / r;
}

function rateOf(cur) {
  const rates = (S && S.meta.usdRates) || {};
  const base = (S && S.meta.baseCurrency) || 'TWD';
  return (rates[cur] || 1) / (rates[base] || 1);
}

function catLabel(c) {
  if (!c) return '';
  return CATS.includes(c) ? t('c.' + c) : String(c);
}

function member(id) { return (S.members || []).find((m) => m.id === id) || null; }
function memberName(id) { const m = member(id); return m ? m.name : '—'; }
function memberColor(id) { const m = member(id); return m ? (m.color || '#94a3b8') : '#94a3b8'; }

function avatar(id, size) {
  const m = member(id);
  const nm = m ? m.name : '?';
  const ch = nm.slice(0, 1).toUpperCase();
  const st = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;` : '';
  return `<span class="avatar" style="background:${memberColor(id)};${st}" title="${esc(nm)}">${esc(ch)}</span>`;
}

function chipMember(id, removable) {
  return `<span class="chip"><span class="dot" style="background:${memberColor(id)}"></span>${esc(memberName(id))}` +
    (removable ? `<button data-act="rm-chip" data-id="${id}" title="${esc(t('k.delete'))}">×</button>` : '') + '</span>';
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function setSync(state, txt) {
  const el = $('#syncState');
  el.className = 'sync' + (state === 'saving' ? ' saving' : state === 'error' ? ' error' : '');
  el.textContent = txt;
}

/* ------------------------------ 連結安全閘門 ---------------------- */

/* 進入連結需先輸入關鍵字；通過後才載入資料並顯示完整功能 */
function showGate() {
  const root = $('#gateRoot');
  if (!root || root.dataset.on === '1') return;
  root.dataset.on = '1';
  root.innerHTML = `<div class="gate-mask"><div class="gate-card">
      <div class="gate-logo">🧭</div>
      <h2>${esc(t('gate.brand'))}</h2>
      <p class="muted small">${esc(t('gate.hint'))}</p>
      <form id="gateForm" autocomplete="off">
        <input type="text" id="gateInput" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="${esc(t('gate.placeholder'))}" aria-label="${esc(t('gate.placeholder'))}">
        <button class="btn primary" type="submit">${esc(t('gate.submit'))}</button>
      </form>
      <p class="small lock-err" id="gateErr"></p>
      <p class="muted small gate-tag">${esc(t('gate.tagline'))}</p>
    </div></div>`;
  root.classList.add('show');
  document.body.classList.add('gated');
  const inp = $('#gateInput');
  if (inp && !('ontouchstart' in window)) setTimeout(() => inp.focus(), 90);
}

function hideGate() {
  const root = $('#gateRoot');
  if (!root) return;
  root.classList.remove('show');
  root.innerHTML = '';
  root.dataset.on = '0';
  document.body.classList.remove('gated');
}

async function doGateSubmit() {
  const el = $('#gateInput');
  const err = $('#gateErr');
  if (!el) return;
  const keyword = el.value.trim();
  if (!keyword) return;
  el.disabled = true;
  try {
    if (await Store.checkGate(keyword)) {
      UI.gate = true;
      localStorage.setItem('tp.gate', '1');
      hideGate();
      toast(t('gate.ok'));
      startApp();
      return;
    }
    if (err) err.textContent = t('gate.wrong');
  } catch (_) {
    if (err) err.textContent = t('gate.wrong');
  }
  el.disabled = false;
  el.value = '';
  el.focus();
}

/* ------------------------------ 資料同步 -------------------------- */

/* 閘門憑證失效時回到驗證畫面 */
function gateLost() {
  UI.gate = false;
  localStorage.removeItem('tp.gate');
  showGate();
}

async function fetchState() {
  if (!UI.gate) { showGate(); throw new Error('gate'); }
  return Store.load();
}

async function sendOp(op, opts) {
  UI.saving++;
  setSync('saving', t('sync.saving'));
  try {
    const data = await Store.commit(op, { actorId: UI.me });
    S = data.state;
    if (!opts || !opts.silent) { toast(t('k.saved')); render(); }
    setSync('ok', syncLabel());
    return data.result;
  } catch (err) {
    setSync('error', t('err.generic'));
    toast(t('err.generic') + ' (' + err.message + ')');
    throw err;
  } finally {
    UI.saving--;
  }
}

async function loadState() {
  try {
    S = await fetchState();
    setSync('ok', syncLabel());
    return true;
  } catch (err) {
    setSync('error', t('sync.offline'));
    return false;
  }
}

async function poll() {
  if (UI.saving > 0) return;
  if ($('#modalRoot').children.length) return;
  try {
    const data = await fetchState();
    setSync('ok', syncLabel());
    if (!S || data.version !== S.version || data.locked !== S.locked) { S = data; render(); }
  } catch (_) { setSync('error', t('sync.offline')); }
}

function syncLabel() {
  return (S ? 'v' + S.version + ' · ' : '') + t('sync.online');
}

async function unlockExpenses(password) {
  try {
    if (!(await Store.unlock(password))) return false;
    UI.unlock = true;
    await loadState();
    return true;
  } catch (_) {
    return false;
  }
}

function lockExpenses() {
  UI.unlock = false;
  Store.lock();
  loadState().then(render);
}

async function manualSave() {
  UI.saving++;
  setSync('saving', t('sync.saving'));
  try {
    await Store.save({ actorId: UI.me });
    S = await fetchState();
    refreshSyncPanel();
    toast(t('hist.saved', { n: S.version }));
    render();
  } catch (err) {
    toast(t('err.generic'));
  } finally {
    UI.saving--;
  }
}

/* ------------------------------ 主題 / 語言 ------------------------ */

function applyTheme() {
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = UI.theme === 'dark' || (UI.theme === 'auto' && sysDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-palette', UI.palette);
  $('#themeBtn').textContent = dark ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', UI.palette === 'rose' ? '#D48D95' : '#0f766e');
}

function setPalette(p) {
  UI.palette = p;
  localStorage.setItem('tp.palette', p);
  applyTheme();
}

function setLang(l) {
  UI.lang = l;
  localStorage.setItem('tp.lang', l);
  document.documentElement.setAttribute('lang', l === 'en' ? 'en' : l);
  render();
}

/* ------------------------------ 彈窗 ------------------------------ */

function openModal(opts) {
  const root = $('#modalRoot');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(opts.title || '')}</h3>
        <button class="icon-btn" data-act="close-modal" title="${esc(t('k.close'))}">✕</button>
      </div>
      <div class="modal-body">${opts.body || ''}</div>
      ${opts.foot === null ? '' : `<div class="modal-foot">${opts.foot || ''}</div>`}
    </div>`;
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(); });
  root.appendChild(mask);
  const first = mask.querySelector('input:not([type=hidden]),textarea,select');
  if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 60);
  return mask;
}

function openSettings() {
  closeModal();
  const m = openModal(settingsForm());
  bindSettings(m);
}

function closeModal() {
  const root = $('#modalRoot');
  if (root.lastElementChild) root.removeChild(root.lastElementChild);
}

function confirmDialog(msg, onYes) {
  const m = openModal({
    title: t('k.confirm'),
    body: `<p style="margin:0">${esc(msg)}</p>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn danger" data-act="confirm-yes">${esc(t('k.confirm'))}</button>`,
  });
  m.querySelector('[data-act="confirm-yes"]').addEventListener('click', () => { closeModal(); onYes(); });
}

function val(sel) { const el = $(sel); return el ? el.value.trim() : ''; }
function num(sel) { const el = $(sel); return el ? (Number(el.value) || 0) : 0; }

/* ==================================================================
   渲染
   ================================================================== */

function render() {
  if (!S) return;
  applyTheme();
  $('#tripTitle').textContent = S.meta.title || t('app.name');
  $('#tripSub').textContent = [S.meta.destination, dateRangeText()].filter(Boolean).join(' · ') || t('app.tagline');
  document.title = S.meta.title || t('app.name');

  renderMeSelect();
  renderTabs();
  $('#langSelect').value = UI.lang;

  const view = $('#view');
  let html = '';
  switch (UI.tab) {
    case 'overview': html = viewOverview(); break;
    case 'itinerary': html = viewItinerary(); break;
    case 'expenses': html = S.locked ? viewLocked() : viewExpenses(); break;
    case 'rooms': html = viewRooms(); break;
    case 'folders': html = viewFolders(); break;
    case 'reminders': html = viewReminders(); break;
    case 'members': html = viewMembers(); break;
    default: html = '';
  }
  view.innerHTML = html;
  if (UI.saving === 0) setSync('ok', syncLabel());
  checkDueReminders();
}

/* ------------------------------ 記帳鎖 ---------------------------- */

function viewLocked() {
  return pageHead(t('ex.title'), t('ex.subtitle'), '') +
    `<div class="lockbox">
      <div class="lockicon">🔒</div>
      <h3>${esc(t('lock.title'))}</h3>
      <p class="muted small">${esc(t('lock.hint'))}</p>
      <form id="lockForm" autocomplete="off">
        <input type="password" id="lockPwd" inputmode="numeric" autocomplete="off"
          placeholder="${esc(t('lock.placeholder'))}" aria-label="${esc(t('lock.placeholder'))}">
        <button class="btn primary" type="submit">${esc(t('lock.submit'))}</button>
      </form>
      <p class="small lock-err" id="lockErr"></p>
    </div>`;
}

async function doUnlock() {
  const el = $('#lockPwd');
  const err = $('#lockErr');
  if (!el) return;
  const pwd = el.value.trim();
  if (!pwd) return;
  el.disabled = true;
  const ok = await unlockExpenses(pwd);
  if (ok) {
    toast(t('lock.unlocked'));
    render();
  } else {
    if (err) err.textContent = t('lock.wrong');
    el.disabled = false;
    el.value = '';
    el.focus();
  }
}

/* ------------------------------ 更新歷史 -------------------------- */

const HIST_COL_KEY = {
  members: 'nav.members', itinerary: 'nav.itinerary', expenses: 'nav.expenses',
  rooms: 'nav.rooms', folders: 'nav.folders', reminders: 'nav.reminders',
};
const HIST_ACTION_KEY = {
  add: 'h.add', update: 'h.update', delete: 'h.delete', vote: 'h.vote', unvote: 'h.unvote',
  assign: 'h.assign', meta: 'h.meta', save: 'h.save', seed: 'h.seed', reset: 'h.reset',
  import: 'h.import', itemAdd: 'h.itemAdd', itemUpdate: 'h.itemUpdate', itemDelete: 'h.itemDelete',
};

function q(str) {
  return UI.lang === 'en' ? `"${str}"` : `「${str}」`;
}

function historyText(h) {
  const who = h.actorName || t('hist.system');
  const verb = t(HIST_ACTION_KEY[h.action] || 'h.update');
  const col = h.col && HIST_COL_KEY[h.col] ? ' ' + t(HIST_COL_KEY[h.col]) : '';
  const extra = h.title || h.detail || '';
  return `${who} ${verb}${col}${extra ? ' ' + q(extra) : ''}`;
}

function viewHistory() {
  const list = (S.history || []).slice().reverse();
  const body = list.length
    ? `<div class="hist-list">${list.map((h) => `
        <div class="hist-row">
          <span class="hist-ver">v${h.version}</span>
          <div class="hist-main">
            <div class="hist-text">${esc(historyText(h))}</div>
            <div class="muted small">${esc(fmtDateTime(h.at))}</div>
          </div>
        </div>`).join('')}</div>`
    : `<p class="muted">${esc(t('hist.empty'))}</p>`;

  return {
    title: t('hist.title'),
    wide: true,
    body: `<div class="flex mb12">
        <span class="badge primary">v${S.version}</span>
        <span class="badge">${list.length} ${esc(t('hist.records'))}</span>
        <span class="muted small">${esc(t('st.lastUpdate'))} ${esc(fmtDateTime(S.updatedAt))}</span>
      </div>
      <p class="muted small mb12">${esc(t('st.historyHint'))}</p>${body}`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.close'))}</button>
           <button class="btn primary" data-act="manual-save">${esc(t('st.saveNow'))}</button>`,
  };
}

function refreshSyncPanel() {
  const v = $('#syncVersion');
  if (v) v.textContent = 'v' + S.version;
  const u = $('#syncUpdated');
  if (u) u.textContent = fmtDateTime(S.updatedAt);
  const a = $('#syncActor');
  if (a) a.textContent = lastActorName();
}

function lastActorName() {
  const list = S.history || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].actorName) return list[i].actorName;
  }
  return t('hist.system');
}

function dateRangeText() {
  if (S.meta.dateTbd) return t('ov.dateTbd');
  const a = S.meta.startDate, b = S.meta.endDate;
  if (!a && !b) return '';
  if (a && b) return `${a.replace(/-/g, '/')} – ${b.replace(/-/g, '/')}`;
  return (a || b).replace(/-/g, '/');
}

function isChild(m) { return m && m.type === 'child'; }
function memberStats() {
  const list = S.members || [];
  const adults = list.filter((m) => !isChild(m)).length;
  const children = list.filter(isChild).length;
  const groups = [];
  const map = new Map();
  for (const m of list) {
    const g = (m.group || '').trim() || '__none__';
    if (!map.has(g)) { map.set(g, { name: g, adults: 0, children: 0, members: [] }); groups.push(map.get(g)); }
    const e = map.get(g);
    if (isChild(m)) e.children++; else e.adults++;
    e.members.push(m);
  }
  return { total: list.length, adults, children, groups };
}

function groupLabel(g) {
  return g === '__none__' ? t('mb.ungrouped') : g;
}

function renderMeSelect() {
  const sel = $('#meSelect');
  const cur = UI.me;
  sel.innerHTML = `<option value="">${esc(t('me.choose'))}</option>` +
    (S.members.length
      ? S.members.map((m) => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${esc(m.name)}</option>`).join('')
      : `<option value="" disabled>${esc(t('me.none'))}</option>`);
  if (!member(cur)) UI.me = '';
  sel.value = UI.me;
  $('#meDot').style.background = UI.me ? memberColor(UI.me) : 'var(--line-strong)';
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.map((tb) =>
    `<button class="tab ${UI.tab === tb.id ? 'active' : ''}" data-act="tab" data-tab="${tb.id}">
       <span class="ti">${tb.icon}</span><span>${esc(t(tb.key))}</span>
     </button>`).join('');
}

function emptyBox(icon, text, btn) {
  return `<div class="empty"><span class="big">${icon}</span><div>${esc(text)}</div>${btn || ''}</div>`;
}

function pageHead(title, sub, tools) {
  return `<div class="page-head"><div class="head-row">
    <div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>
    <div class="head-tools">${tools || ''}</div>
  </div></div>`;
}

/* ------------------------------ 總覽 ------------------------------ */

function viewOverview() {
  const cur = S.meta.baseCurrency;
  const totals = expenseTotals();
  const start = S.meta.startDate, end = S.meta.endDate;
  const today = todayISO();
  const locked = !!S.locked;
  const stats = memberStats();

  let countdown = `<span class="chip">${esc(t('ov.noDates'))}</span>`;
  if (S.meta.dateTbd) countdown = `<span class="chip">🗓️ ${esc(t('ov.dateTbd'))}</span>`;
  else if (start) {
    const d = daysBetween(today, start);
    if (end && daysBetween(today, end) < 0) countdown = `<span class="chip">${esc(t('ov.finished'))}</span>`;
    else if (d > 0) countdown = `<span class="chip">🚀 ${esc(t('ov.daysLeft', { n: d }))}</span>`;
    else countdown = `<span class="chip">✨ ${esc(t('ov.started'))}</span>`;
  }

  const beds = (S.rooms || []).reduce((a, r) => a + (Number(r.capacity) || 0), 0);
  const used = (S.rooms || []).reduce((a, r) => a + ((r.memberIds || []).length), 0);

  const upcoming = (S.reminders || [])
    .filter((r) => !r.done)
    .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));

  const hero = `<div class="hero">
    <h2>${esc(S.meta.title || t('app.name'))}</h2>
    <p>${esc(S.meta.destination || t('app.tagline'))}</p>
    <div class="chips">${countdown}
      ${dateRangeText() ? `<span class="chip">📅 ${esc(dateRangeText())}</span>` : ''}
      <span class="chip">👥 ${stats.total} ${esc(t('k.people'))}</span>
      ${stats.children ? `<span class="chip">🧒 ${esc(t('ov.children'))} ${stats.children}</span>` : ''}
    </div>
  </div>`;

  const spendStat = locked
    ? `<div class="stat"><div class="lbl">🔒 ${esc(t('ov.totalSpend'))}</div>
        <div class="val">—</div>
        <div class="hint">${esc(t('lock.locked'))}</div></div>`
    : `<div class="stat accent"><div class="lbl">💸 ${esc(t('ov.totalSpend'))}</div>
        <div class="val">${esc(money(totals.total, cur))}</div>
        <div class="hint">${totals.count} ${esc(t('ex.entries'))}</div></div>`;

  const statsHtml = `<div class="grid cols-3">
    ${spendStat}
    <div class="stat"><div class="lbl">👥 ${esc(t('ov.members'))}</div>
      <div class="val">${stats.total}</div>
      <div class="hint">${esc(t('ov.adults'))} ${stats.adults} · ${esc(t('ov.children'))} ${stats.children}${locked ? '' : ' · ' + esc(t('ov.perPerson')) + ' ' + esc(money(totals.perPerson, cur))}</div></div>
    <div class="stat"><div class="lbl">🗓️ ${esc(t('ov.itineraryCount'))}</div>
      <div class="val">${(S.itinerary || []).length}</div>
      <div class="hint">📁 ${(S.folders || []).length} · 🔔 ${upcoming.length}</div></div>
    <div class="stat"><div class="lbl">🛏️ ${esc(t('ov.roomOccupancy'))}</div>
      <div class="val">${used}<span class="small muted">/${beds || 0}</span></div>
      <div class="hint">${esc(t('rm.unassigned'))} ${Math.max(0, S.members.length - used)} ${esc(t('k.people'))}</div></div>
  </div>`;

  const needSetup = S.members.length === 0
    ? `<div class="card"><div class="card-title"><h3>👋 ${esc(t('ov.needSetup'))}</h3></div>
        <p class="muted small">${esc(t('ov.setupHint'))}</p>
        <div class="flex mt12">
          <button class="btn primary" data-act="add-member">＋ ${esc(t('mb.add'))}</button>
          <button class="btn" data-act="seed">${esc(t('st.seed'))}</button>
        </div></div>`
    : '';

  const quick = `<div class="card">
    <div class="card-title"><h3>⚡ ${esc(t('ov.quickAdd'))}</h3></div>
    <div class="flex">
      <button class="btn" data-act="add-itinerary">🗓️ ${esc(t('it.addItem'))}</button>
      <button class="btn" data-act="add-expense">💰 ${esc(t('ex.add'))}</button>
      <button class="btn" data-act="add-room">🛏️ ${esc(t('rm.add'))}</button>
      <button class="btn" data-act="add-folder">📁 ${esc(t('fd.add'))}</button>
      <button class="btn" data-act="add-reminder">🔔 ${esc(t('re.add'))}</button>
    </div>
  </div>`;

  const remCard = `<div class="card">
    <div class="card-title"><h3>🔔 ${esc(t('ov.nextReminder'))}</h3>
      <button class="btn ghost sm" data-act="tab" data-tab="reminders">${esc(t('k.view'))} ›</button></div>
    ${upcoming.length
      ? `<div class="list">${upcoming.slice(0, 4).map((r) => `
          <div class="row-item">
            <div class="main"><div class="ttl">${esc(r.title)}</div>
              <div class="meta">🕒 ${esc(fmtDateTime(r.datetime))} ${priorityBadge(r.priority)}</div></div>
          </div>`).join('')}</div>`
      : `<p class="muted small">${esc(t('ov.noReminder'))}</p>`}
  </div>`;

  const info = `<div class="card">
    <div class="card-title"><h3>ℹ️ ${esc(t('ov.tripInfo'))}</h3>
      <button class="btn ghost sm" data-act="open-settings">⚙️ ${esc(t('k.settings'))}</button></div>
    <table class="data">
      <tbody>
        <tr><th>${esc(t('ov.destination'))}</th><td>${esc(S.meta.destination || '—')}</td></tr>
        <tr><th>${esc(t('ov.dates'))}</th><td>${esc(dateRangeText() || '—')}</td></tr>
        <tr><th>${esc(t('ov.baseCurrency'))}</th><td>${esc(S.meta.baseCurrency)} ${esc(SYMBOL[S.meta.baseCurrency] || '')}</td></tr>
        <tr><th>${esc(t('st.lastUpdate'))}</th><td>v${S.version} · ${esc(fmtDateTime(S.updatedAt))}</td></tr>
      </tbody>
    </table>
  </div>`;

  const recent = (S.expenses || []).slice(-4).reverse();
  const recentCard = locked
    ? `<div class="card"><div class="card-title"><h3>🔒 ${esc(t('nav.expenses'))}</h3>
         <button class="btn ghost sm" data-act="tab" data-tab="expenses">${esc(t('lock.submit'))} ›</button></div>
       <p class="muted small">${esc(t('lock.unlockToView'))}</p></div>`
    : (recent.length ? `<div class="card">
        <div class="card-title"><h3>💰 ${esc(t('nav.expenses'))}</h3>
          <button class="btn ghost sm" data-act="tab" data-tab="expenses">${esc(t('k.view'))} ›</button></div>
        <table class="data"><tbody>
          ${recent.map((e) => `<tr>
            <td>${esc(e.title)}</td>
            <td class="muted small">${esc(memberName(e.payerId))}</td>
            <td class="num">${esc(money(toBase(e.amount, e.currency), cur))}</td></tr>`).join('')}
        </tbody></table></div>` : '');

  return hero + statsHtml + `<div class="mt16"></div>` + needSetup +
    `<div class="grid cols-2 mt16">${quick}${remCard}</div>
     <div class="grid cols-2 mt16">${info}${recentCard}</div>`;
}

function priorityBadge(p) {
  if (p === 'high') return `<span class="badge danger">${esc(t('re.high'))}</span>`;
  if (p === 'low') return `<span class="badge">${esc(t('re.low'))}</span>`;
  return `<span class="badge primary">${esc(t('re.normal'))}</span>`;
}

/* ------------------------------ 行程 ------------------------------ */

function viewItinerary() {
  const tools = `
    <div class="seg">
      <button class="${UI.itView === 'list' ? 'on' : ''}" data-act="it-view" data-v="list">${esc(t('it.list'))}</button>
      <button class="${UI.itView === 'calendar' ? 'on' : ''}" data-act="it-view" data-v="calendar">${esc(t('it.calendar'))}</button>
    </div>
    <button class="btn primary" data-act="add-itinerary">＋ ${esc(t('it.addItem'))}</button>`;

  let body = '';
  if (UI.itView === 'calendar') body = itCalendar();
  else body = itList();

  return pageHead(t('it.title'), t('it.subtitle'), tools) + body;
}

function itList() {
  let items = (S.itinerary || []).slice();
  if (UI.calSelected) items = items.filter((i) => i.date === UI.calSelected);
  if (!items.length) {
    return emptyBox('🗓️', t('it.empty'),
      `<div class="mt12"><button class="btn primary" data-act="add-itinerary">＋ ${esc(t('it.addItem'))}</button></div>`);
  }
  items.sort((a, b) => (String(a.date) + String(a.time || '')).localeCompare(String(b.date) + String(b.time || '')));
  const groups = {};
  for (const it of items) (groups[it.date || ''] = groups[it.date || ''] || []).push(it);

  let html = '';
  if (UI.calSelected) {
    html += `<div class="flex mb12">
      <span class="badge primary">${esc(fmtDateLong(UI.calSelected))}</span>
      <button class="btn ghost sm" data-act="clear-day">✕ ${esc(t('k.all'))}</button></div>`;
  }
  for (const date of Object.keys(groups).sort()) {
    const isToday = date === todayISO();
    html += `<div class="date-head">
      <span>${esc(date ? fmtDateLong(date) : t('k.none'))}</span>
      ${isToday ? `<span class="badge danger">${esc(t('it.today'))}</span>` : ''}
      <span class="line"></span>
      <span class="badge">${groups[date].length} ${esc(t('it.items'))}</span>
    </div>`;
    html += `<div class="list">${groups[date].map(itRow).join('')}</div>`;
  }
  return html;
}

function itRow(it) {
  const voted = (it.votes || []).includes(UI.me);
  const vc = (it.votes || []).length;
  const links = (it.links || []).filter((l) => l && l.url);
  return `<div class="row-item">
    <div class="main">
      <div class="ttl">
        ${it.time ? `<span class="badge primary">${esc(it.time)}</span>` : ''}
        <span>${esc(it.title)}</span>
        ${it.category ? `<span class="badge">${esc(catLabel(it.category))}</span>` : ''}
      </div>
      ${it.location ? `<div class="meta">📍 ${esc(it.location)}</div>` : ''}
      ${it.note ? `<div class="desc">${esc(it.note)}</div>` : ''}
      ${links.length ? `<div class="chips mt8">${links.map((l) =>
        `<a class="link-pill" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">🔗 <span class="u">${esc(l.label || hostOf(l.url))}</span></a>`).join('')}</div>` : ''}
      ${vc ? `<div class="chips mt8">${(it.votes || []).map((v) => chipMember(v)).join('')}</div>` : ''}
    </div>
    <div class="side">
      <button class="vote-btn ${voted ? 'on' : ''}" data-act="vote-it" data-id="${it.id}">
        ${voted ? '★' : '☆'} ${esc(t('it.vote'))} ${vc ? `<b>${vc}</b>` : ''}
      </button>
      <div class="ops">
        <button class="btn ghost sm" data-act="edit-itinerary" data-id="${it.id}">${esc(t('k.edit'))}</button>
        <button class="btn ghost sm" data-act="del" data-col="itinerary" data-id="${it.id}">🗑</button>
      </div>
    </div>
  </div>`;
}

function defaultCalMonth() {
  const today = todayISO().slice(0, 7);
  const s = S.meta.startDate ? S.meta.startDate.slice(0, 7) : '';
  const e = S.meta.endDate ? S.meta.endDate.slice(0, 7) : '';
  if (s && s > today) return s;
  if (e && e < today) return e;
  return today;
}

function itCalendar() {
  const month = UI.calMonth || defaultCalMonth();
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();

  const byDate = {};
  for (const it of (S.itinerary || [])) (byDate[it.date] = byDate[it.date] || []).push(it);

  const monthLabel = new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long' }).format(first);
  const dows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 7 + i);
    dows.push(new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(d));
  }

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startDow + 1;
    let dateStr, out = false, label;
    if (dayNum < 1) { label = prevDays + dayNum; out = true; dateStr = ''; }
    else if (dayNum > daysInMonth) { label = dayNum - daysInMonth; out = true; dateStr = ''; }
    else { label = dayNum; dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`; }
    if (i >= 35 && out && dayNum > daysInMonth + 6) break;

    const evts = dateStr ? (byDate[dateStr] || []) : [];
    const isToday = dateStr === todayISO();
    const sel = dateStr && dateStr === UI.calSelected;
    cells += `<div class="cal-cell ${out ? 'out' : ''} ${isToday ? 'today' : ''} ${sel ? 'sel' : ''}"
        ${dateStr ? `data-act="cal-day" data-date="${dateStr}"` : ''}>
      <span class="d">${label}</span>
      <span class="dots">${evts.slice(0, 4).map((e) => `<i style="background:${CAT_COLOR[e.category] || 'var(--primary)'}"></i>`).join('')}</span>
      ${evts.length ? `<span class="cnt">${evts.length}${evts.length > 4 ? '+' : ''}</span>` : ''}
    </div>`;
  }

  return `<div class="card">
    <div class="cal-head">
      <button class="icon-btn" data-act="cal-prev">‹</button>
      <span class="m">${esc(monthLabel)}</span>
      <button class="icon-btn" data-act="cal-next">›</button>
    </div>
    <div class="cal-grid">
      ${dows.map((d) => `<div class="cal-dow">${esc(d)}</div>`).join('')}
      ${cells}
    </div>
  </div>
  <div class="mt16">${itList()}</div>`;
}

/* ------------------------------ 記帳 ------------------------------ */

function expenseTotals() {
  const cur = S.meta.baseCurrency;
  const list = S.expenses || [];
  let total = 0;
  const byCat = {};
  const paid = {}, share = {};
  for (const m of S.members) { paid[m.id] = 0; share[m.id] = 0; }

  for (const e of list) {
    const base = toBase(e.amount, e.currency);
    total += base;
    const c = e.category || 'other';
    byCat[c] = (byCat[c] || 0) + base;
    if (e.payerId && paid[e.payerId] !== undefined) paid[e.payerId] += base;
    const parts = (e.participantIds && e.participantIds.length)
      ? e.participantIds.filter((p) => share[p] !== undefined)
      : S.members.map((m) => m.id);
    if (parts.length) {
      const each = base / parts.length;
      for (const p of parts) share[p] += each;
    }
  }
  const n = S.members.length;
  return {
    total, count: list.length, byCat, paid, share,
    perPerson: n ? Math.round(total / n) : 0,
    base: cur,
  };
}

function viewExpenses() {
  const totals = expenseTotals();
  const cur = S.meta.baseCurrency;

  /* 兩種檢視：1. 已支出　2. 預算花費 */
  const seg = `<div class="seg">
      <button class="${UI.exView === 'actual' ? 'on' : ''}" data-act="ex-view" data-v="actual">💸 ${esc(t('ex.tabActual'))}</button>
      <button class="${UI.exView === 'budget' ? 'on' : ''}" data-act="ex-view" data-v="budget">🎯 ${esc(t('ex.tabBudget'))}</button>
    </div>`;

  const tools = seg + (UI.exView === 'budget'
    ? `<button class="btn primary" data-act="add-budget">＋ ${esc(t('bg.add'))}</button>`
    : `<button class="btn" data-act="export-csv">⬇ ${esc(t('ex.exportCsv'))}</button>
       <button class="btn primary" data-act="add-expense">＋ ${esc(t('ex.add'))}</button>`);

  if (UI.exView === 'budget') {
    return pageHead(t('ex.title'), t('ex.subtitle'), tools) + budgetBody();
  }

  if (!(S.expenses || []).length) {
    return pageHead(t('ex.title'), t('ex.subtitle'), tools) +
      emptyBox('💰', t('ex.empty'),
        `<div class="mt12"><button class="btn primary" data-act="add-expense">＋ ${esc(t('ex.add'))}</button></div>`);
  }

  // 分類甜甜圈
  const parts = Object.keys(totals.byCat)
    .map((k) => ({ key: k, value: totals.byCat[k], color: CAT_COLOR[k] || '#94a3b8' }))
    .sort((a, b) => b.value - a.value);
  const donut = donutSVG(parts, totals.total, 158, 24, money(totals.total, cur));

  // 每人代墊/應付
  const maxVal = Math.max(1, ...S.members.map((m) => Math.max(totals.paid[m.id] || 0, totals.share[m.id] || 0)));
  const bars = S.members.map((m) => {
    const p = totals.paid[m.id] || 0, s = totals.share[m.id] || 0;
    return `<div class="bar-row">
      <span class="nm" title="${esc(m.name)}">${esc(m.name)}</span>
      <span class="bar-track">
        <span class="bar-fill paid" style="width:${(p / maxVal * 100).toFixed(1)}%"></span>
      </span>
      <span class="vl">${esc(money(p, cur))}</span>
    </div>
    <div class="bar-row">
      <span class="nm small muted">${esc(t('ex.share'))}</span>
      <span class="bar-track">
        <span class="bar-fill share" style="width:${(s / maxVal * 100).toFixed(1)}%"></span>
      </span>
      <span class="vl">${esc(money(s, cur))}</span>
    </div>`;
  }).join('');

  const settleList = settlement(totals);

  const settleCard = `<div class="card">
    <div class="card-title"><h3>🧾 ${esc(t('ex.settle'))}</h3></div>
    ${settleList.length
      ? `<p class="muted small mb12">${esc(t('ex.settleHint'))}</p>
         <div class="list">${settleList.map((tr) => `
          <div class="row-item">
            <div class="main">
              <div class="ttl">${avatar(tr.from)} ${esc(memberName(tr.from))}
                <span class="muted">→</span> ${avatar(tr.to)} ${esc(memberName(tr.to))}</div>
            </div>
            <div class="side"><span class="amount neg">${esc(money(tr.amount, cur))}</span></div>
          </div>`).join('')}</div>`
      : `<p class="muted small">✅ ${esc(t('ex.settled'))}</p>`}
  </div>`;

  const listHtml = (S.expenses || []).slice().sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))).map(expRow).join('');

  return pageHead(t('ex.title'), t('ex.subtitle'), tools) +
    `<div class="grid cols-3">
      <div class="stat accent"><div class="lbl">${esc(t('k.total'))}</div>
        <div class="val">${esc(money(totals.total, cur))}</div>
        <div class="hint">${totals.count} ${esc(t('ex.entries'))}</div></div>
      <div class="stat"><div class="lbl">${esc(t('ov.perPerson'))}</div>
        <div class="val">${esc(money(totals.perPerson, cur))}</div>
        <div class="hint">${S.members.length} ${esc(t('k.people'))}</div></div>
      <div class="stat"><div class="lbl">${esc(t('ov.baseCurrency'))}</div>
        <div class="val">${esc(cur)}</div>
        <div class="hint">${esc(SYMBOL[cur] || '')}</div></div>
    </div>

    <div class="grid cols-2 mt16">
      <div class="card"><div class="card-title"><h3>🍩 ${esc(t('ex.byCategory'))}</h3></div>
        <div class="donut-wrap">${donut}
          <div class="legend">${parts.map((p) => `
            <div class="legend-row"><span class="sw" style="background:${p.color}"></span>
              <span class="nm">${esc(t('c.' + p.key))}</span>
              <span class="vl">${esc(money(p.value, cur))} · ${(p.value / (totals.total || 1) * 100).toFixed(0)}%</span>
            </div>`).join('')}</div>
        </div>
      </div>
      <div class="card"><div class="card-title"><h3>📊 ${esc(t('ex.byMember'))}</h3></div>
        <div class="flex small muted mb12">
          <span class="chip"><span class="dot" style="background:var(--primary)"></span>${esc(t('ex.paid'))}</span>
          <span class="chip"><span class="dot" style="background:var(--accent)"></span>${esc(t('ex.share'))}</span>
        </div>
        ${bars}
      </div>
    </div>

    <div class="grid cols-2 mt16">${settleCard}
      <div class="card"><div class="card-title"><h3>👛 ${esc(t('ex.balance'))}</h3></div>
        <div class="scroll-x"><table class="data">
          <thead><tr><th>${esc(t('k.name'))}</th><th class="num">${esc(t('ex.paid'))}</th>
            <th class="num">${esc(t('ex.share'))}</th><th class="num">${esc(t('ex.balance'))}</th></tr></thead>
          <tbody>${S.members.map((m) => {
            const b = (totals.paid[m.id] || 0) - (totals.share[m.id] || 0);
            return `<tr><td>${avatar(m.id)} ${esc(m.name)}</td>
              <td class="num">${esc(money(totals.paid[m.id] || 0, cur))}</td>
              <td class="num">${esc(money(totals.share[m.id] || 0, cur))}</td>
              <td class="num ${b >= 0 ? 'amount pos' : 'amount neg'}">${esc(money(Math.abs(b), cur))} ${b >= 0 ? t('ex.owed') : t('ex.owes')}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card mt16"><div class="card-title"><h3>📒 ${esc(t('nav.expenses'))}</h3></div>
      <div class="list">${listHtml}</div></div>`;
}

function expRow(e) {
  const cur = S.meta.baseCurrency;
  const base = toBase(e.amount, e.currency);
  const parts = (e.participantIds || []);
  return `<div class="row-item">
    <div class="main">
      <div class="ttl">${esc(e.title)} ${e.category ? `<span class="badge">${esc(catLabel(e.category))}</span>` : ''}</div>
      <div class="meta">📅 ${esc(fmtDate(e.date))} · ${esc(t('ex.payer'))}：${esc(memberName(e.payerId))}</div>
      ${parts.length ? `<div class="chips mt8">${parts.map((p) => chipMember(p)).join('')}</div>` : ''}
      ${e.note ? `<div class="desc">${esc(e.note)}</div>` : ''}
      ${e.receipt ? `<div class="mt8"><img src="${esc(e.receipt)}" alt="receipt" style="max-height:110px;border-radius:8px;cursor:zoom-in" data-act="zoom" data-src="${esc(e.receipt)}"></div>` : ''}
    </div>
    <div class="side">
      <span class="amount">${esc(money(e.amount, e.currency))}</span>
      ${e.currency !== cur ? `<span class="small muted">≈ ${esc(money(base, cur))}</span>` : ''}
      <div class="ops">
        <button class="btn ghost sm" data-act="edit-expense" data-id="${e.id}">${esc(t('k.edit'))}</button>
        <button class="btn ghost sm" data-act="del" data-col="expenses" data-id="${e.id}">🗑</button>
      </div>
    </div>
  </div>`;
}

/* ------------------------------ 預算花費 -------------------------- */

function budgetTotals() {
  const list = S.budgets || [];
  const groups = [];
  const map = new Map();
  let total = 0;
  for (const b of list) {
    const base = toBase(b.amount, b.currency);
    total += base;
    const g = String(b.group || '').trim() || '__none__';
    if (!map.has(g)) { const e = { name: g, items: [], sum: 0 }; map.set(g, e); groups.push(e); }
    const e = map.get(g);
    e.items.push(b);
    e.sum += base;
  }
  return { total, count: list.length, groups, base: S.meta.baseCurrency };
}

function budgetBody() {
  const bt = budgetTotals();
  const cur = bt.base;
  const spent = expenseTotals().total;
  const diff = bt.total - spent;
  const over = diff < 0;
  const pct = bt.total ? Math.min(100, Math.round(spent / bt.total * 100)) : 0;

  const head = `<div class="grid cols-3 mb12">
      <div class="stat accent"><div class="lbl">🎯 ${esc(t('bg.total'))}</div>
        <div class="val">${esc(money(bt.total, cur))}</div>
        <div class="hint">${bt.count} ${esc(t('bg.count'))} · ${bt.groups.length} ${esc(t('bg.groups'))}</div></div>
      <div class="stat"><div class="lbl">💸 ${esc(t('bg.actual'))}</div>
        <div class="val">${esc(money(spent, cur))}</div>
        <div class="hint">${(S.expenses || []).length} ${esc(t('ex.entries'))}</div></div>
      <div class="stat"><div class="lbl">${over ? '⚠️' : '✅'} ${esc(over ? t('bg.over') : t('bg.remain'))}</div>
        <div class="val ${over ? 'amount neg' : ''}">${esc(money(Math.abs(diff), cur))}</div>
        <div class="hint">${esc(t('bg.compare'))}</div></div>
    </div>`;

  const bar = bt.total ? `<div class="card mb12">
      <div class="card-title"><h3>📊 ${esc(t('bg.compare'))}</h3>
        <span class="badge ${over ? 'danger' : 'ok'}">${pct}%</span></div>
      <div class="progress"><i style="width:${pct}%${over ? ';background:var(--danger)' : ''}"></i></div>
      <div class="flex small muted mt8">
        <span>💸 ${esc(t('bg.actual'))} ${esc(money(spent, cur))}</span>
        <span class="spacer"></span>
        <span>🎯 ${esc(t('bg.budget'))} ${esc(money(bt.total, cur))}</span></div>
    </div>` : '';

  if (!bt.count) {
    return head + emptyBox('🎯', t('bg.empty'),
      `<div class="mt12"><button class="btn primary" data-act="add-budget">＋ ${esc(t('bg.add'))}</button></div>`);
  }

  const groupCards = bt.groups.map((g) => {
    const rows = g.items.map((b) => `<div class="row-item">
        <div class="main">
          <div class="ttl">${esc(b.name)}</div>
          ${b.note ? `<div class="meta">${esc(b.note)}</div>` : ''}
        </div>
        <div class="side">
          <span class="amount">${esc(money(b.amount, b.currency))}</span>
          ${b.currency !== cur ? `<span class="small muted">≈ ${esc(money(toBase(b.amount, b.currency), cur))}</span>` : ''}
          <div class="ops">
            <button class="btn ghost sm" data-act="edit-budget" data-id="${b.id}">${esc(t('k.edit'))}</button>
            <button class="btn ghost sm" data-act="del-budget" data-id="${b.id}">🗑</button>
          </div>
        </div>
      </div>`).join('');
    return `<div class="card">
      <div class="card-title"><h3>🏷️ ${esc(g.name === '__none__' ? t('bg.ungrouped') : g.name)}</h3>
        <span class="badge primary">${esc(t('bg.subtotal'))} ${esc(money(g.sum, cur))}</span></div>
      <div class="list">${rows}</div>
    </div>`;
  }).join('');

  return head + bar + `<div class="grid cols-2">${groupCards}</div>`;
}

function settlement(totals) {
  const bal = S.members.map((m) => ({
    id: m.id,
    v: (totals.paid[m.id] || 0) - (totals.share[m.id] || 0),
  })).filter((x) => Math.abs(x.v) > 0.5);

  const debtors = bal.filter((x) => x.v < 0).map((x) => ({ ...x, v: -x.v })).sort((a, b) => b.v - a.v);
  const creditors = bal.filter((x) => x.v > 0).map((x) => ({ ...x })).sort((a, b) => b.v - a.v);

  const out = [];
  let i = 0, j = 0;
  let guard = 0;
  while (i < debtors.length && j < creditors.length && guard++ < 500) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0.5) out.push({ from: debtors[i].id, to: creditors[j].id, amount: amt });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v <= 0.5) i++;
    if (creditors[j].v <= 0.5) j++;
  }
  return out;
}

function donutSVG(parts, total, size, thickness, centerText) {
  const c = size / 2;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  let segs = '';
  if (!total) {
    segs = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${thickness}"/>`;
  } else {
    for (const p of parts) {
      const frac = p.value / total;
      const dash = frac * circ;
      segs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${thickness}"
        stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
        stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
      acc += dash;
    }
  }
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${segs}
    <text x="${c}" y="${c + 5}" text-anchor="middle" class="big-num">${esc(centerText || '')}</text>
  </svg>`;
}

/* ------------------------------ 房間 ------------------------------ */

function viewRooms() {
  const rooms = S.rooms || [];
  const assigned = new Set();
  for (const r of rooms) for (const m of (r.memberIds || [])) assigned.add(m);
  const free = S.members.filter((m) => !assigned.has(m.id));

  const tools = `<button class="btn primary" data-act="add-room">＋ ${esc(t('rm.add'))}</button>`;

  if (!rooms.length) {
    return pageHead(t('rm.title'), t('rm.subtitle'), tools) +
      emptyBox('🛏️', t('rm.empty'),
        `<div class="mt12"><button class="btn primary" data-act="add-room">＋ ${esc(t('rm.add'))}</button></div>`);
  }

  const freeCard = `<div class="card">
    <div class="card-title"><h3>🧳 ${esc(t('rm.unassigned'))} · ${free.length}</h3></div>
    ${free.length
      ? `<div class="chips">${free.map((m) => `<span class="chip"><span class="dot" style="background:${m.color || '#94a3b8'}"></span>${esc(m.name)}</span>`).join('')}</div>`
      : `<p class="muted small">✅ ${esc(t('rm.allAssigned'))}</p>`}
  </div>`;

  const cards = rooms.map((r) => {
    const ids = r.memberIds || [];
    const cap = Number(r.capacity) || 2;
    const slots = [];
    for (let i = 0; i < Math.max(cap, ids.length); i++) {
      if (ids[i]) {
        const mm = member(ids[i]);
        slots.push(`<div class="member-slot">${avatar(ids[i], 22)}
          <span class="nm">${esc(memberName(ids[i]))}${isChild(mm) ? ` <span class="badge warn">🧒 ${esc(t('mb.child'))}</span>` : ''}</span>
          <button class="btn ghost sm" data-act="unassign" data-room="${r.id}" data-id="${ids[i]}" title="${esc(t('rm.remove'))}">✕</button></div>`);
      } else {
        slots.push(`<div class="member-slot empty-slot">＋ <span class="nm">${esc(t('k.empty'))}</span></div>`);
      }
    }
    const full = ids.length >= cap;
    return `<div class="card room-card">
      <div class="rh">
        <div>
          <div class="rname">🛏️ ${esc(r.name)}</div>
          <div class="small muted">${esc(r.type || '')} ${r.note ? '· ' + esc(r.note) : ''}</div>
        </div>
        <div class="flex">
          <span class="badge ${full ? 'ok' : 'primary'}">${esc(t('rm.occupancy', { used: ids.length, cap }))}</span>
        </div>
      </div>
      <div class="progress"><i style="width:${Math.min(100, ids.length / cap * 100)}%"></i></div>
      <div class="list">${slots.join('')}</div>
      <div class="flex">
        <button class="btn sm" data-act="assign" data-room="${r.id}" ${full ? 'disabled' : ''}>＋ ${esc(t('rm.assign'))}</button>
        <span class="spacer"></span>
        <button class="btn ghost sm" data-act="edit-room" data-id="${r.id}">${esc(t('k.edit'))}</button>
        <button class="btn ghost sm" data-act="del" data-col="rooms" data-id="${r.id}">🗑</button>
      </div>
    </div>`;
  }).join('');

  return pageHead(t('rm.title'), t('rm.subtitle'), tools) +
    freeCard + `<div class="grid cards mt16">${cards}</div>`;
}

/* ------------------------------ 資料夾 ------------------------------ */

function viewFolders() {
  const folders = S.folders || [];

  if (UI.openFolder) {
    const f = folders.find((x) => x.id === UI.openFolder);
    if (!f) { UI.openFolder = null; return viewFolders(); }
    return folderDetail(f);
  }

  const tools = `<button class="btn primary" data-act="add-folder">＋ ${esc(t('fd.add'))}</button>`;

  if (!folders.length) {
    return pageHead(t('fd.title'), t('fd.subtitle'), tools) +
      emptyBox('📁', t('fd.empty'),
        `<div class="mt12"><button class="btn primary" data-act="add-folder">＋ ${esc(t('fd.add'))}</button></div>`);
  }

  const cats = Array.from(new Set(folders.map((f) => f.category).filter(Boolean)));
  const filterBar = cats.length ? `<div class="flex mb12">
    <button class="check-item ${!UI.folderCat ? 'on' : ''}" data-act="folder-cat" data-cat="">${esc(t('k.all'))}</button>
    ${cats.map((c) => `<button class="check-item ${UI.folderCat === c ? 'on' : ''}" data-act="folder-cat" data-cat="${esc(c)}">${esc(catLabel(c))}</button>`).join('')}
  </div>` : '';

  const shown = UI.folderCat ? folders.filter((f) => f.category === UI.folderCat) : folders;

  const cards = shown.map((f) => {
    const items = f.items || [];
    const cover = folderCover(f);
    const imgTotal = folderImageTotal(f);
    const cat = catLabel(f.category);
    return `<div class="card folder-card" data-act="open-folder" data-id="${f.id}">
      <div class="folder-cover">${cover ? `<img src="${esc(cover)}" alt="">` : '📁'}
        ${imgTotal > 1 ? `<span class="cover-count">🖼 ${imgTotal}</span>` : ''}</div>
      <div class="card-title" style="margin-bottom:4px">
        <h3 style="font-size:14.5px">${esc(f.name)}</h3>
        ${cat ? `<span class="badge primary">${esc(cat)}</span>` : ''}
      </div>
      <p class="muted small clamp-2" style="margin:0 0 8px">${esc(f.note || '')}</p>
      <div class="flex small muted">
        <span>🖼 ${imgTotal}</span>
        <span class="spacer"></span>
        <span>${items.length} ${esc(t('fd.items'))}</span>
      </div>
      <div class="flex mt8" style="align-items:center">
        <span class="spacer"></span>
        <button class="btn ghost sm" data-act="open-folder" data-id="${f.id}">👁 ${esc(t('k.view'))}</button>
      </div>
    </div>`;
  }).join('');

  const adminHint = isAdmin()
    ? `<span class="badge ok">🔓 ${esc(t('adm.unlocked'))}</span>`
    : `<span class="admin-hint">🔒 ${esc(t('adm.editLocked'))}</span>`;

  return pageHead(t('fd.title'), t('fd.subtitle'), tools) + filterBar +
    `<div class="mb12">${adminHint}</div>` +
    `<div class="grid cards">${cards}</div>`;
}

function folderDetail(f) {
  const cat = catLabel(f.category);
  let items = (f.items || []).slice();
  if (UI.sortByVotes) items.sort((a, b) => (b.votes || []).length - (a.votes || []).length);
  else items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  const tiles = items.map((it) => folderTile(f, it)).join('');

  /* 這裡原本有一張「🖼 圖片」彙總卡（列出資料夾內全部圖片與張數）。
     圖片改為只在點「查看」進入內容後顯示，故此彙總卡移除。 */

  return `<div class="page-head"><div class="head-row">
      <div>
        <button class="btn ghost sm mb8" data-act="back-folders">‹ ${esc(t('fd.back'))}</button>
        <h2>📁 ${esc(f.name)}</h2>
        <p>${cat ? esc(cat) + ' · ' : ''}${esc(f.note || '')} · ${items.length} ${esc(t('fd.items'))}</p>
      </div>
      <div class="head-tools">
        <button class="btn ${UI.sortByVotes ? 'primary' : ''}" data-act="sort-votes">🔀 ${esc(t('fd.sortByVotes'))}</button>
        <button class="btn primary" data-act="add-folder-item" data-folder="${f.id}">＋ ${esc(t('fd.addItem'))}</button>
      </div>
    </div></div>
    ${items.length ? `<div class="gallery">${tiles}</div>`
      : emptyBox('🗂️', t('fd.noItem'),
        `<div class="mt12"><button class="btn primary" data-act="add-folder-item" data-folder="${f.id}">＋ ${esc(t('fd.addItem'))}</button></div>`)}
    <div class="flex mt16">
      <button class="btn ghost sm" data-act="edit-folder" data-id="${f.id}">✎ ${esc(t('fd.editTitle'))}</button>
      <button class="btn ghost sm" data-act="del" data-col="folders" data-id="${f.id}">🗑 ${esc(t('k.delete'))}</button>
    </div>`;
}

function folderTile(f, it) {
  const votes = (it.votes || []);
  const voted = votes.includes(UI.me);
  const cat = catLabel(f.category);
  const imgs = itemImages(it);
  const cover = imgs[0] || '';
  const addr = String(it.address || '').trim();
  const web = String(it.website || '').trim();

  const head = cover
    ? `<div class="thumb-wrap">
         <img class="thumb" src="${esc(cover)}" alt="${esc(it.title || '')}"
           data-act="open-item" data-folder="${f.id}" data-item="${it.id}">
         ${imgs.length > 1 ? `<span class="cover-count">🖼 ${imgs.length}</span>` : ''}
       </div>`
    : `<div style="padding:14px 14px 0;font-size:26px">${it.type === 'link' ? '🔗' : '📝'}</div>`;

  const links = (addr || web)
    ? `<div class="tile-links">${addrPill(addr)}${websitePill(web)}</div>`
    : '';

  return `<div class="tile">
    ${head}
    <div class="body">
      <div class="ttl">${esc(it.title || (it.type === 'image' ? t('fd.typeImage') : t('fd.typeText')))}</div>
      ${it.text ? `<div class="txt clamp-3">${esc(it.text)}</div>` : ''}
      ${links}
      ${cat ? `<div><span class="badge">${esc(cat)}</span></div>` : ''}
      <div class="foot">
        <span class="spacer"></span>
        <button class="btn ghost sm" data-act="open-item" data-folder="${f.id}" data-item="${it.id}">👁 ${esc(t('k.view'))}</button>
        <button class="vote-btn ${voted ? 'on' : ''}" data-act="vote-item" data-folder="${f.id}" data-item="${it.id}">
          ${voted ? '★' : '☆'} ${votes.length || ''}
        </button>
      </div>
      ${votes.length ? `<div class="chips">${votes.map((v) => chipMember(v)).join('')}</div>` : ''}
      <div class="ops flex">
        <span class="spacer"></span>
        <button class="btn ghost sm" data-act="edit-folder-item" data-folder="${f.id}" data-item="${it.id}">${esc(t('k.edit'))}</button>
        <button class="btn ghost sm" data-act="del-item" data-folder="${f.id}" data-item="${it.id}">🗑</button>
      </div>
    </div>
  </div>`;
}

/* 點「查看」後顯示完整內容：全部圖片 + 完整文字（列表上只看得到截斷版本） */
function itemDetailForm(f, it) {
  const imgs = itemImages(it);
  const addr = String(it.address || '').trim();
  const web = String(it.website || '').trim();
  const votes = it.votes || [];
  const voted = votes.includes(UI.me);
  const links = (addr || web)
    ? `<div class="mt12 flex" style="flex-wrap:wrap;gap:8px">${addrPill(addr)}${websitePill(web)}</div>`
    : '';

  return {
    title: it.title || t('fd.itemTitle'),
    wide: true,
    body: `${imgs.length ? `<div class="folder-gallery mb12">${imgs.map((u) =>
          `<img src="${esc(u)}" alt="" data-act="zoom" data-src="${esc(u)}">`).join('')}</div>` : ''}
      <div class="card-title" style="margin-bottom:6px"><h3>📄 ${esc(t('fd.fullText'))}</h3>
        ${imgs.length > 1 ? `<span class="badge">🖼 ${imgs.length}</span>` : ''}</div>
      ${it.text
        ? `<div class="detail-text">${esc(it.text)}</div>`
        : `<p class="muted small" style="margin:0">${esc(t('fd.noText'))}</p>`}
      ${links}
      <div class="mt12 flex" style="align-items:center;gap:8px;flex-wrap:wrap">
        <button class="vote-btn ${voted ? 'on' : ''}" data-act="vote-item" data-folder="${f.id}" data-item="${it.id}">
          ${voted ? '★' : '☆'} ${votes.length || ''}
        </button>
        <span class="muted small">${esc(t('fd.votes'))}</span>
        <span class="spacer"></span>
        ${votes.length ? `<span class="chips">${votes.map((v) => chipMember(v)).join('')}</span>` : ''}
      </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.close'))}</button>
           <button class="btn" data-act="edit-folder-item" data-folder="${f.id}" data-item="${it.id}">✎ ${esc(t('k.edit'))}</button>
           <button class="btn danger" data-act="del-item" data-folder="${f.id}" data-item="${it.id}">🗑 ${esc(t('k.delete'))}</button>`,
  };
}

/* ------------------------------ 提醒 ------------------------------ */

function viewReminders() {
  let list = (S.reminders || []).slice();
  if (!UI.showDone) list = list.filter((r) => !r.done);
  list.sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));

  const tools = `
    <button class="btn" data-act="toggle-done">${UI.showDone ? '🙈 ' + esc(t('re.hideDone')) : '👁 ' + esc(t('re.showDone'))}</button>
    <button class="btn primary" data-act="add-reminder">＋ ${esc(t('re.add'))}</button>`;

  if (!list.length) {
    return pageHead(t('re.title'), t('re.subtitle'), tools) +
      emptyBox('🔔', t('re.empty'),
        `<div class="mt12"><button class="btn primary" data-act="add-reminder">＋ ${esc(t('re.add'))}</button></div>`);
  }

  const rows = list.map((r) => {
    const d = dueText(r.datetime);
    return `<div class="row-item rem-item ${r.done ? 'done' : ''}">
      <span class="prio ${r.priority || 'normal'}"></span>
      <button class="cb ${r.done ? 'on' : ''}" data-act="toggle-rem" data-id="${r.id}">✓</button>
      <div class="main">
        <div class="ttl">${esc(r.title)} ${r.done ? `<span class="badge ok">${esc(t('re.completed'))}</span>` : ''}</div>
        <div class="meta">🕒 ${esc(fmtDateTime(r.datetime))} · <span class="${d.cls}">${esc(d.text)}</span> ${priorityBadge(r.priority)}</div>
        ${r.note ? `<div class="desc">${esc(r.note)}</div>` : ''}
      </div>
      <div class="side"><div class="ops">
        <button class="btn ghost sm" data-act="edit-reminder" data-id="${r.id}">${esc(t('k.edit'))}</button>
        <button class="btn ghost sm" data-act="del" data-col="reminders" data-id="${r.id}">🗑</button>
      </div></div>
    </div>`;
  }).join('');

  const pending = (S.reminders || []).filter((r) => !r.done).length;
  return pageHead(t('re.title'), t('re.subtitle'), tools) +
    `<div class="grid cols-3 mb12">
      <div class="stat"><div class="lbl">⏳ ${esc(t('re.pending'))}</div><div class="val">${pending}</div></div>
      <div class="stat"><div class="lbl">✅ ${esc(t('re.completed'))}</div>
        <div class="val">${(S.reminders || []).filter((r) => r.done).length}</div></div>
      <div class="stat"><div class="lbl">⚠️ ${esc(t('re.overdueLabel'))}</div>
        <div class="val">${(S.reminders || []).filter((r) => !r.done && isOverdue(r.datetime)).length}</div></div>
    </div>
    <div class="list">${rows}</div>`;
}

function isOverdue(dt) {
  if (!dt) return false;
  const d = new Date(dt);
  return !isNaN(d) && d.getTime() < Date.now();
}

function dueText(dt) {
  if (!dt) return { text: '', cls: '' };
  const d = new Date(dt);
  if (isNaN(d)) return { text: dt, cls: '' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff < 0) return { text: t('re.overdue', { n: Math.abs(diff) }), cls: 'badge danger' };
  if (diff === 0) return { text: t('re.today'), cls: 'badge danger' };
  if (diff === 1) return { text: t('re.tomorrow'), cls: 'badge warn' };
  return { text: t('re.inDays', { n: diff }), cls: 'badge' };
}

function checkDueReminders() {
  const due = (S.reminders || []).filter((r) => !r.done && isOverdue(r.datetime) && !notified.has(r.id));
  if (!due.length) return;
  for (const r of due) notified.add(r.id);
  localStorage.setItem('tp.notified', JSON.stringify(Array.from(notified).slice(-200)));
  toast('🔔 ' + due[0].title);
}

/* ------------------------------ 成員 ------------------------------ */

function memberBadges(m) {
  const out = [];
  if (isChild(m)) out.push(`<span class="badge warn">🧒 ${esc(t('mb.child'))}</span>`);
  else out.push(`<span class="badge">${esc(t('mb.adult'))}</span>`);
  if (m.group) out.push(`<span class="badge primary">${esc(m.group)}</span>`);
  return out.join(' ');
}

function viewMembers() {
  const tools = `<button class="btn primary" data-act="add-member">＋ ${esc(t('mb.add'))}</button>`;
  if (!S.members.length) {
    return pageHead(t('mb.title'), t('mb.subtitle'), tools) +
      emptyBox('👥', t('mb.empty'),
        `<div class="mt12"><button class="btn primary" data-act="add-member">＋ ${esc(t('mb.add'))}</button></div>`);
  }
  const totals = expenseTotals();
  const cur = S.meta.baseCurrency;
  const locked = !!S.locked;
  const st = memberStats();

  const rows = S.members.map((m) => {
    const assignedRooms = (S.rooms || []).filter((r) => (r.memberIds || []).includes(m.id)).map((r) => r.name);
    const votes = (S.itinerary || []).filter((i) => (i.votes || []).includes(m.id)).length;
    return `<div class="row-item">
      <div class="main">
        <div class="ttl">${avatar(m.id)} <span>${esc(m.name)}</span>
          ${m.id === UI.me ? `<span class="badge primary">${esc(t('mb.me'))}</span>` : ''}
          ${memberBadges(m)}</div>
        ${m.note ? `<div class="meta">${esc(m.note)}</div>` : ''}
        <div class="meta">
          <span>💸 ${esc(t('ex.paid'))} ${locked ? '🔒' : esc(money(totals.paid[m.id] || 0, cur))}</span>
          <span>🛏️ ${esc(assignedRooms.join('、') || t('rm.unassigned'))}</span>
          <span>⭐ ${votes}</span>
        </div>
      </div>
      <div class="side"><div class="ops">
        <button class="btn ghost sm" data-act="edit-member" data-id="${m.id}">${esc(t('k.edit'))}</button>
        <button class="btn ghost sm" data-act="del-member" data-id="${m.id}">🗑</button>
      </div></div>
    </div>`;
  }).join('');

  const groupCards = st.groups.map((g) => `
    <div class="card">
      <div class="card-title">
        <h3>🏷️ ${esc(groupLabel(g.name))}</h3>
        <span class="badge">${g.adults} ${esc(t('mb.adults'))}${g.children ? ' · ' + g.children + ' ' + esc(t('mb.children')) : ''}</span>
      </div>
      <div class="chips">${g.members.map((m) =>
        `<span class="chip"><span class="dot" style="background:${m.color || '#94a3b8'}"></span>${esc(m.name)}${isChild(m) ? ' 🧒' : ''}</span>`).join('')}</div>
    </div>`).join('');

  return pageHead(t('mb.title'), t('mb.subtitle'), tools) +
    `<div class="grid cols-3 mb12">
      <div class="stat accent"><div class="lbl">👥 ${esc(t('mb.total'))}</div>
        <div class="val">${st.total}</div>
        <div class="hint">${st.groups.length} ${esc(t('mb.groups'))}</div></div>
      <div class="stat"><div class="lbl">🧑 ${esc(t('mb.adults'))}</div>
        <div class="val">${st.adults}</div></div>
      <div class="stat"><div class="lbl">🧒 ${esc(t('mb.children'))}</div>
        <div class="val">${st.children}</div>
        ${locked ? '' : `<div class="hint">${esc(t('ov.perPerson'))} ${esc(money(totals.perPerson, cur))}</div>`}</div>
    </div>
    ${groupCards ? `<div class="grid cols-2 mb12">${groupCards}</div>` : ''}
    <div class="list">${rows}</div>`;
}

/* ==================================================================
   表單（彈窗）
   ================================================================== */

function catOptions(sel) {
  return CATS.map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${esc(t('c.' + c))}</option>`).join('');
}
function currencyOptions(sel) {
  return CURRENCIES.map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c} ${esc(SYMBOL[c])}</option>`).join('');
}

/* --- 成員 --- */
function memberForm(m) {
  const mtype = m && m.type === 'child' ? 'child' : 'adult';
  const groups = Array.from(new Set(S.members.map((x) => x.group).filter(Boolean)));
  return {
    title: m ? t('mb.editTitle') : t('mb.newTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>${esc(t('k.name'))} <span class="req">*</span></label>
        <input type="text" id="f-name" value="${esc(m ? m.name : '')}" placeholder="${esc(t('k.name'))}"></div>

      <div class="field"><label>${esc(t('mb.type'))}</label>
        <div class="seg" id="mtypeSeg">
          <button type="button" class="${mtype === 'adult' ? 'on' : ''}" data-act="pick-mtype" data-mtype="adult">🧑 ${esc(t('mb.adult'))}</button>
          <button type="button" class="${mtype === 'child' ? 'on' : ''}" data-act="pick-mtype" data-mtype="child">🧒 ${esc(t('mb.child'))}</button>
        </div>
        <input type="hidden" id="f-mtype" value="${mtype}"></div>

      <div class="field"><label>${esc(t('mb.group'))}</label>
        <input type="text" id="f-group" list="groupOptions" value="${esc(m ? m.group || '' : '')}"
          placeholder="${esc(t('mb.groupPlaceholder'))}">
        <datalist id="groupOptions">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>

      <div class="field full"><label>${esc(t('k.note'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <input type="text" id="f-note" value="${esc(m ? m.note || '' : '')}" placeholder="${esc(t('mb.notePlaceholder'))}"></div>

      <div class="field full"><label>${esc(t('mb.color'))}</label>
        <div class="flex" id="colorRow">
          ${PALETTE.map((c) => `<button type="button" class="check-item ${((m && m.color) || PALETTE[0]) === c ? 'on' : ''}"
             data-act="pick-color" data-color="${c}" style="padding:4px 6px">
             <span class="dot" style="background:${c};width:18px;height:18px"></span></button>`).join('')}
        </div>
        <input type="hidden" id="f-color" value="${esc((m && m.color) || PALETTE[0])}"></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-member" data-id="${m ? m.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

/* --- 行程 --- */
function itineraryForm(it, presetDate) {
  const links = (it && it.links && it.links.length) ? it.links : [{ label: '', url: '' }];
  const linkRows = () => links.map((l, i) => `
    <div class="flex" data-link-row style="margin-bottom:6px">
      <input type="text" class="lk-label" style="flex:1;min-width:90px" placeholder="${esc(t('k.name'))}" value="${esc(l.label || '')}">
      <input type="text" class="lk-url" style="flex:2;min-width:130px" placeholder="${esc(t('fd.urlPlaceholder'))}" value="${esc(l.url || '')}">
      <button type="button" class="btn ghost sm" data-act="rm-link">✕</button>
    </div>`).join('');

  return {
    title: it ? t('it.editTitle') : t('it.newTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>${esc(t('k.title'))} <span class="req">*</span></label>
        <input type="text" id="f-title" value="${esc(it ? it.title : '')}"></div>
      <div class="field"><label>${esc(t('k.date'))}</label>
        <input type="date" id="f-date" value="${esc(it ? it.date || '' : (presetDate || S.meta.startDate || todayISO()))}"></div>
      <div class="field"><label>${esc(t('k.time'))}</label>
        <input type="time" id="f-time" value="${esc(it ? it.time || '' : '')}"></div>
      <div class="field"><label>${esc(t('k.category'))}</label>
        <select id="f-cat">${catOptions(it ? it.category : 'sight')}</select></div>
      <div class="field"><label>${esc(t('k.location'))}</label>
        <input type="text" id="f-loc" value="${esc(it ? it.location || '' : '')}"></div>
      <div class="field full"><label>${esc(t('k.note'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <textarea id="f-note">${esc(it ? it.note || '' : '')}</textarea></div>
      <div class="field full"><label>${esc(t('k.link'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <div id="linkRows">${linkRows()}</div>
        <button type="button" class="btn sm" data-act="add-link">＋ ${esc(t('k.link'))}</button></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-itinerary" data-id="${it ? it.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

/* --- 支出 --- */
function expenseForm(e) {
  const allIds = S.members.map((m) => m.id);
  const parts = (e && e.participantIds && e.participantIds.length) ? e.participantIds : allIds;
  const payer = e ? e.payerId : (UI.me || (S.members[0] && S.members[0].id) || '');
  const cur = e ? e.currency : S.meta.baseCurrency;

  const memberChecks = S.members.map((m) => `
    <label class="check-item ${parts.includes(m.id) ? 'on' : ''}" data-participant="${m.id}">
      <input type="checkbox" ${parts.includes(m.id) ? 'checked' : ''}>
      <span class="dot" style="background:${m.color || '#94a3b8'}"></span>${esc(m.name)}
    </label>`).join('');

  return {
    title: e ? t('ex.editTitle') : t('ex.newTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>${esc(t('k.title'))} <span class="req">*</span></label>
        <input type="text" id="f-title" value="${esc(e ? e.title : '')}"></div>
      <div class="field"><label>${esc(t('ex.origAmount'))} <span class="req">*</span></label>
        <input type="number" id="f-amount" step="0.01" min="0" value="${e ? e.amount : ''}"></div>
      <div class="field"><label>${esc(t('k.currency'))}</label>
        <select id="f-currency">${currencyOptions(cur)}</select></div>
      <div class="field"><label>${esc(t('k.date'))}</label>
        <input type="date" id="f-date" value="${esc(e ? e.date || '' : todayISO())}"></div>
      <div class="field"><label>${esc(t('k.category'))}</label>
        <select id="f-cat">${catOptions(e ? e.category : 'food')}</select></div>
      <div class="field full"><label>${esc(t('ex.payer'))}</label>
        <select id="f-payer">${S.members.map((m) => `<option value="${m.id}" ${m.id === payer ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field full">
        <label>${esc(t('ex.participants'))}
          <button type="button" class="btn ghost sm" data-act="select-all-parts" style="float:right;margin-top:-4px">${esc(t('ex.splitAll'))}</button>
        </label>
        <div class="checklist" id="partList">${memberChecks}</div>
      </div>
      <div class="field full"><label>${esc(t('k.note'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <textarea id="f-note" style="min-height:60px">${esc(e ? e.note || '' : '')}</textarea></div>
      <div class="field full"><label>${esc(t('ex.receipt'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <input type="file" id="f-receipt" accept="image/*">
        <div id="receiptPreview" class="mt8">${e && e.receipt ? `<img src="${esc(e.receipt)}" style="max-height:100px;border-radius:8px">` : ''}</div>
        <input type="hidden" id="f-receipt-url" value="${esc(e ? e.receipt || '' : '')}"></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-expense" data-id="${e ? e.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

/* --- 預算 --- */
function budgetForm(b) {
  const groups = Array.from(new Set((S.budgets || []).map((x) => x.group).filter(Boolean)));
  const cur = b ? b.currency : S.meta.baseCurrency;
  return {
    title: b ? t('bg.editTitle') : t('bg.newTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>🏷️ ${esc(t('bg.group'))}</label>
        <input type="text" id="f-group" list="budgetGroups" value="${esc(b ? b.group || '' : '')}"
          placeholder="${esc(t('bg.groupPlaceholder'))}">
        <datalist id="budgetGroups">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
        <p class="muted small" style="margin:5px 0 0">${esc(t('bg.subtitle'))}</p></div>
      <div class="field full"><label>${esc(t('bg.name'))} <span class="req">*</span></label>
        <input type="text" id="f-title" value="${esc(b ? b.name : '')}" placeholder="${esc(t('bg.namePlaceholder'))}"></div>
      <div class="field"><label>${esc(t('bg.amount'))} <span class="req">*</span></label>
        <input type="number" id="f-amount" step="0.01" min="0" value="${b ? b.amount : ''}"></div>
      <div class="field"><label>${esc(t('k.currency'))}</label>
        <select id="f-currency">${currencyOptions(cur)}</select></div>
      <div class="field full"><label>${esc(t('bg.note'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <input type="text" id="f-note" value="${esc(b ? b.note || '' : '')}"></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-budget" data-id="${b ? b.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

/* --- 房間 --- */
function roomForm(r) {
  return {
    title: r ? t('rm.editTitle') : t('rm.newTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>${esc(t('rm.roomName'))} <span class="req">*</span></label>
        <input type="text" id="f-title" value="${esc(r ? r.name : '')}" placeholder="301"></div>
      <div class="field"><label>${esc(t('rm.type'))}</label>
        <input type="text" id="f-type" value="${esc(r ? r.type || '' : '')}" placeholder="雙人房 / 四人房"></div>
      <div class="field"><label>${esc(t('rm.capacity'))}</label>
        <input type="number" id="f-cap" min="1" max="12" value="${r ? r.capacity || 2 : 2}"></div>
      <div class="field full"><label>${esc(t('k.note'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <input type="text" id="f-note" value="${esc(r ? r.note || '' : '')}"></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-room" data-id="${r ? r.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

/* --- 資料夾 --- */
/* 資料夾是純容器：只需名稱、分類、備註。圖片與地址／官網都在「內容」裡新增 */
function folderForm(f) {
  return {
    title: f ? t('fd.editTitle') : t('fd.newTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>${esc(t('fd.folderName'))} <span class="req">*</span></label>
        <input type="text" id="f-title" value="${esc(f ? f.name : '')}"></div>
      <div class="field full"><label>${esc(t('k.category'))}</label>
        <select id="f-cat"><option value="">${esc(t('k.none'))}</option>${catOptions(f ? f.category : 'sight')}</select></div>
      <div class="field full"><label>${esc(t('k.note'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <input type="text" id="f-note" value="${esc(f ? f.note || '' : '')}"></div>
      <div class="field full">
        <p class="muted small" style="margin:0">${esc(t('fd.folderHint'))}</p></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-folder" data-id="${f ? f.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

function folderItemForm(folderId, it) {
  const type = it ? it.type : 'image';
  const imgs = itemImages(it);
  const seg = ['image', 'text', 'link'].map((tp) =>
    `<button type="button" class="${type === tp ? 'on' : ''}" data-act="pick-item-type" data-type="${tp}">
       ${esc(t(tp === 'image' ? 'fd.typeImage' : tp === 'text' ? 'fd.typeText' : 'fd.typeLink'))}</button>`).join('');

  return {
    title: it ? t('fd.itemEditTitle') : t('fd.itemTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>${esc(t('k.category'))}</label>
        <div class="seg" id="typeSeg">${seg}</div>
        <input type="hidden" id="f-type" value="${type}"></div>

      <div class="field full"><label>${esc(t('k.title'))}</label>
        <input type="text" id="f-title" value="${esc(it ? it.title || '' : '')}"
          placeholder="${esc(t('fd.caption'))}"></div>

      <div class="field full"><label>${esc(t('fd.body'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <textarea id="f-text" rows="4">${esc(it ? it.text || '' : '')}</textarea>
        <p class="muted small" style="margin:5px 0 0">${esc(t('fd.textHint'))}</p></div>

      <div class="field full">
        <label>🖼 ${esc(t('fd.photos'))} <span class="muted">(${esc(t('fd.maxN', { n: IMAGE_MAX }))})</span></label>
        <div class="img-manager" id="fImgBox"></div>
        <div class="flex mt8" style="align-items:center;gap:10px">
          <label class="btn sm">＋ ${esc(t('fd.addPhoto'))}
            <input type="file" id="f-images" accept="image/*" multiple class="hide"></label>
          <span class="small muted" id="fImgCount"></span>
        </div>
        <p class="muted small" style="margin:6px 0 0">${esc(t('fd.coverHint'))}</p>
        <input type="hidden" id="f-images-json" value="${esc(JSON.stringify(imgs))}">
      </div>

      <div class="field full"><label>📍 ${esc(t('fd.address'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <input type="text" id="f-addr" placeholder="${esc(t('fd.addressPlaceholder'))}"
          value="${esc(it ? it.address || '' : '')}">
        <p class="muted small" style="margin:5px 0 0">${esc(t('fd.addressHint'))}</p></div>

      <div class="field full"><label>🌐 ${esc(t('fd.website'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <input type="text" id="f-web" placeholder="https://" value="${esc(it ? it.website || '' : '')}"></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-folder-item" data-folder="${folderId}" data-item="${it ? it.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

/* --- 提醒 --- */
function reminderForm(r) {
  const dt = r && r.datetime ? r.datetime : (todayISO() + 'T09:00');
  return {
    title: r ? t('re.editTitle') : t('re.newTitle'),
    body: `<div class="form-grid">
      <div class="field full"><label>${esc(t('k.title'))} <span class="req">*</span></label>
        <input type="text" id="f-title" value="${esc(r ? r.title : '')}"></div>
      <div class="field"><label>${esc(t('re.datetime'))}</label>
        <input type="datetime-local" id="f-dt" value="${esc(dt)}"></div>
      <div class="field"><label>${esc(t('re.priority'))}</label>
        <select id="f-prio">
          <option value="high" ${r && r.priority === 'high' ? 'selected' : ''}>${esc(t('re.high'))}</option>
          <option value="normal" ${!r || r.priority === 'normal' ? 'selected' : ''}>${esc(t('re.normal'))}</option>
          <option value="low" ${r && r.priority === 'low' ? 'selected' : ''}>${esc(t('re.low'))}</option>
        </select></div>
      <div class="field full"><label>${esc(t('k.note'))} <span class="muted">(${esc(t('k.optional'))})</span></label>
        <textarea id="f-note" style="min-height:60px">${esc(r ? r.note || '' : '')}</textarea></div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-reminder" data-id="${r ? r.id : ''}">${esc(t('k.save'))}</button>`,
  };
}

/* --- 設定 --- */
function settingsForm() {
  const rates = S.meta.usdRates || {};
  const rateRows = CURRENCIES.map((c) => `
    <div class="flex" style="margin-bottom:6px">
      <span style="width:52px" class="small">${esc(c)}</span>
      <input type="number" step="0.0001" class="rate-input" data-cur="${c}" value="${rates[c] || 1}">
      <span class="small muted nowrap" data-rate-hint="${c}"></span>
    </div>`).join('');

  const tbd = !!S.meta.dateTbd;

  return {
    title: t('st.title'),
    wide: true,
    body: `<div class="grid cols-2">
      <div class="card"><div class="card-title"><h3>🧭 ${esc(t('st.trip'))}</h3></div>
        <div class="form-grid">
          <div class="field full"><label>${esc(t('st.tripName'))}</label>
            <input type="text" id="s-title" value="${esc(S.meta.title || '')}"></div>
          <div class="field full"><label>${esc(t('st.destination'))}</label>
            <input type="text" id="s-dest" value="${esc(S.meta.destination || '')}"></div>
          <div class="field full">
            <label>${esc(t('ov.dates'))}</label>
            <label class="check-item ${tbd ? 'on' : ''}" data-act="toggle-tbd" style="margin-bottom:8px">
              <input type="checkbox" ${tbd ? 'checked' : ''}> 🗓️ ${esc(t('st.dateTbd'))}
            </label>
            <div class="form-grid" id="dateFields" style="${tbd ? 'opacity:.45' : ''}">
              <div class="field"><label>${esc(t('st.start'))}</label>
                <input type="date" id="s-start" value="${esc(S.meta.startDate || '')}" ${tbd ? 'disabled' : ''}></div>
              <div class="field"><label>${esc(t('st.end'))}</label>
                <input type="date" id="s-end" value="${esc(S.meta.endDate || '')}" ${tbd ? 'disabled' : ''}></div>
            </div>
            <input type="hidden" id="s-tbd" value="${tbd ? '1' : '0'}">
            <p class="muted small" style="margin:6px 0 0">${esc(t('st.dateTbdHint'))}</p>
          </div>
        </div>
        <div class="mt12 flex">
          <button class="btn primary" data-act="save-settings">${esc(t('k.save'))}</button>
        </div>
      </div>

      <div class="card"><div class="card-title"><h3>🔄 ${esc(t('st.sync'))}</h3></div>
        <table class="data"><tbody>
          <tr><th>${esc(t('st.version'))}</th><td><span id="syncVersion">v${S.version}</span></td></tr>
          <tr><th>${esc(t('st.lastUpdate'))}</th><td><span id="syncUpdated">${esc(fmtDateTime(S.updatedAt))}</span>
            · <span id="syncActor">${esc(lastActorName())}</span></td></tr>
          <tr><th>${esc(t('st.autoSave'))}</th><td>${esc(t('st.autoSaveOn'))}</td></tr>
        </tbody></table>
        <p class="muted small mt12">${esc(t('st.historyHint'))}</p>
        <div class="flex mt12">
          <button class="btn primary" data-act="manual-save">💾 ${esc(t('st.saveNow'))}</button>
          <button class="btn" data-act="open-history">🕘 ${esc(t('st.history'))}</button>
        </div>
      </div>

      <div class="card"><div class="card-title"><h3>💱 ${esc(t('st.money'))}</h3></div>
        <div class="field"><label>${esc(t('st.baseCurrency'))}</label>
          <select id="s-base">${currencyOptions(S.meta.baseCurrency)}</select></div>
        <details class="mt12"><summary class="small muted" style="cursor:pointer">${esc(t('st.rates'))}</summary>
          <div class="mt12">${rateRows}</div></details>
      </div>

      <div class="card"><div class="card-title"><h3>🎨 ${esc(t('st.appearance'))}</h3></div>
        <div class="field"><label>${esc(t('st.palette'))}</label>
          <div class="flex">
            ${PALETTES.map((p) => `<button type="button" class="palette-btn ${UI.palette === p.id ? 'on' : ''}"
               data-act="set-palette" data-palette="${p.id}">
               <span class="palette-swatch">${p.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
               <span>${esc(t('palette.' + p.id))}</span></button>`).join('')}
          </div>
        </div>
        <div class="field mt12"><label>${esc(t('st.theme'))}</label>
          <div class="seg">${['auto', 'light', 'dark'].map((th) =>
            `<button type="button" class="${UI.theme === th ? 'on' : ''}" data-act="set-theme" data-theme="${th}">
              ${esc(t('st.theme' + th.charAt(0).toUpperCase() + th.slice(1)))}</button>`).join('')}</div></div>
        <div class="field mt12"><label>${esc(t('st.language'))}</label>
          <div class="seg">${['zh-Hant', 'zh-Hans', 'en'].map((l) =>
            `<button type="button" class="${UI.lang === l ? 'on' : ''}" data-act="set-lang" data-lang="${l}">
              ${l === 'zh-Hant' ? '繁體' : l === 'zh-Hans' ? '简体' : 'EN'}</button>`).join('')}</div></div>
      </div>

      <div class="card"><div class="card-title"><h3>💾 ${esc(t('st.data'))}</h3></div>
        <div class="flex">
          <button class="btn" data-act="export-json" ${S.locked ? 'disabled' : ''}>⬇ ${esc(t('st.export'))}</button>
          <button class="btn" data-act="import" ${S.locked ? 'disabled' : ''}>⬆ ${esc(t('st.import'))}</button>
        </div>
        ${S.locked ? `<p class="muted small mt8">🔒 ${esc(t('st.needUnlock'))}</p>` : ''}
        <div class="flex mt12">
          <button class="btn" data-act="seed">${esc(t('st.seed'))}</button>
          <button class="btn danger" data-act="reset">${isAdmin() ? '' : '🔒 '}${esc(t('st.reset'))}</button>
        </div>
        <input type="file" id="importFile" accept="application/json" class="hide">
        <p class="muted small mt12">${esc(isAdmin() ? t('st.aboutText') : t('st.resetLocked'))}</p>
      </div>

      <div class="card"><div class="card-title"><h3>🔒 ${esc(t('adm.title'))}</h3></div>
        <p class="muted small">${esc(t('st.lockInfo'))}</p>
        <div class="flex mt12" style="align-items:center;flex-wrap:wrap;gap:8px">
          ${isAdmin()
            ? `<span class="badge ok">🔓 ${esc(t('adm.unlocked'))}</span>
               <button class="btn" data-act="lock-now">${esc(t('lock.lock'))}</button>`
            : `<span class="badge danger">🔒 ${esc(t('lock.locked'))}</span>
               <button class="btn primary" data-act="admin-unlock">🔐 ${esc(t('lock.submit'))}</button>`}
        </div>
      </div>
    </div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.close'))}</button>`,
  };
}

/* ==================================================================
   圖片上傳
   ================================================================== */

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function uploadImage(file) {
  if (!file) return '';
  if (!/^image\//.test(file.type)) { toast(t('fd.notImage')); return ''; }
  if (file.size > 12 * 1024 * 1024) { toast(t('fd.imageTooBig')); return ''; }
  const dataUrl = await readFileAsDataURL(file);
  try {
    const res = await sendOp({ t: 'upload', dataUrl, name: file.name }, { silent: true });
    return (res && res.url) || '';
  } catch (_) {
    /* 單張失敗不影響其餘圖片；sendOp 已提示錯誤 */
    return '';
  }
}

/* ==================================================================
   事件處理
   ================================================================== */

/* label 內含 checkbox 時，瀏覽器會把點擊轉發給 input，
   造成同一次點擊觸發兩次（等於沒切換）。統一忽略來自 input 的事件。 */
function isForwarded(e) {
  return !!e.target && e.target.tagName === 'INPUT';
}

document.addEventListener('click', async (e) => {
  if (isForwarded(e)) return;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  /* ---- 全域 ---- */
  if (act === 'tab') { UI.tab = el.dataset.tab; if (UI.tab === 'folders') UI.openFolder = null; render(); return; }
  if (act === 'close-modal') { closeModal(); return; }
  if (act === 'zoom') { openLightbox(el.dataset.src); return; }
  if (act === 'open-settings') { openSettings(); return; }
  if (act === 'set-lang') { setLang(el.dataset.lang); openSettings(); return; }
  if (act === 'set-theme') {
    UI.theme = el.dataset.theme; localStorage.setItem('tp.theme', UI.theme); applyTheme();
    openSettings(); return;
  }
  if (act === 'pick-color') {
    const row = el.closest('#colorRow');
    $$('.check-item', row).forEach((b) => b.classList.remove('on'));
    el.classList.add('on');
    $('#f-color').value = el.dataset.color;
    return;
  }
  if (act === 'pick-mtype') {
    const seg = el.closest('#mtypeSeg');
    $$('button', seg).forEach((b) => b.classList.remove('on'));
    el.classList.add('on');
    $('#f-mtype').value = el.dataset.mtype;
    return;
  }
  if (act === 'toggle-tbd') {
    const on = !$('#s-tbd').value || $('#s-tbd').value === '0';
    $('#s-tbd').value = on ? '1' : '0';
    el.classList.toggle('on', on);
    const cb = el.querySelector('input');
    if (cb) cb.checked = on;
    const box = $('#dateFields');
    if (box) box.style.opacity = on ? '.45' : '1';
    $$('#dateFields input').forEach((i) => { i.disabled = on; });
    return;
  }
  if (act === 'set-palette') { setPalette(el.dataset.palette); openSettings(); return; }
  if (act === 'open-history') { openModal(viewHistory()); return; }
  if (act === 'manual-save') { manualSave(); return; }
  if (act === 'lock-now') { lockExpenses(); closeModal(); return; }
  if (act === 'admin-unlock') { closeModal(); openAdminPrompt(); return; }
  if (act === 'export-json') { exportJSON(); return; }
  if (act === 'add-link') {
    const rows = $('#linkRows');
    const div = document.createElement('div');
    div.className = 'flex';
    div.setAttribute('data-link-row', '');
    div.style.marginBottom = '6px';
    div.innerHTML = `<input type="text" class="lk-label" style="flex:1;min-width:90px" placeholder="${esc(t('k.name'))}">
      <input type="text" class="lk-url" style="flex:2;min-width:130px" placeholder="${esc(t('fd.urlPlaceholder'))}">
      <button type="button" class="btn ghost sm" data-act="rm-link">✕</button>`;
    rows.appendChild(div);
    return;
  }
  if (act === 'rm-link') { el.closest('[data-link-row]').remove(); return; }
  if (act === 'pick-item-type') {
    const seg = el.closest('#typeSeg');
    $$('button', seg).forEach((b) => b.classList.remove('on'));
    el.classList.add('on');
    $('#f-type').value = el.dataset.type;
    return;
  }
  if (act === 'select-all-parts') {
    const list = $('#partList');
    const allOn = $$('.check-item', list).every((c) => c.classList.contains('on'));
    $$('.check-item', list).forEach((c) => {
      c.classList.toggle('on', !allOn);
      const cb = c.querySelector('input');
      if (cb) cb.checked = !allOn;
    });
    return;
  }
  if (act === 'import') { $('#importFile').click(); return; }
  if (act === 'seed') {
    withAdmin(() => {
      confirmDialog(t('st.seedConfirm'), async () => { await sendOp({ t: 'seedDemo' }); });
    });
    return;
  }
  if (act === 'reset') {
    /* 清空所有資料為破壞性操作，僅限管理員 */
    withAdmin(() => confirmDialog(t('st.resetConfirm'), async () => {
      await sendOp({ t: 'reset' });
      closeModal();
    }));
    return;
  }

  /* ---- 行程 ---- */
  if (act === 'it-view') { UI.itView = el.dataset.v; render(); return; }
  if (act === 'cal-prev' || act === 'cal-next') {
    const month = UI.calMonth || defaultCalMonth();
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + (act === 'cal-next' ? 1 : -1), 1);
    UI.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    render(); return;
  }
  if (act === 'cal-day') { UI.calSelected = el.dataset.date; UI.itView = 'list'; render(); return; }
  if (act === 'clear-day') { UI.calSelected = null; render(); return; }
  if (act === 'add-itinerary') {
    const m = openModal(itineraryForm(null, UI.calSelected)); bindItineraryForm(m); return;
  }
  if (act === 'edit-itinerary') {
    const it = S.itinerary.find((x) => x.id === el.dataset.id);
    if (it) { const m = openModal(itineraryForm(it)); bindItineraryForm(m); }
    return;
  }
  if (act === 'vote-it') {
    if (!UI.me) { toast(t('err.needMember')); return; }
    await sendOp({ t: 'vote', col: 'itinerary', id: el.dataset.id, memberId: UI.me }, { silent: true });
    render(); return;
  }

  /* ---- 支出 ---- */
  if (act === 'add-expense') {
    if (!S.members.length) { toast(t('ov.needSetup')); return; }
    const m = openModal(expenseForm(null)); bindExpenseForm(m); return;
  }
  if (act === 'edit-expense') {
    const ex = S.expenses.find((x) => x.id === el.dataset.id);
    if (ex) { const m = openModal(expenseForm(ex)); bindExpenseForm(m); }
    return;
  }
  if (act === 'export-csv') { exportCSV(); return; }
  if (act === 'ex-view') { UI.exView = el.dataset.v; render(); return; }
  if (act === 'add-budget') { openModal(budgetForm(null)); return; }
  if (act === 'edit-budget') {
    const b = (S.budgets || []).find((x) => x.id === el.dataset.id);
    if (b) openModal(budgetForm(b));
    return;
  }
  if (act === 'del-budget') {
    const b = (S.budgets || []).find((x) => x.id === el.dataset.id);
    if (!b) return;
    confirmDialog(`${t('k.delete')}「${b.name}」？`, async () => {
      await sendOp({ t: 'delete', col: 'budgets', id: b.id });
    });
    return;
  }

  /* ---- 房間 ---- */
  if (act === 'add-room') { const m = openModal(roomForm(null)); bindRoomForm(m); return; }
  if (act === 'edit-room') {
    const r = S.rooms.find((x) => x.id === el.dataset.id);
    if (r) { const m = openModal(roomForm(r)); bindRoomForm(m); }
    return;
  }
  if (act === 'assign') { openAssign(el.dataset.room); return; }
  if (act === 'unassign') {
    const r = S.rooms.find((x) => x.id === el.dataset.room);
    if (!r) return;
    await sendOp({ t: 'assign', col: 'rooms', id: r.id, memberIds: (r.memberIds || []).filter((x) => x !== el.dataset.id) }, { silent: true });
    render(); return;
  }

  /* ---- 資料夾 ---- */
  if (act === 'folder-cat') { UI.folderCat = el.dataset.cat; render(); return; }
  if (act === 'open-folder') { UI.openFolder = el.dataset.id; UI.sortByVotes = false; render(); return; }
  if (act === 'back-folders') { UI.openFolder = null; render(); return; }
  if (act === 'sort-votes') { UI.sortByVotes = !UI.sortByVotes; render(); return; }
  if (act === 'open-item') {
    const f = S.folders.find((x) => x.id === el.dataset.folder);
    const it = f && (f.items || []).find((x) => x.id === el.dataset.item);
    if (f && it) openModal(itemDetailForm(f, it));
    return;
  }
  if (act === 'add-folder') {
    withAdmin(() => { const m = openModal(folderForm(null)); bindFolderForm(m); });
    return;
  }
  if (act === 'edit-folder') {
    const f = S.folders.find((x) => x.id === el.dataset.id);
    if (f) withAdmin(() => { const m = openModal(folderForm(f)); bindFolderForm(m); });
    return;
  }
  if (act === 'add-folder-item') {
    const fid = el.dataset.folder;
    withAdmin(() => { const m = openModal(folderItemForm(fid, null)); bindFolderItemForm(m); });
    return;
  }
  if (act === 'edit-folder-item') {
    const f = S.folders.find((x) => x.id === el.dataset.folder);
    const it = f && (f.items || []).find((x) => x.id === el.dataset.item);
    if (it) withAdmin(() => {
      closeModal();   // 若從「查看」彈窗進來，先關掉它
      const m = openModal(folderItemForm(f.id, it));
      bindFolderItemForm(m);
    });
    return;
  }
  if (act === 'del-item') {
    const fid = el.dataset.folder, iid = el.dataset.item;
    withAdmin(() => {
      closeModal();
      confirmDialog(t('fd.deleteItemWarn'), async () => {
        await sendOp({ t: 'deleteItem', folderId: fid, itemId: iid });
      });
    });
    return;
  }
  if (act === 'vote-item') {
    if (!UI.me) { toast(t('err.needMember')); return; }
    await sendOp({ t: 'voteItem', folderId: el.dataset.folder, itemId: el.dataset.item, memberId: UI.me }, { silent: true });
    render(); return;
  }

  /* ---- 提醒 ---- */
  if (act === 'add-reminder') { const m = openModal(reminderForm(null)); bindReminderForm(m); return; }
  if (act === 'edit-reminder') {
    const r = S.reminders.find((x) => x.id === el.dataset.id);
    if (r) { const m = openModal(reminderForm(r)); bindReminderForm(m); }
    return;
  }
  if (act === 'toggle-rem') {
    const r = S.reminders.find((x) => x.id === el.dataset.id);
    if (r) { await sendOp({ t: 'update', col: 'reminders', id: r.id, patch: { done: !r.done } }, { silent: true }); render(); }
    return;
  }
  if (act === 'toggle-done') { UI.showDone = !UI.showDone; render(); return; }

  /* ---- 成員 ---- */
  if (act === 'add-member') { const m = openModal(memberForm(null)); bindMemberForm(m); return; }
  if (act === 'edit-member') {
    const mm = S.members.find((x) => x.id === el.dataset.id);
    if (mm) { const m = openModal(memberForm(mm)); bindMemberForm(m); }
    return;
  }
  if (act === 'del-member') {
    const mm = member(el.dataset.id);
    if (!mm) return;
    confirmDialog(t('mb.deleteWarn') + '\n' + mm.name, async () => {
      await sendOp({ t: 'delete', col: 'members', id: mm.id });
    });
    return;
  }

  /* ---- 通用刪除 ---- */
  if (act === 'del') {
    const col = el.dataset.col, id = el.dataset.id;
    const item = (S[col] || []).find((x) => x.id === id);
    const label = item ? (item.title || item.name || '') : '';
    const run = () => confirmDialog(`${t('k.delete')}「${label}」？`, async () => {
      await sendOp({ t: 'delete', col, id });
      if (col === 'folders' && UI.openFolder === id) UI.openFolder = null;
    });
    if (col === 'folders') withAdmin(run); else run();
    return;
  }

  /* ---- 表單儲存 ---- */
  if (act === 'save-member') return saveMember(el.dataset.id);
  if (act === 'save-itinerary') return saveItinerary(el.dataset.id);
  if (act === 'save-expense') return saveExpense(el.dataset.id);
  if (act === 'save-budget') return saveBudget(el.dataset.id);
  if (act === 'save-room') return saveRoom(el.dataset.id);
  if (act === 'save-folder') return saveFolder(el.dataset.id);
  if (act === 'save-folder-item') return saveFolderItem(el.dataset.folder, el.dataset.item);
  if (act === 'save-reminder') return saveReminder(el.dataset.id);
  if (act === 'save-settings') return saveSettings();
});

/* ------------------------------ 表單綁定 --------------------------- */

function bindMemberForm() { /* 顏色由全域處理 */ }

function bindItineraryForm(mask) {
  mask.querySelector('#f-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') mask.querySelector('[data-act="save-itinerary"]').click();
  });
}

function bindExpenseForm(mask) {
  mask.querySelector('#f-amount').addEventListener('input', updateExpenseHint);
  mask.querySelector('#f-currency').addEventListener('change', updateExpenseHint);
  mask.querySelector('#partList').addEventListener('click', (e) => {
    if (isForwarded(e)) return;
    const item = e.target.closest('.check-item');
    if (!item) return;
    item.classList.toggle('on');
    const cb = item.querySelector('input');
    if (cb) cb.checked = item.classList.contains('on');
  });
  mask.querySelector('#f-receipt').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const prev = mask.querySelector('#receiptPreview');
    prev.innerHTML = `<span class="muted small">${esc(t('fd.uploading'))}</span>`;
    const url = await uploadImage(file);
    if (url) {
      mask.querySelector('#f-receipt-url').value = url;
      prev.innerHTML = `<img src="${esc(url)}" style="max-height:100px;border-radius:8px">`;
    } else prev.innerHTML = '';
  });
  updateExpenseHint();
}

function updateExpenseHint() {
  const el = $('#f-amount'); if (!el) return;
  const cur = val('#f-currency') || S.meta.baseCurrency;
  const amt = Number(el.value) || 0;
  const n = $$('#partList .check-item.on').length || 1;
  const base = toBase(amt, cur);
  let hint = $('#amtHint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'amtHint';
    hint.className = 'muted small';
    hint.style.margin = '4px 0 0';
    el.parentElement.appendChild(hint);
  }
  hint.textContent = cur === S.meta.baseCurrency
    ? `${t('ex.splitEqually')}: ${money(amt / n, cur)} × ${n}`
    : `≈ ${money(base, S.meta.baseCurrency)} · ${t('ex.splitEqually')}: ${money(base / n, S.meta.baseCurrency)} × ${n}`;
}

function bindRoomForm() { }

/* 圖片管理器：可一次選多張、可逐張移除、自動記錄張數並在額滿時停用選檔 */
function setupImageManager(mask, opts) {
  const box = mask.querySelector(opts.box);
  const input = mask.querySelector(opts.input);
  const count = mask.querySelector(opts.count);
  const json = mask.querySelector(opts.json);
  if (!box || !input) return null;
  let images = (opts.initial || []).filter(Boolean).slice(0, opts.max);

  const sync = () => {
    if (json) json.value = JSON.stringify(images);
    if (count) {
      count.textContent = t('fd.imgCount', { n: images.length, max: opts.max });
      count.classList.toggle('full', images.length >= opts.max);
    }
    input.disabled = images.length >= opts.max;
  };

  const draw = () => {
    box.innerHTML = images.length
      ? images.map((u, i) => `<div class="img-cell">
          <img src="${esc(u)}" alt="" data-act="zoom" data-src="${esc(u)}">
          <button type="button" class="img-x" data-i="${i}" title="${esc(t('k.delete'))}">✕</button>
        </div>`).join('')
      : `<p class="muted small" style="margin:0">${esc(t('fd.noPhoto'))}</p>`;
    box.querySelectorAll('.img-x').forEach((b) => b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      images.splice(Number(b.dataset.i), 1);
      draw();
    }));
    sync();
  };

  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    for (const file of files) {
      if (images.length >= opts.max) { toast(t('fd.imgLimit', { n: opts.max })); break; }
      const url = await uploadImage(file);
      if (url) { images.push(url); draw(); }
    }
  });

  draw();
  return { get: () => images.slice() };
}

/* 資料夾表單沒有圖片欄位，不需要綁定圖片管理器 */
function bindFolderForm() { }

function bindFolderItemForm(mask) {
  setupImageManager(mask, {
    box: '#fImgBox', input: '#f-images', count: '#fImgCount', json: '#f-images-json',
    max: IMAGE_MAX, initial: JSON.parse(val('#f-images-json') || '[]'),
  });
}

function bindReminderForm() { }

function bindSettings(mask) {
  const update = () => {
    const base = val('#s-base');
    const rates = {};
    $$('.rate-input', mask).forEach((i) => { rates[i.dataset.cur] = Number(i.value) || 1; });
    $$('[data-rate-hint]', mask).forEach((sp) => {
      const c = sp.dataset.rateHint;
      const r = (rates[c] || 1) / (rates[base] || 1);
      sp.textContent = `1 ${c} = ${(1 / r).toFixed(r < 1 ? 2 : 4)} ${base}`;
    });
  };
  mask.querySelector('#s-base').addEventListener('change', update);
  $$('.rate-input', mask).forEach((i) => i.addEventListener('input', update));
  update();

  mask.querySelector('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      S = await Store.importState(payload, { actorId: UI.me });
      closeModal(); toast(t('k.saved')); render();
    } catch (err) { toast(t('err.generic')); }
  });
}

/* ------------------------------ 儲存邏輯 --------------------------- */

async function saveMember(id) {
  const name = val('#f-name');
  if (!name) { toast(t('err.needTitle')); return; }
  const payload = {
    name,
    note: val('#f-note'),
    color: val('#f-color'),
    type: val('#f-mtype') || 'adult',
    group: val('#f-group'),
  };
  if (id) await sendOp({ t: 'update', col: 'members', id, patch: payload });
  else {
    const r = await sendOp({ t: 'add', col: 'members', item: payload });
    if (r && r.id && !UI.me) { UI.me = r.id; localStorage.setItem('tp.me', UI.me); render(); }
  }
  closeModal();
}

async function saveItinerary(id) {
  const title = val('#f-title');
  if (!title) { toast(t('err.needTitle')); return; }
  const links = $$('#linkRows [data-link-row]').map((row) => ({
    label: row.querySelector('.lk-label').value.trim(),
    url: row.querySelector('.lk-url').value.trim(),
  })).filter((l) => l.url);
  const payload = {
    title, date: val('#f-date'), time: val('#f-time'), category: val('#f-cat'),
    location: val('#f-loc'), note: val('#f-note'), links,
  };
  if (id) await sendOp({ t: 'update', col: 'itinerary', id, patch: payload });
  else await sendOp({ t: 'add', col: 'itinerary', item: Object.assign({ votes: [] }, payload) });
  closeModal();
}

async function saveExpense(id) {
  const title = val('#f-title');
  const amount = num('#f-amount');
  if (!title) { toast(t('err.needTitle')); return; }
  if (amount <= 0) { toast(t('ex.origAmount')); return; }
  const parts = $$('#partList .check-item.on').map((c) => c.dataset.participant);
  if (!parts.length) { toast(t('ex.selectMember')); return; }
  const payload = {
    title, amount, currency: val('#f-currency'), date: val('#f-date'), category: val('#f-cat'),
    payerId: val('#f-payer'), participantIds: parts, note: val('#f-note'),
    receipt: val('#f-receipt-url'),
  };
  if (id) await sendOp({ t: 'update', col: 'expenses', id, patch: payload });
  else await sendOp({ t: 'add', col: 'expenses', item: payload });
  closeModal();
}

async function saveBudget(id) {
  const name = val('#f-title');
  const amount = num('#f-amount');
  if (!name) { toast(t('bg.needName')); return; }
  if (amount <= 0) { toast(t('bg.needAmount')); return; }
  const payload = {
    group: val('#f-group'), name, amount,
    currency: val('#f-currency'), note: val('#f-note'),
  };
  if (id) await sendOp({ t: 'update', col: 'budgets', id, patch: payload });
  else await sendOp({ t: 'add', col: 'budgets', item: payload });
  closeModal();
}

async function saveRoom(id) {
  const name = val('#f-title');
  if (!name) { toast(t('err.needTitle')); return; }
  const payload = { name, type: val('#f-type'), capacity: Math.max(1, num('#f-cap')), note: val('#f-note') };
  if (id) await sendOp({ t: 'update', col: 'rooms', id, patch: payload });
  else await sendOp({ t: 'add', col: 'rooms', item: Object.assign({ memberIds: [] }, payload) });
  closeModal();
}

async function saveFolder(id) {
  const name = val('#f-title');
  if (!name) { toast(t('err.needTitle')); return; }
  const payload = { name, category: val('#f-cat'), note: val('#f-note') };
  if (id) await sendOp({ t: 'update', col: 'folders', id, patch: payload });
  else await sendOp({ t: 'add', col: 'folders', item: Object.assign({ items: [] }, payload) });
  closeModal();
}

async function saveFolderItem(folderId, itemId) {
  const type = val('#f-type') || 'text';
  const images = JSON.parse(val('#f-images-json') || '[]');
  if (type === 'image' && !images.length) { toast(t('fd.pickImage')); return; }
  const payload = {
    type, title: val('#f-title'), text: val('#f-text'),
    address: val('#f-addr'), website: val('#f-web'),
    images, image: images[0] || '',
  };
  if (itemId) await sendOp({ t: 'updateItem', folderId, itemId, patch: payload });
  else await sendOp({ t: 'addItem', folderId, item: Object.assign({ votes: [] }, payload) });
  closeModal();
}

async function saveReminder(id) {
  const title = val('#f-title');
  if (!title) { toast(t('err.needTitle')); return; }
  const payload = { title, datetime: val('#f-dt'), priority: val('#f-prio'), note: val('#f-note') };
  if (id) await sendOp({ t: 'update', col: 'reminders', id, patch: payload });
  else await sendOp({ t: 'add', col: 'reminders', item: Object.assign({ done: false }, payload) });
  closeModal();
}

async function saveSettings() {
  const rates = {};
  $$('.rate-input').forEach((i) => { rates[i.dataset.cur] = Number(i.value) || 1; });
  const tbd = val('#s-tbd') === '1';
  await sendOp({
    t: 'setMeta',
    patch: {
      title: val('#s-title'), destination: val('#s-dest'),
      startDate: tbd ? '' : val('#s-start'),
      endDate: tbd ? '' : val('#s-end'),
      dateTbd: tbd,
      baseCurrency: val('#s-base'), usdRates: rates,
    },
  });
  closeModal();
}

async function exportJSON() {
  if (!UI.unlock) { toast(t('st.needUnlock')); return; }
  try {
    const data = await Store.exportState();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'travel-planner-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (_) { toast(t('err.generic')); }
}

/* ------------------------------ 房間分配 --------------------------- */

function openAssign(roomId) {
  const room = S.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const cap = Number(room.capacity) || 2;
  const current = room.memberIds || [];
  const others = {};
  for (const r of S.rooms) if (r.id !== roomId) for (const m of (r.memberIds || [])) others[m] = r.name;

  const list = S.members.map((m) => {
    const inRoom = current.includes(m.id);
    return `<label class="check-item ${inRoom ? 'on' : ''}" data-assign="${m.id}">
      <input type="checkbox" ${inRoom ? 'checked' : ''}>
      <span class="dot" style="background:${m.color || '#94a3b8'}"></span>${esc(m.name)}
      ${others[m.id] ? `<span class="muted small">（${esc(others[m.id])}）</span>` : ''}
    </label>`;
  }).join('');

  const m = openModal({
    title: `${t('rm.assign')} — ${room.name}`,
    body: `<p class="muted small">${esc(t('rm.occupancy', { used: current.length, cap }))}</p>
      <div class="checklist mt12" id="assignList">${list}</div>`,
    foot: `<button class="btn" data-act="close-modal">${esc(t('k.cancel'))}</button>
           <button class="btn primary" data-act="save-assign" data-room="${roomId}">${esc(t('k.save'))}</button>`,
  });
  m.querySelector('#assignList').addEventListener('click', (e) => {
    if (isForwarded(e)) return;
    const item = e.target.closest('.check-item');
    if (!item) return;
    const on = $$('#assignList .check-item.on');
    if (!item.classList.contains('on') && on.length >= cap) { toast(t('rm.full')); return; }
    item.classList.toggle('on');
    const cb = item.querySelector('input');
    if (cb) cb.checked = item.classList.contains('on');
  });
  m.querySelector('[data-act="save-assign"]').addEventListener('click', async () => {
    const ids = $$('#assignList .check-item.on').map((c) => c.dataset.assign);
    // 從其他房間移除
    for (const r of S.rooms) {
      if (r.id === roomId) continue;
      const filtered = (r.memberIds || []).filter((x) => !ids.includes(x));
      if (filtered.length !== (r.memberIds || []).length) {
        await sendOp({ t: 'assign', col: 'rooms', id: r.id, memberIds: filtered }, { silent: true });
      }
    }
    await sendOp({ t: 'assign', col: 'rooms', id: roomId, memberIds: ids });
    closeModal();
  });
}

/* ------------------------------ 燈箱 ------------------------------ */

function openLightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${esc(src)}" alt="">`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

/* ------------------------------ CSV ------------------------------ */

function exportCSV() {
  const cur = S.meta.baseCurrency;
  const rows = [['Date', 'Title', 'Category', 'Amount', 'Currency', 'AmountInBase', 'Payer', 'Participants', 'Note']];
  for (const e of (S.expenses || [])) {
    rows.push([
      e.date || '', e.title || '', e.category || '', e.amount || 0, e.currency || cur,
      toBase(e.amount, e.currency).toFixed(2), memberName(e.payerId),
      (e.participantIds || []).map(memberName).join(' / '), e.note || '',
    ]);
  }
  const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'expenses.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ==================================================================
   啟動
   ================================================================== */

document.addEventListener('submit', (e) => {
  if (e.target && e.target.id === 'lockForm') {
    e.preventDefault();
    doUnlock();
  }
  if (e.target && e.target.id === 'admForm') {
    e.preventDefault();
    doAdminUnlock();
  }
  if (e.target && e.target.id === 'gateForm') {
    e.preventDefault();
    doGateSubmit();
  }
});

$('#syncState').addEventListener('click', () => {
  if (S) openModal(viewHistory());
});

$('#meSelect').addEventListener('change', (e) => {
  UI.me = e.target.value;
  localStorage.setItem('tp.me', UI.me);
  $('#meDot').style.background = UI.me ? memberColor(UI.me) : 'var(--line-strong)';
  render();
});

$('#langSelect').addEventListener('change', (e) => setLang(e.target.value));

$('#themeBtn').addEventListener('click', () => {
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = UI.theme === 'dark' || (UI.theme === 'auto' && sysDark);
  UI.theme = isDark ? 'light' : 'dark';
  localStorage.setItem('tp.theme', UI.theme);
  applyTheme();
});

$('#settingsBtn').addEventListener('click', () => openSettings());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const lb = document.querySelector('.lightbox');
    if (lb) { lb.remove(); return; }
    if ($('#modalRoot').children.length) closeModal();
  }
});

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

let timersStarted = false;
async function startApp() {
  await loadState();
  render();
  if (!timersStarted) {
    timersStarted = true;
    setInterval(poll, 4000);
    setInterval(checkDueReminders, 60000);
  }
}

(async function boot() {
  applyTheme();
  document.documentElement.setAttribute('lang', UI.lang === 'en' ? 'en' : UI.lang);
  sessionStorage.removeItem('tp.unlock');
  Store.init();
  // 連結安全閘門：未通過關鍵字前不載入任何資料
  if (!UI.gate) { showGate(); return; }
  await startApp();
})();
