'use strict';

/* ==================================================================
   核心邏輯層（Core）
   ------------------------------------------------------------------
   由 server.js 抽出，改為瀏覽器可執行的純邏輯：
   不碰網路、不碰檔案系統，只負責「狀態 + 操作」的計算。
   部署到 GitHub Pages 後，這一層完全在前端執行。
   ================================================================== */

const COLLECTIONS = ['members', 'itinerary', 'expenses', 'budgets', 'rooms', 'folders', 'reminders'];

/* 需要管理員解鎖才能檢視／寫入的資料集合（記帳與預算同鎖） */
const LOCKED_COLLECTIONS = ['expenses', 'budgets'];

/* 每個資料夾／每個項目可放置的圖片張數上限 */
const IMAGE_LIMIT = 10;

/* 歷史紀錄保留上限 */
const HISTORY_LIMIT = 300;

/* 需要管理員解鎖才能執行的資料夾寫入操作 */
const FOLDER_ITEM_OPS = ['addItem', 'updateItem', 'deleteItem', 'moveItem'];

function isFolderWrite(op) {
  if (FOLDER_ITEM_OPS.includes(op.t)) return true;
  if ((op.t === 'add' || op.t === 'update' || op.t === 'delete') && op.col === 'folders') return true;
  return false;
}

/* 產生唯一識別碼 */
function uid(prefix) {
  const bytes = new Uint8Array(6);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return (prefix || 'id') + '_' + hex;
}

/* 只保留有效的圖片網址，並裁到上限 */
function clampImages(list) {
  const arr = Array.isArray(list) ? list.filter((u) => typeof u === 'string' && u.trim()) : [];
  return arr.slice(0, IMAGE_LIMIT);
}

/* 舊資料相容：資料夾本身不再持有圖片／地址／官網（純容器），
   圖片與連結改由「內容」持有；舊的單張 image 升級為 images[] */
function normalizeFolders(state) {
  for (const f of state.folders || []) {
    delete f.images;
    delete f.address;
    delete f.website;
    if (!Array.isArray(f.items)) f.items = [];
    for (const it of f.items) {
      if (!Array.isArray(it.images)) it.images = it.image ? [it.image] : [];
      else it.images = clampImages(it.images);
      if (!it.image && it.images.length) it.image = it.images[0];
      if (typeof it.address !== 'string') it.address = '';
      if (typeof it.website !== 'string') it.website = '';
      /* 舊欄位 url 併入官網，避免資料遺失 */
      if (!it.website && typeof it.url === 'string' && it.url) it.website = it.url;
    }
  }
}

/* 預算項目正規化：確保欄位齊全（類別分組 / 名稱 / 金額 / 幣別 / 備註） */
function normalizeBudgets(state) {
  if (!Array.isArray(state.budgets)) state.budgets = [];
  for (const b of state.budgets) {
    if (!b.id) b.id = uid('bdg');
    b.group = String(b.group || '');
    b.name = String(b.name || '');
    b.amount = Number(b.amount) || 0;
    b.currency = String(b.currency || state.meta.baseCurrency || 'TWD');
    b.note = String(b.note || '');
  }
}

function defaultState() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    meta: {
      title: '我們的團體旅行',
      destination: '',
      startDate: '',
      endDate: '',
      dateTbd: false,
      baseCurrency: 'TWD',
      usdRates: {
        USD: 1, TWD: 32, CNY: 7.15, JPY: 152, EUR: 0.92, HKD: 7.8,
        KRW: 1340, THB: 35, SGD: 1.34, MYR: 4.6, VND: 25400, GBP: 0.79, AUD: 1.52,
      },
    },
    members: [],
    itinerary: [],
    expenses: [],
    budgets: [],
    rooms: [],
    folders: [],
    reminders: [],
    history: [],
  };
}

