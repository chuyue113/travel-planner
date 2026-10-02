# 團體旅遊協作平台

多人出遊的行程、記帳、分房、資料彙整一站式頁面。純前端（原生 HTML/CSS/JS，零框架、零依賴），
可直接部署到 **GitHub Pages**，永久免費、不會過期。

線上網址：`https://<你的帳號>.github.io/<專案名稱>/`

---

## 功能

| 模組 | 說明 |
|---|---|
| 總覽 | 旅遊日期（可設「暫時未定」）、人數統計、支出概況 |
| 行程 | 依年月分組列表 / 月曆檢視，可投票決定去不去 |
| 記帳 | **已支出**（分類統計、每人代墊與應付、結算建議）＋ **預算花費**（依類別分組、小計與超支提醒） |
| 房間 | 房間建立與成員分配，容量提醒 |
| 資料夾 | 純容器（名稱／分類／備註）→ 內容（文字／圖片／地址／官網），內容可投票 |
| 提醒 | 待辦提醒與到期通知 |
| 成員 | 自訂分組名稱，分類成人／小孩並統計人數 |

三語介面：繁體中文 / 简体中文 / English。響應式：手機、平板、桌機。
兩套配色：青綠（teal）與玫瑰粉（rose），支援淺色／深色。

---

## 安全設計

| 機制 | 說明 |
|---|---|
| 連結閘門 | 開啟網址需先輸入關鍵字 **肉丸**，通過後才載入資料 |
| 管理員密碼 | **5888**，保護記帳／預算檢視、資料夾編輯、清空資料、載入示範資料 |
| 資料加密 | 記帳與預算在儲存前以 **AES-GCM（PBKDF2 12 萬次迭代）** 加密，沒密碼只能看到密文 |
| 零明文 | 網頁原始碼與資料庫中都不存在關鍵字與密碼的明文，只存 SHA-256 雜湊 |

> 提醒：閘門與密碼屬於「防誤入、防隨手翻看」等級的保護，適合朋友／家庭出遊分享使用。

---

## 部署到 GitHub Pages

1. 把本專案推上 GitHub（分支 `main`）。
2. 進入 repo 的 **Settings → Pages**，把 **Source** 設為 **GitHub Actions**。
3. 推送後 Actions 會自動把 `public/` 目錄部署上線（工作流程見 `.github/workflows/deploy.yml`）。
4. 等 1～2 分鐘，網址即為 `https://<你的帳號>.github.io/<專案名稱>/`。

之後每次 `git push` 到 `main` 都會自動重新部署。

---

## 開啟雲端同步（選用，多人共用同一份資料）

預設為**本機模式**：資料存在你自己的瀏覽器，換裝置或換人看不到。
若要多人共用同一份資料，接上免費的 Supabase：

### 1. 建立專案
到 [supabase.com](https://supabase.com) 用 GitHub 帳號登入 → **New project** →
Region 選 **Singapore** 或 **Tokyo**。

### 2. 建立資料表
在 **SQL Editor** 執行：

```sql
-- 狀態表：整個行程存在單一資料列
create table if not exists trip_state (
  id          int primary key,
  data        jsonb not null default '{}'::jsonb,
  version     int  not null default 1,
  updated_at  timestamptz not null default now()
);

insert into trip_state (id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- 允許前端讀寫（資料本身以加密保護敏感欄位）
alter table trip_state enable row level security;

create policy "read"   on trip_state for select using (true);
create policy "insert" on trip_state for insert with check (true);
create policy "update" on trip_state for update using (true) with check (true);
```

### 3. 建立圖片空間
在 **Storage** 建立名為 `trip-images` 的 bucket，並設為 **Public**。

### 4. 填入設定
編輯 `public/config.js`：

```js
supabaseUrl: 'https://xxxxxxxx.supabase.co',
supabaseAnonKey: 'eyJhbGciOi...',
```

推上去後即自動切換為雲端模式。

---

## 目錄結構

```
├── .github/workflows/deploy.yml   # GitHub Pages 自動部署
├── public/                        # 網站本體（部署這個目錄）
│   ├── index.html
│   ├── config.js                  # 閘門／密碼雜湊、雲端設定
│   ├── core.js                    # 核心邏輯：狀態正規化與所有操作
│   ├── store.js                   # 資料層：本機 / 雲端、加解密
│   ├── i18n.js                    # 三語字典
│   ├── app.js                     # 介面渲染與互動
│   ├── styles.css
│   └── samples/                   # 示範圖片
└── README.md
```

---

## 本機預覽

```bash
cd public
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

> 加密功能需要安全來源（HTTPS 或 localhost），本機請用 `localhost` 而非 IP 存取。
