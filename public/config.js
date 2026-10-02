'use strict';

/* ==================================================================
   部署設定（Deploy Config）
   ------------------------------------------------------------------
   這裡只放「不可公開」的雜湊值與雲端連線資訊。
   - gateHash / adminHash 是 SHA-256 雜湊，無法還原出原文。
   - supabaseUrl / supabaseAnonKey 是 Supabase 的公開連線資訊，
     anon key 在設計上就是給前端使用的。
   留空 supabaseUrl 時，程式會自動使用「本機模式」（資料存在瀏覽器）。
   ================================================================== */

window.TP_CONFIG = {
  /* 連結安全閘門：關鍵字「肉丸」 */
  gateHash: '2edc7bc97ae4153b59d0be669aa265e534095d0ad6e390e9138fc305f44403e1',

  /* 管理員密碼（保護記帳／預算／資料夾編輯／清空資料）
     已於 2026-10 由 4 位數字更換為高強度密碼，降低公開倉庫下的暴力破解風險。 */
  adminHash: '2b76d4c24ea6c01dc110adbdf4782b6795e3cb896bc8065140c25b5207c1a5ae',

  /* 查看密碼（僅能「查看」行程與房間，不能編輯）。
     行程與房間在雲端以 AES-GCM 加密存放，沒有這組密碼只看得到密文。 */
  viewHash: '7526905d339c08f2cf4d1a18285f83046bd44d76b98089a6ec54b63bbcab955a',

  /* 用管理員密碼把「查看密碼」封存起來：
     管理員解鎖後可自動取得查看權，不必再輸入一次查看密碼。
     此區塊以管理員密碼加密，沒有管理員密碼無法還原。 */
  viewSealed: {
    v: 1,
    iter: 120000,
    salt: '+qg6bswypnKRHGUMdaxjdQ==',
    iv: 'F8usyNtKvgBJ8uh3',
    data: 'rPYxv6fS+8qMy5DJbVXjdOgAmsXftGmTt1aOPw==',
  },

  /* 雲端資料庫（Supabase）：填入後自動切換為雲端同步模式 */
  supabaseUrl: 'https://qafgesdrulsroxablbjm.supabase.co',
  supabaseAnonKey: 'sb_publishable_e3NSjLvsjbP05xw7fzzq4w_f4UF53SS',
  table: 'trip_state',
  bucket: 'trip-images',
  rowId: 1,
};
