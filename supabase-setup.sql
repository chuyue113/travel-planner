-- ==================================================================
-- 團體旅遊協作平台 — Supabase 資料表初始化
-- 使用方式：Supabase 後台 → SQL Editor → 貼上全文 → Run
-- ==================================================================

-- 1) 狀態表：整個行程存在單一資料列（id = 1）
create table if not exists trip_state (
  id          int primary key,
  data        jsonb not null default '{}'::jsonb,
  version     int  not null default 1,
  updated_at  timestamptz not null default now()
);

insert into trip_state (id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- 2) 開啟資料列級安全（RLS）
alter table trip_state enable row level security;

-- 3) 允許前端（anon）讀寫；敏感的記帳／預算欄位已在前端加密
drop policy if exists "trip_read"   on trip_state;
drop policy if exists "trip_insert" on trip_state;
drop policy if exists "trip_update" on trip_state;

create policy "trip_read"   on trip_state for select using (true);
create policy "trip_insert" on trip_state for insert with check (true);
create policy "trip_update" on trip_state for update using (true) with check (true);

-- 4) 圖片空間（公開讀取）
insert into storage.buckets (id, name, public)
values ('trip-images', 'trip-images', true)
on conflict (id) do update set public = true;

-- 5) 允許前端上傳圖片到 trip-images
drop policy if exists "img_read"   on storage.objects;
drop policy if exists "img_write"  on storage.objects;

create policy "img_read" on storage.objects
  for select using (bucket_id = 'trip-images');

create policy "img_write" on storage.objects
  for insert with check (bucket_id = 'trip-images');
