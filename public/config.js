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

  /* 管理員密碼：5888（保護記帳／預算／資料夾編輯／清空資料） */
  adminHash: 'd92cffdfd1ba74ef6e68b2c2fff06133bee7238a4e3ba9798e9024abbb175c6c',

  /* 雲端資料庫（Supabase）：填入後自動切換為雲端同步模式 */
  supabaseUrl: '',
  supabaseAnonKey: '',
  table: 'trip_state',
  bucket: 'trip-images',
  rowId: 1,
};