/* 把任意來源的資料整併成合法狀態（相容舊版欄位） */
function normalizeState(parsed) {
  const base = defaultState();
  const state = Object.assign(base, parsed || {});
  state.meta = Object.assign(base.meta, (parsed && parsed.meta) || {});
  state.meta.usdRates = Object.assign(base.meta.usdRates, (parsed && parsed.meta && parsed.meta.usdRates) || {});
  for (const c of COLLECTIONS) if (!Array.isArray(state[c])) state[c] = [];
  if (!Array.isArray(state.history)) state.history = [];
  normalizeFolders(state);
  normalizeBudgets(state);
  return state;
}

/* ------------------------------ 操作處理 -------------------------- */

function findCollection(state, col) {
  if (!COLLECTIONS.includes(col)) throw new Error('未知的資料集合: ' + col);
  return state[col];
}

function itemTitle(col, item) {
  if (!item) return '';
  const v = item.title || item.name || item.text || '';
  return String(v).slice(0, 60);
}

function cleanupReferences(state, col, id) {
  if (col === 'members') {
    for (const f of state.folders) {
      for (const it of f.items || []) {
        it.votes = (it.votes || []).filter((v) => v !== id);
      }
    }
    for (const it of state.itinerary) it.votes = (it.votes || []).filter((v) => v !== id);
    for (const e of state.expenses) {
      if (e.payerId === id) e.payerId = '';
      e.participantIds = (e.participantIds || []).filter((p) => p !== id);
    }
    for (const r of state.rooms) r.memberIds = (r.memberIds || []).filter((m) => m !== id);
  }
}

function recordHistory(state, ctx, entry) {
  if (!Array.isArray(state.history)) state.history = [];
  const actor = (ctx && ctx.actorId)
    ? (state.members || []).find((m) => m.id === ctx.actorId)
    : null;
  state.history.push(Object.assign({
    id: uid('hst'),
    at: new Date().toISOString(),
    actorId: (ctx && ctx.actorId) || '',
    actorName: actor ? actor.name : '',
    version: state.version,
  }, entry));
  if (state.history.length > HISTORY_LIMIT) {
    state.history.splice(0, state.history.length - HISTORY_LIMIT);
  }
}

/**
 * 套用一個操作。
 * 直接改動傳入的 state（除 seedDemo / reset 會產生新物件），
 * 回傳 { result, state }，呼叫端負責持久化。
 */
