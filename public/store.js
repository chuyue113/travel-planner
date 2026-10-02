'use strict';

/* ==================================================================
   資料層（Store）
   ------------------------------------------------------------------
   兩種模式：
   - local  ：資料存在瀏覽器 localStorage，開箱即用、單機。
   - cloud  ：資料存在 Supabase，多人共用同一份（config.js 填好即啟用）。

   安全設計：
   - 閘門關鍵字與管理員密碼都只存 SHA-256 雜湊，前端不存明文。
   - 記帳與預算資料在雲端以 AES-GCM 加密後存放，
     沒有管理員密碼的人就算直接讀資料庫也只看得到密文。
   ================================================================== */

const Store = (function () {
  const CFG = Object.assign({
    gateHash: '',
    adminHash: '',
    supabaseUrl: '',
    supabaseAnonKey: '',
    table: 'trip_state',
    bucket: 'trip-images',
    rowId: 1,
  }, window.TP_CONFIG || {});

  const LS_KEY = 'tp.state.v1';
  const PBKDF2_ITER = 120000;
  const LOCKED_KEYS = ['expenses', 'budgets'];

  let mode = 'local';
  let state = null;         // 記憶體中的完整狀態
  let unlocked = false;
  let adminPassword = '';   // 僅存在於記憶體，解鎖期間使用
  let lockedBlob = null;    // 雲端上的加密區塊（未解鎖時原樣保留）
  let hasSubtle = !!(window.crypto && window.crypto.subtle);

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ------------------------------ 小工具 -------------------------- */

  function toHex(buf) {
    const a = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
    return s;
  }

  async function sha256hex(str) {
    if (!hasSubtle) return '';
    const d = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return toHex(d);
  }

  function b64(buf) {
    const a = new Uint8Array(buf);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < a.length; i += CH) {
      s += String.fromCharCode.apply(null, a.subarray(i, i + CH));
    }
    return btoa(s);
  }

  function unb64(str) {
    const s = atob(str);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode('tp::enc::' + password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptLocked(obj) {
    if (!hasSubtle) return null;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(adminPassword, salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, iter: PBKDF2_ITER, salt: b64(salt), iv: b64(iv), data: b64(data) };
  }

  async function decryptLocked(blob) {
    if (!hasSubtle || !blob) return null;
    const salt = unb64(blob.salt);
    const iv = unb64(blob.iv);
    const key = await deriveKey(adminPassword, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, unb64(blob.data));
    return JSON.parse(dec.decode(plain));
  }

  /* ------------------------------ 雲端存取 ------------------------ */

  function baseUrl() {
    return String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  }

  function cloudEnabled() {
    return mode === 'cloud' && !!baseUrl() && !!CFG.supabaseAnonKey;
  }

  function supaHeaders(extra) {
    return Object.assign({
      apikey: CFG.supabaseAnonKey,
      Authorization: 'Bearer ' + CFG.supabaseAnonKey,
    }, extra || {});
  }

  async function cloudRead() {
    const url = baseUrl() + '/rest/v1/' + CFG.table + '?id=eq.' + CFG.rowId + '&select=*';
    const res = await fetch(url, { headers: supaHeaders(), cache: 'no-store' });
    if (!res.ok) throw new Error('讀取雲端資料失敗（' + res.status + '）');
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function cloudWrite(payload) {
    const url = baseUrl() + '/rest/v1/' + CFG.table;
    const res = await fetch(url, {
      method: 'POST',
      headers: supaHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify([Object.assign({ id: CFG.rowId }, payload)]),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('寫入雲端資料失敗（' + res.status + '）' + (txt ? ' ' + txt.slice(0, 120) : ''));
    }
  }

  async function cloudUploadImage(dataUrl) {
    const m = /^data:([\w/+.-]+);base64,([\s\S]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error('不支援的圖片格式');
    const mime = m[1];
    const bin = unb64(m[2]);
    if (bin.length > 12 * 1024 * 1024) throw new Error('圖片過大（上限 12MB）');
    const extMap = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
      'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif',
    };
    const path = uid('img') + (extMap[mime] || '.bin');
    const url = baseUrl() + '/storage/v1/object/' + CFG.bucket + '/' + path;
    const res = await fetch(url, {
      method: 'POST',
      headers: supaHeaders({ 'Content-Type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }),
      body: bin,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('圖片上傳失敗（' + res.status + '）' + (txt ? ' ' + txt.slice(0, 120) : ''));
    }
    return baseUrl() + '/storage/v1/object/public/' + CFG.bucket + '/' + path;
  }

  /* ------------------------------ 本機存取 ------------------------ */

  function localRead() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__locked) {
        lockedBlob = parsed.__locked;
        delete parsed.__locked;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function localWrite(obj) {
    const payload = Object.assign({}, obj);
    if (lockedBlob) payload.__locked = lockedBlob;
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  }

  /* ------------------------------ 圖片壓縮 ------------------------ */

  function compressImage(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      if (/^data:image\/svg\+xml/.test(dataUrl)) { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = function () {
        try {
          const w0 = img.naturalWidth || img.width;
          const h0 = img.naturalHeight || img.height;
          const scale = Math.min(1, maxSide / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const keepPng = /^data:image\/png/.test(dataUrl) && scale === 1;
          resolve(cv.toDataURL(keepPng ? 'image/png' : 'image/jpeg', quality));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  /* ------------------------------ 對外介面 ------------------------ */

  return {
    get mode() { return mode; },
    get unlocked() { return unlocked; },
    get cloud() { return cloudEnabled(); },

    /* 初始化：決定使用本機或雲端模式 */
    init: function () {
      mode = (baseUrl() && CFG.supabaseAnonKey) ? 'cloud' : 'local';
      return mode;
    },

    /* 閘門驗證：關鍵字正確才放行 */
    checkGate: async function (keyword) {
      const h = await sha256hex('tp::gate::' + String(keyword || '').trim());
      return !!h && h === CFG.gateHash;
    },

    /* 管理員驗證：密碼正確才解鎖，並同時解開加密資料 */
    unlock: async function (password) {
      const h = await sha256hex('tp::admin::' + String(password || ''));
      if (!h || h !== CFG.adminHash) return false;
      adminPassword = String(password || '');
      unlocked = true;
      /* 解開雲端／本機的加密區塊 */
      if (lockedBlob && state) {
        try {
          const secret = await decryptLocked(lockedBlob);
          if (secret) {
            for (const k of LOCKED_KEYS) state[k] = Array.isArray(secret[k]) ? secret[k] : [];
          }
        } catch (_) { /* 解密失敗：維持空白，不阻斷流程 */ }
      }
      return true;
    },

    lock: function () {
      unlocked = false;
      adminPassword = '';
      if (state) for (const k of LOCKED_KEYS) state[k] = [];
    },

    /* 讀取狀態（回傳對外版本，未解鎖時不含記帳／預算） */
    load: async function () {
      let raw = null;
      if (cloudEnabled()) {
        const row = await cloudRead();
        if (row) {
          raw = row.data || null;
          lockedBlob = raw && raw.__locked ? raw.__locked : null;
          if (raw && raw.__locked) { raw = Object.assign({}, raw); delete raw.__locked; }
        }
      } else {
        raw = localRead();
      }
      state = normalizeState(raw || defaultState());
      /* 已解鎖且記憶體中沒有明文的記帳資料 → 嘗試解密 */
      if (unlocked && lockedBlob && !(state.expenses || []).length && !(state.budgets || []).length) {
        try {
          const secret = await decryptLocked(lockedBlob);
          if (secret) for (const k of LOCKED_KEYS) state[k] = Array.isArray(secret[k]) ? secret[k] : [];
        } catch (_) { /* ignore */ }
      }
      return publicState(state, unlocked);
    },

    /* 取得完整狀態（僅供內部與匯出使用） */
    raw: function () { return state; },

    /* 套用一個操作並持久化 */
    commit: async function (op, ctx) {
      /* 圖片上傳不屬於狀態操作，單獨處理。
         注意：回傳結構必須與一般操作一致（{ result, state }），
         否則呼叫端取不到 result.url，且 S = data.state 會變成 undefined。 */
      if (op && op.t === 'upload') {
        const url = await this.upload(op.dataUrl, op.name);
        return { result: { url: url }, state: publicState(state, unlocked) };
      }
      /* 寫入前先拉一次雲端最新狀態，降低多人同時編輯的覆蓋風險 */
      if (cloudEnabled()) {
        try {
          const row = await cloudRead();
          if (row && row.data && (row.data.version || 0) > (state.version || 0)) {
            const keepLocked = lockedBlob;
            let incoming = row.data;
            if (incoming.__locked) {
              lockedBlob = incoming.__locked;
              incoming = Object.assign({}, incoming);
              delete incoming.__locked;
            } else {
              lockedBlob = keepLocked;
            }
            const merged = normalizeState(incoming);
            if (unlocked && lockedBlob) {
              try {
                const secret = await decryptLocked(lockedBlob);
                if (secret) for (const k of LOCKED_KEYS) merged[k] = Array.isArray(secret[k]) ? secret[k] : [];
              } catch (_) { /* ignore */ }
            }
            state = merged;
          }
        } catch (_) { /* 讀不到就用現有狀態 */ }
      }

      const res = applyOp(state, op, { actorId: (ctx && ctx.actorId) || '', unlocked: unlocked });
      state = res.state;

      /* 未解鎖時不可寫入記帳／預算（applyOp 已擋），但加密區塊要原樣保留 */
      await this.persist();
      return { result: res.result, state: publicState(state, unlocked) };
    },

    /* 持久化目前狀態 */
    persist: async function () {
      const snapshot = Object.assign({}, state);
      if (unlocked && hasSubtle) {
        const secret = {};
        for (const k of LOCKED_KEYS) secret[k] = Array.isArray(state[k]) ? state[k] : [];
        try {
          lockedBlob = await encryptLocked(secret);
        } catch (_) { /* 加密失敗則不覆寫舊的加密區塊 */ }
      } else if (!lockedBlob) {
        /* 未解鎖且沒有任何加密區塊：絕不可把明文記帳資料寫出去 */
        const leaked = LOCKED_KEYS.some((k) => Array.isArray(state[k]) && state[k].length);
        if (leaked) throw new Error('記帳資料已上鎖，請先解鎖再儲存');
      }
      for (const k of LOCKED_KEYS) snapshot[k] = [];
      if (lockedBlob) snapshot.__locked = lockedBlob;

      if (cloudEnabled()) {
        await cloudWrite({ data: snapshot, version: state.version, updated_at: state.updatedAt });
      } else {
        localWrite(snapshot);
      }
    },

    /* 手動保存：僅推進版本並記錄 */
    save: async function (ctx) {
      return this.commit({ t: 'save' }, ctx);
    },

    /* 圖片：雲端模式上傳到 Storage；本機模式壓縮後內嵌 */
    upload: async function (dataUrl, name) {
      if (cloudEnabled()) return cloudUploadImage(dataUrl);
      const small = await compressImage(dataUrl, 1400, 0.82);
      return small;
    },

    /* 匯出完整備份 */
    exportState: async function () {
      return JSON.parse(JSON.stringify(state));
    },

    /* 匯入備份（需已解鎖） */
    importState: async function (incoming, ctx) {
      if (!unlocked) throw new Error('匯入備份需要管理員密碼，請先解鎖');
      const payload = Object.assign({}, incoming || {});
      delete payload.__locked;
      state = normalizeState(payload);
      state.version = (state.version || 0) + 1;
      state.updatedAt = new Date().toISOString();
      recordHistory(state, { actorId: (ctx && ctx.actorId) || '' }, { action: 'import' });
      await this.persist();
      return publicState(state, unlocked);
    },

    /* 本機模式的示範資料（雲端模式由 seedDemo 操作處理） */
    isCloud: function () { return cloudEnabled(); },
  };
})();