function applyOp(state, op, ctx) {
  if (!op || typeof op !== 'object') throw new Error('無效的操作');
  ctx = ctx || {};
  let result = null;
  let entry = null;
  let next = state;

  if (LOCKED_COLLECTIONS.indexOf(op.col) !== -1 && !ctx.unlocked) {
    throw new Error('記帳資料已上鎖，請先輸入密碼');
  }
  if (isFolderWrite(op) && !ctx.unlocked) {
    throw new Error('編輯資料夾需要管理員密碼，請先解鎖');
  }
  /* 清空資料與載入示範資料都會改寫記帳內容，一律僅限管理員 */
  if ((op.t === 'reset' || op.t === 'seedDemo') && !ctx.unlocked) {
    throw new Error('此操作需要管理員密碼，請先解鎖');
  }

  switch (op.t) {
    case 'setMeta': {
      next.meta = Object.assign({}, next.meta, op.patch || {});
      if (op.patch && op.patch.usdRates) {
        next.meta.usdRates = Object.assign({}, next.meta.usdRates, op.patch.usdRates);
      }
      entry = { action: 'meta' };
      break;
    }
    case 'add': {
      const list = findCollection(next, op.col);
      const item = Object.assign({}, op.item);
      if (op.col === 'folders') {
        /* 資料夾是純容器：只保留名稱／分類／備註，圖片與連結屬於內容 */
        delete item.images;
        delete item.address;
        delete item.website;
        if (!Array.isArray(item.items)) item.items = [];
      }
      if (op.col === 'budgets') {
        item.amount = Number(item.amount) || 0;
        item.group = String(item.group || '');
        item.name = String(item.name || '');
        item.currency = String(item.currency || next.meta.baseCurrency || 'TWD');
        item.note = String(item.note || '');
      }
      if (!item.id) item.id = uid(op.col.slice(0, 3));
      item.createdAt = item.createdAt || new Date().toISOString();
      list.push(item);
      result = item;
      entry = { action: 'add', col: op.col, title: itemTitle(op.col, item) };
      break;
    }
    case 'update': {
      const list = findCollection(next, op.col);
      const idx = list.findIndex((x) => x.id === op.id);
      if (idx === -1) throw new Error('找不到項目');
      const patch = Object.assign({}, op.patch || {});
      if (op.col === 'folders') {
        delete patch.images;
        delete patch.address;
        delete patch.website;
      }
      if (op.col === 'budgets') {
        if ('amount' in patch) patch.amount = Number(patch.amount) || 0;
        if ('group' in patch) patch.group = String(patch.group || '');
        if ('name' in patch) patch.name = String(patch.name || '');
        if ('note' in patch) patch.note = String(patch.note || '');
      }
      list[idx] = Object.assign({}, list[idx], patch);
      list[idx].updatedAt = new Date().toISOString();
      entry = { action: 'update', col: op.col, title: itemTitle(op.col, list[idx]) };
      break;
    }
    case 'delete': {
      const list = findCollection(next, op.col);
      const idx = list.findIndex((x) => x.id === op.id);
      if (idx === -1) throw new Error('找不到項目');
      const removed = list[idx];
      list.splice(idx, 1);
      cleanupReferences(next, op.col, op.id);
      entry = { action: 'delete', col: op.col, title: itemTitle(op.col, removed) };
      break;
    }
    case 'move': {
      const list = findCollection(next, op.col);
      const from = list.findIndex((x) => x.id === op.id);
      if (from === -1) throw new Error('找不到項目');
      const to = Math.max(0, Math.min(list.length - 1, from + Number(op.delta || 0)));
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      break;
    }
    case 'vote': {
      const list = findCollection(next, op.col);
      const item = list.find((x) => x.id === op.id);
      if (!item) throw new Error('找不到項目');
      const votes = Array.isArray(item.votes) ? item.votes.slice() : [];
      const who = op.memberId;
      if (!who) throw new Error('請先選擇你的身分');
      const i = votes.indexOf(who);
      const adding = i === -1;
      if (adding) votes.push(who); else votes.splice(i, 1);
      item.votes = votes;
      entry = { action: adding ? 'vote' : 'unvote', col: op.col, title: itemTitle(op.col, item) };
      break;
    }
    case 'assign': {
      const list = findCollection(next, op.col);
      const item = list.find((x) => x.id === op.id);
      if (!item) throw new Error('找不到項目');
      item.memberIds = Array.isArray(op.memberIds) ? op.memberIds.slice() : [];
      entry = { action: 'assign', col: op.col, title: item.name || '', detail: String(item.memberIds.length) };
      break;
    }
    case 'addItem': {
      const folder = next.folders.find((f) => f.id === op.folderId);
      if (!folder) throw new Error('找不到資料夾');
      if (!Array.isArray(folder.items)) folder.items = [];
      const item = Object.assign({ type: 'text', votes: [] }, op.item);
      item.images = clampImages(item.images);
      item.image = item.images[0] || '';
      item.address = String(item.address || '');
      item.website = String(item.website || '');
      if (!item.id) item.id = uid('itm');
      item.createdAt = new Date().toISOString();
      folder.items.push(item);
      result = item;
      entry = { action: 'itemAdd', col: 'folders', title: folder.name, detail: item.title || '' };
      break;
    }
    case 'updateItem': {
      const folder = next.folders.find((f) => f.id === op.folderId);
      if (!folder) throw new Error('找不到資料夾');
      const item = (folder.items || []).find((x) => x.id === op.itemId);
      if (!item) throw new Error('找不到項目');
      const patch = Object.assign({}, op.patch || {});
      if ('images' in patch || 'image' in patch) {
        const imgs = clampImages('images' in patch ? patch.images : (patch.image ? [patch.image] : []));
        patch.images = imgs;
        patch.image = imgs[0] || '';
      }
      if ('address' in patch) patch.address = String(patch.address || '');
      if ('website' in patch) patch.website = String(patch.website || '');
      Object.assign(item, patch);
      item.updatedAt = new Date().toISOString();
      entry = { action: 'itemUpdate', col: 'folders', title: folder.name, detail: item.title || '' };
      break;
    }
    case 'deleteItem': {
      const folder = next.folders.find((f) => f.id === op.folderId);
      if (!folder) throw new Error('找不到資料夾');
      const removed = (folder.items || []).find((x) => x.id === op.itemId);
      folder.items = (folder.items || []).filter((x) => x.id !== op.itemId);
      entry = { action: 'itemDelete', col: 'folders', title: folder.name, detail: removed ? removed.title || '' : '' };
      break;
    }
    case 'voteItem': {
      const folder = next.folders.find((f) => f.id === op.folderId);
      if (!folder) throw new Error('找不到資料夾');
      const item = (folder.items || []).find((x) => x.id === op.itemId);
      if (!item) throw new Error('找不到項目');
      if (!op.memberId) throw new Error('請先選擇你的身分');
      const votes = Array.isArray(item.votes) ? item.votes.slice() : [];
      const i = votes.indexOf(op.memberId);
      const adding = i === -1;
      if (adding) votes.push(op.memberId); else votes.splice(i, 1);
      item.votes = votes;
      entry = { action: adding ? 'vote' : 'unvote', col: 'folders', title: item.title || folder.name };
      break;
    }
    case 'moveItem': {
      const folder = next.folders.find((f) => f.id === op.folderId);
      if (!folder) throw new Error('找不到資料夾');
      const items = folder.items || [];
      const from = items.findIndex((x) => x.id === op.itemId);
      if (from === -1) throw new Error('找不到項目');
      const to = Math.max(0, Math.min(items.length - 1, from + Number(op.delta || 0)));
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      break;
    }
    case 'seedDemo': {
      next = Object.assign(defaultState(), seedDemo());
      normalizeFolders(next);
      normalizeBudgets(next);
      entry = { action: 'seed' };
      break;
    }
    case 'reset': {
      next = defaultState();
      normalizeFolders(next);
      entry = { action: 'reset' };
      break;
    }
    case 'save': {
      entry = { action: 'save' };
      break;
    }
    default:
      throw new Error('不支援的操作: ' + op.t);
  }

  next.version = (next.version || 0) + 1;
  next.updatedAt = new Date().toISOString();
  if (entry) recordHistory(next, ctx, entry);
  return { result, state: next };
}

/* 對外可見的狀態：未解鎖時不含記帳／預算資料與其相關歷史 */
function publicState(state, unlocked) {
  const out = Object.assign({}, state);
  out.locked = !unlocked;
  out.expenses = unlocked ? state.expenses : [];
  out.budgets = unlocked ? (state.budgets || []) : [];
  out.history = (state.history || []).filter((h) => unlocked || LOCKED_COLLECTIONS.indexOf(h.col) === -1);
  return out;
}

/* ------------------------------ 範例資料 -------------------------- */

function seedDemo() {
  const today = new Date();
  const day = (offset) => {
    const d = new Date(today.getTime() + offset * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const m1 = uid('mem'), m2 = uid('mem'), m3 = uid('mem'), m4 = uid('mem'), m5 = uid('mem');
  return {
    meta: {
      title: '京都大阪五日遊',
      destination: '日本 京都 · 大阪',
      startDate: day(30),
      endDate: day(34),
      dateTbd: false,
      baseCurrency: 'TWD',
      usdRates: defaultState().meta.usdRates,
    },
    members: [
      { id: m1, name: '小明', note: '主揪 / 總務', color: '#e4572e', type: 'adult', group: '同事' },
      { id: m2, name: '阿華', note: '攝影', color: '#17bebb', type: 'adult', group: '同事' },
      { id: m3, name: '小美', note: '素食', color: '#8e6ec8', type: 'adult', group: '家人' },
      { id: m4, name: '大雄', note: '', color: '#f2a541', type: 'adult', group: '家人' },
      { id: m5, name: '小安', note: '6 歲，需兒童座椅', color: '#2f8fd8', type: 'child', group: '家人' },
    ],
    itinerary: [
      { id: uid('iti'), date: day(30), time: '08:30', title: '桃園機場集合 → 關西機場', location: 'TPE / KIX', category: 'transport', note: '提早 2.5 小時到場，行李直掛', links: [], votes: [m1, m2] },
      { id: uid('iti'), date: day(30), time: '15:00', title: '入住京都飯店', location: '京都車站前', category: 'stay', note: 'Check-in 15:00 後', links: [], votes: [] },
      { id: uid('iti'), date: day(31), time: '09:00', title: '清水寺 · 二年坂散策', location: '東山區', category: 'sight', note: '建議租和服拍照', links: [], votes: [m2, m3] },
      { id: uid('iti'), date: day(32), time: '10:00', title: '嵐山竹林 · 小火車', location: '嵐山', category: 'sight', note: '', links: [], votes: [] },
      { id: uid('iti'), date: day(33), time: '11:00', title: '大阪心齋橋購物', location: '心齋橋', category: 'shop', note: '退稅記得帶護照', links: [], votes: [m4, m5] },
    ],
    expenses: [
      { id: uid('exp'), date: day(30), title: '機票（5人）', amount: 56000, currency: 'TWD', category: 'transport', payerId: m1, participantIds: [m1, m2, m3, m4, m5], note: '' },
      { id: uid('exp'), date: day(30), title: '京都飯店 2 晚（加床）', amount: 21000, currency: 'TWD', category: 'stay', payerId: m2, participantIds: [m1, m2, m3, m4, m5], note: '' },
      { id: uid('exp'), date: day(31), title: '午餐 · 湯豆腐', amount: 6800, currency: 'JPY', category: 'food', payerId: m3, participantIds: [m1, m2, m3, m4, m5], note: '' },
      { id: uid('exp'), date: day(31), title: '計程車', amount: 3200, currency: 'JPY', category: 'transport', payerId: m4, participantIds: [m1, m2, m3, m4], note: '' },
    ],
    budgets: [
      { id: uid('bdg'), group: '住宿', name: '民宿費用（一晚）', amount: 50000, currency: 'TWD', note: '' },
      { id: uid('bdg'), group: '住宿', name: '押金', amount: 10000, currency: 'TWD', note: '退房時退還' },
      { id: uid('bdg'), group: '住宿', name: '清潔費', amount: 2000, currency: 'TWD', note: '' },
      { id: uid('bdg'), group: '交通', name: '來回機票（5 人）', amount: 60000, currency: 'TWD', note: '含託運行李' },
      { id: uid('bdg'), group: '餐飲', name: '每日餐費（5 人 × 5 天）', amount: 25000, currency: 'TWD', note: '' },
    ],
    rooms: [
      { id: uid('rom'), name: '301 雙人房', capacity: 2, type: '雙人房', note: '有陽台', memberIds: [m1, m2] },
      { id: uid('rom'), name: '302 三人房', capacity: 3, type: '三人房', note: '加床給小孩', memberIds: [m3, m4, m5] },
    ],
    folders: [
      {
        id: uid('fld'), name: '住宿候選', category: 'stay',
        note: '大家一起投票選一間。決定了就把地址與官網補在內容裡，方便大家導航。',
        items: [
          {
            id: uid('itm'), type: 'text', title: '京都格蘭比亞飯店',
            text: '與京都車站直結，出站走地下通道 3 分鐘就到，下雨也不用撐傘。房間偏商務風格但空間比同級飯店大，2 晚約 NT$9,300/人（含早餐）。樓下就是伊勢丹，晚上回來還能買宵夜。缺點是旺季房價會再漲三成，建議早鳥訂房。',
            address: '京都府京都市下京区烏丸通塩小路下ル東塩小路町901',
            website: 'https://www.granvia-kyoto.co.jp/',
            images: [], votes: [m1, m3], createdAt: new Date().toISOString(),
          },
          {
            id: uid('itm'), type: 'text', title: '町家民宿「京の宿」',
            text: '整棟包棟、有廚房與洗衣機，適合我們 5 個人一起住。2 晚約 NT$7,800/人，比飯店便宜一些。地點在四条烏丸附近，離地鐵站走路 6 分鐘，但沒有電梯，行李要自己扛上二樓。',
            address: '京都府京都市下京区四条烏丸',
            website: '',
            images: [], votes: [m2], createdAt: new Date().toISOString(),
          },
        ],
      },
      {
        id: uid('fld'), name: '美食口袋名單', category: 'food',
        note: '看到想吃的就丟進來，記得把地址或官網填在內容裡',
        items: [
          {
            id: uid('itm'), type: 'text', title: '一蘭拉麵 京都河原町店',
            text: '24 小時營業，宵夜首選。個人座位隔間，帶小孩也方便。建議避開 12:00–13:00 與 19:00–21:00 的尖峰時段，排隊常常要 40 分鐘以上。',
            address: '京都府京都市中京区河原町通三条下ル',
            website: 'https://www.ichiran.co.jp/',
            images: [], votes: [m1, m2, m4], createdAt: new Date().toISOString(),
          },
        ],
      },
      {
        id: uid('fld'), name: '景點照片', category: 'sight',
        note: '把想去的景點照片丟進來，大家投票決定要不要排進行程。列表上只會看到第一張照片，點進來才看得到全部。',
        items: [
          {
            id: uid('itm'), type: 'image', title: '清水寺 · 東山',
            text: '建議早上 8 點前到，人潮較少，光線也最柔和。從五条坂走上來約 15 分鐘，沿路都是伴手禮店。秋季夜間特別參拜要另外買票。',
            images: ['samples/kiyomizu.svg', 'samples/kiyomizu-night.svg'],
            address: '京都府京都市東山区清水1丁目294',
            website: 'https://www.kiyomizudera.or.jp/',
            votes: [m1, m3, m4], createdAt: new Date().toISOString(),
          },
          {
            id: uid('itm'), type: 'image', title: '嵐山竹林',
            text: '清晨光線最好，搭配小火車一日遊剛剛好。竹林小徑其實不長，走到盡頭是天龍寺北門，可以順便進去庭園。',
            images: ['samples/arashiyama.svg'],
            address: '京都府京都市右京区嵯峨天龍寺芒ノ馬場町',
            website: 'https://www.sagano-kanko.co.jp/',
            votes: [m2, m3], createdAt: new Date().toISOString(),
          },
          {
            id: uid('itm'), type: 'image', title: '大阪夜景',
            text: '梅田藍天大廈空中庭園展望台，建議日落前 1 小時上去，可以同時拍到白天、夕陽與夜景三種版本。風很大，記得帶外套。',
            images: ['samples/osaka-night.svg'],
            address: '大阪府大阪市北区大淀中1丁目1-88',
            website: 'https://www.kuchu-teien.com/',
            votes: [m1, m4], createdAt: new Date().toISOString(),
          },
        ],
      },
    ],
    reminders: [
      { id: uid('rem'), title: '線上 check-in 開放', datetime: day(29) + 'T14:00', note: '起飛前 48 小時開放', priority: 'high', done: false },
      { id: uid('rem'), title: '確認護照效期 6 個月以上', datetime: day(7) + 'T20:00', note: '', priority: 'normal', done: false },
      { id: uid('rem'), title: '預訂嵐山小火車車票', datetime: day(14) + 'T09:00', note: '旺季容易客滿', priority: 'high', done: false },
    ],
  };
}
