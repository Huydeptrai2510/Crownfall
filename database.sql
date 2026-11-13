-- =====================================================================================
-- CROWNFALL — database.sql  (Supabase Postgres)
-- Chạy MỘT LẦN trong Supabase → SQL Editor (chạy lại được). Xong chạy:
--   select public.cf_selftest();   select public.cf_phase4_selftest();   → cả hai phải ra "ok": true
-- Đăng nhập dùng Supabase Auth (email nội bộ suy ra từ username). user_id lưu dạng TEXT = auth.uid()::text,
-- không đặt khóa ngoại sang auth.users để không phụ thuộc schema nội bộ của Supabase.
-- HELO (điểm xếp hạng) khởi đầu = 0, sàn 0.
-- =====================================================================================

-- Supabase mặc định cấp toàn quyền cho anon/authenticated trên mọi bảng/hàm mới. Ở đây ngược lại: không cấp gì
-- mặc định, chỉ cấp đúng thứ cần (GRANT tường minh bên dưới) + RLS. Đặt TRƯỚC khi tạo bảng/hàm.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Danh tính người gọi: sub của JWT Supabase (uuid) dưới dạng text.
create or replace function public.cf_uid() returns text
language sql stable as $$ select nullif(auth.uid()::text, '') $$;
grant execute on function public.cf_uid() to authenticated;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename = any (array[
      'profiles','user_roles','user_settings','friendships','rooms','room_members',
      'room_settings','matches','match_moves','match_snapshots','match_events',
      'replay_preferences','rating_profiles','rating_events','weekly_stats',
      'reports','admin_logs','app_settings'])
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- 1. Bảng ----------
create table if not exists public.profiles (
  user_id      text primary key,
  username     text not null,
  display_name text not null,
  avatar_url   text,
  bio          text not null default '',
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint profiles_username_fmt check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_len  check (char_length(display_name) between 1 and 40),
  constraint profiles_avatar_https check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500)),
  constraint profiles_bio_len      check (char_length(bio) <= 280),
  constraint profiles_status_chk   check (status in ('active','suspended','banned'))
);
create unique index if not exists profiles_username_uq on public.profiles (username);

create table if not exists public.user_roles (
  user_id    text primary key references public.profiles(user_id) on delete cascade,
  role       text not null default 'user' check (role in ('user','admin','boss')),
  granted_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id             text primary key references public.profiles(user_id) on delete cascade,
  sound_enabled       boolean not null default true,
  reduce_motion       boolean not null default false,
  show_online_status  boolean not null default true,
  locale              text not null default 'vi' check (locale in ('vi','en')),
  updated_at          timestamptz not null default now()
);

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id text not null references public.profiles(user_id) on delete cascade,
  addressee_id text not null references public.profiles(user_id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','blocked')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_uq
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{6,8}$'),
  owner_id    text not null references public.profiles(user_id) on delete cascade,
  status      text not null default 'open' check (status in ('open','playing','closed')),
  max_players smallint not null default 2 check (max_players = 2),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists rooms_owner_idx on public.rooms (owner_id);

create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   text not null references public.profiles(user_id) on delete cascade,
  side      text not null default 'spectator' check (side in ('red','blue','spectator')),
  joined_at timestamptz not null default now(),
  left_at   timestamptz,
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members (user_id);
create unique index if not exists room_members_side_uq
  on public.room_members (room_id, side) where side in ('red','blue') and left_at is null;

create table if not exists public.room_settings (
  room_id             uuid primary key references public.rooms(id) on delete cascade,
  time_control_secs   integer not null default 600 check (time_control_secs between 30 and 7200),
  allow_spectators    boolean not null default true,
  is_private          boolean not null default true,
  board_variant       text not null default 'standard',
  updated_at          timestamptz not null default now()
);

create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  red_id      text not null references public.profiles(user_id),
  blue_id     text not null references public.profiles(user_id),
  status      text not null default 'pending' check (status in ('pending','active','finished','aborted')),
  winner_side text check (winner_side in ('red','blue','draw')),
  result_reason text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz,
  check (red_id <> blue_id)
);
create index if not exists matches_room_idx on public.matches (room_id);
create index if not exists matches_red_idx  on public.matches (red_id);
create index if not exists matches_blue_idx on public.matches (blue_id);

create table if not exists public.match_moves (
  id         bigint generated always as identity primary key,
  match_id   uuid not null references public.matches(id) on delete cascade,
  ply        integer not null check (ply >= 1),
  player_id  text not null references public.profiles(user_id),
  piece      text not null,
  from_sq    text,
  to_sq      text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, ply)
);

create table if not exists public.match_snapshots (
  id         bigint generated always as identity primary key,
  match_id   uuid not null references public.matches(id) on delete cascade,
  ply        integer not null check (ply >= 0),
  state      jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, ply)
);

create table if not exists public.match_events (
  id         bigint generated always as identity primary key,
  match_id   uuid not null references public.matches(id) on delete cascade,
  event_type text not null,
  actor_id   text references public.profiles(user_id),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists match_events_match_idx on public.match_events (match_id, created_at);

create table if not exists public.replay_preferences (
  user_id      text primary key references public.profiles(user_id) on delete cascade,
  autoplay     boolean not null default false,
  speed        numeric(3,1) not null default 1.0 check (speed between 0.5 and 4.0),
  show_coords  boolean not null default true,
  updated_at   timestamptz not null default now()
);

create table if not exists public.rating_profiles (
  user_id      text primary key references public.profiles(user_id) on delete cascade,
  rating       integer not null default 0 check (rating >= 0),
  peak_rating  integer not null default 0,
  games_played integer not null default 0 check (games_played >= 0),
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,
  updated_at   timestamptz not null default now()
);
create index if not exists rating_profiles_rating_idx on public.rating_profiles (rating desc);

create table if not exists public.rating_events (
  id            bigint generated always as identity primary key,
  user_id       text not null references public.profiles(user_id) on delete cascade,
  match_id      uuid references public.matches(id) on delete set null,
  delta         integer not null,
  rating_before integer not null,
  rating_after  integer not null,
  created_at    timestamptz not null default now()
);
create index if not exists rating_events_user_idx on public.rating_events (user_id, created_at desc);

create table if not exists public.weekly_stats (
  user_id      text not null references public.profiles(user_id) on delete cascade,
  week_start   date not null,
  games        integer not null default 0,
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,
  rating_delta integer not null default 0,
  primary key (user_id, week_start)
);

create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    text not null references public.profiles(user_id) on delete cascade,
  target_user_id text not null references public.profiles(user_id) on delete cascade,
  match_id       uuid references public.matches(id) on delete set null,
  reason         text not null check (char_length(reason) between 5 and 1000),
  status         text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at     timestamptz not null default now(),
  resolved_by    text references public.profiles(user_id),
  resolved_at    timestamptz,
  check (reporter_id <> target_user_id)
);
create index if not exists reports_status_idx on public.reports (status, created_at);

create table if not exists public.admin_logs (
  id          bigint generated always as identity primary key,
  admin_id    text not null references public.profiles(user_id),
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.app_settings (key, value, is_public)
values ('maintenance', 'false'::jsonb, true)
on conflict (key) do nothing;

-- ---------- 2. Hàm hỗ trợ (SECURITY DEFINER để RLS không đệ quy) ----------
create or replace function public.is_admin() returns boolean   -- admin HOẶC boss (Phase 4); kiểm tra ở database, không tin client
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles r join public.profiles p on p.user_id = r.user_id
                 where r.user_id = public.cf_uid() and r.role in ('admin','boss') and p.status = 'active');
$$;
create or replace function public.is_boss() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles r join public.profiles p on p.user_id = r.user_id
                 where r.user_id = public.cf_uid() and r.role = 'boss' and p.status = 'active');
$$;

create or replace function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = p_room and user_id = public.cf_uid())
      or exists (select 1 from public.rooms where id = p_room and owner_id = public.cf_uid());
$$;

create or replace function public.is_match_participant(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matches m
                 where m.id = p_match
                   and (m.red_id = public.cf_uid() or m.blue_id = public.cf_uid()
                        or public.is_room_member(m.room_id)));
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.set_updated_at();
drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.set_updated_at();

create or replace function public.friendship_respond_ts() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then new.responded_at = now(); end if;
  return new;
end $$;
drop trigger if exists friendships_respond on public.friendships;
create trigger friendships_respond before update on public.friendships
  for each row execute function public.friendship_respond_ts();

-- Tạo hồ sơ cho người dùng đang đăng nhập (idempotent). Client không INSERT trực tiếp.
create or replace function public.ensure_profile(p_username text, p_display_name text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  uid text := public.cf_uid();
  u   text := lower(coalesce(p_username, ''));
  row public.profiles;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into row from public.profiles where user_id = uid;
  if found then return row; end if;
  insert into public.profiles (user_id, username, display_name)
  values (uid, u, left(coalesce(nullif(btrim(p_display_name), ''), u), 40))
  returning * into row;                       -- vi phạm unique/check sẽ ném lỗi (23505/23514)
  insert into public.user_roles (user_id) values (uid) on conflict do nothing;
  insert into public.user_settings (user_id) values (uid) on conflict do nothing;
  insert into public.rating_profiles (user_id) values (uid) on conflict do nothing;
  insert into public.replay_preferences (user_id) values (uid) on conflict do nothing;
  return row;
end $$;

create or replace function public.change_username(p_username text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
begin
  -- Tên người dùng chính là tên đăng nhập (email nội bộ suy ra từ username) nên không cho đổi.
  raise exception 'username_locked';
end $$;

revoke all on function public.ensure_profile(text, text) from public;
revoke all on function public.change_username(text)     from public;
grant execute on function public.ensure_profile(text, text) to authenticated;
grant execute on function public.change_username(text)     to authenticated;
grant execute on function public.is_admin()                 to authenticated;
grant execute on function public.is_room_member(uuid)       to authenticated;
grant execute on function public.is_match_participant(uuid) to authenticated;

-- ---------- 3. Bật RLS (mọi bảng) ----------
alter table public.profiles           enable row level security;
alter table public.user_roles         enable row level security;
alter table public.user_settings      enable row level security;
alter table public.friendships        enable row level security;
alter table public.rooms              enable row level security;
alter table public.room_members       enable row level security;
alter table public.room_settings      enable row level security;
alter table public.matches            enable row level security;
alter table public.match_moves        enable row level security;
alter table public.match_snapshots    enable row level security;
alter table public.match_events       enable row level security;
alter table public.replay_preferences enable row level security;
alter table public.rating_profiles    enable row level security;
alter table public.rating_events      enable row level security;
alter table public.weekly_stats       enable row level security;
alter table public.reports            enable row level security;
alter table public.admin_logs         enable row level security;
alter table public.app_settings       enable row level security;

-- ---------- 4. Policy ----------
-- profiles: người đã đăng nhập xem được hồ sơ; chỉ sửa hồ sơ của mình
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = public.cf_uid()) with check (user_id = public.cf_uid());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = public.cf_uid() or public.is_admin());

create policy user_settings_own on public.user_settings for all to authenticated
  using (user_id = public.cf_uid()) with check (user_id = public.cf_uid());
create policy replay_prefs_own on public.replay_preferences for all to authenticated
  using (user_id = public.cf_uid()) with check (user_id = public.cf_uid());

create policy friendships_select on public.friendships for select to authenticated
  using (requester_id = public.cf_uid() or addressee_id = public.cf_uid());
create policy friendships_insert on public.friendships for insert to authenticated
  with check (requester_id = public.cf_uid() and status = 'pending');
create policy friendships_respond on public.friendships for update to authenticated
  using (addressee_id = public.cf_uid() and status = 'pending')
  with check (addressee_id = public.cf_uid() and status in ('accepted','declined'));
create policy friendships_delete on public.friendships for delete to authenticated
  using (requester_id = public.cf_uid() or addressee_id = public.cf_uid());

create policy rooms_select on public.rooms for select to authenticated using (public.is_room_member(id));
create policy room_members_select on public.room_members for select to authenticated
  using (user_id = public.cf_uid() or public.is_room_member(room_id));
create policy room_settings_select on public.room_settings for select to authenticated
  using (public.is_room_member(room_id));

create policy matches_select on public.matches for select to authenticated
  using (public.is_match_participant(id));
create policy match_moves_select on public.match_moves for select to authenticated
  using (public.is_match_participant(match_id));
create policy match_snapshots_select on public.match_snapshots for select to authenticated
  using (public.is_match_participant(match_id));
create policy match_events_select on public.match_events for select to authenticated
  using (public.is_match_participant(match_id));

create policy rating_profiles_select on public.rating_profiles for select to authenticated using (true);
create policy rating_events_select on public.rating_events for select to authenticated
  using (user_id = public.cf_uid());
create policy weekly_stats_select on public.weekly_stats for select to authenticated using (true);

-- reports: client KHÔNG insert trực tiếp (Phase 4: dùng RPC submit_report có giới hạn tốc độ)
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = public.cf_uid() or public.is_admin());
-- reports: xử lý báo cáo chỉ qua RPC admin_user_action (có audit log)

-- admin_logs (audit): client KHÔNG đọc/ghi trực tiếp; chỉ RPC get_audit_logs và hàm nội bộ cf_audit

create policy app_settings_select on public.app_settings for select to authenticated
  using (is_public or public.is_admin());
-- app_settings: chỉ Boss sửa, qua RPC boss_update_setting (có audit log)

-- ---------- 5. GRANT (quyền tối thiểu; RLS lọc thêm theo dòng) ----------
grant usage on schema public to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
  end if;
end $$;

grant select on public.profiles, public.user_roles, public.rooms, public.room_members,
  public.room_settings, public.matches, public.match_moves, public.match_snapshots,
  public.match_events, public.rating_profiles, public.rating_events, public.weekly_stats,
  public.app_settings to authenticated;
grant update (display_name, avatar_url, bio, last_seen_at) on public.profiles to authenticated;
grant select, update (sound_enabled, reduce_motion, show_online_status, locale)
  on public.user_settings to authenticated;
grant select, update (autoplay, speed, show_coords) on public.replay_preferences to authenticated;
grant select, insert, delete on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;
grant select on public.reports to authenticated;
-- INSERT/DELETE profiles, user_roles, rooms, matches, rating_*: KHÔNG cấp cho client.
-- Boss đầu tiên được bootstrap thủ công trong Supabase SQL Editor (xem README, mục Bootstrap Boss).

-- =====================================================================
-- PHASE 2 — CONTRACT DỮ LIỆU NƯỚC ĐI & SNAPSHOT (tương thích Phase 1, chạy lại được)
-- Engine (script.js) tạo bản ghi theo MoveHistory.toRow() và snapshot theo GameState.snapshot().
-- KHÔNG tin dữ liệu client gửi: client vẫn KHÔNG có quyền INSERT vào các bảng này.
-- Phase 3 sẽ thêm hàm SECURITY DEFINER (vd. public.submit_move) dựng lại luật Beta 5.1 phía server,
-- kiểm tra lượt/chủ quân/nước đi hợp lệ rồi mới ghi match_moves + match_snapshots + match_events.
-- Quy ước: P1 (trên, Phe Xanh) ↔ matches.blue_id; P2 (dưới, Phe Đỏ, đi trước) ↔ matches.red_id.
-- =====================================================================
alter table public.matches add column if not exists rules_version text not null default 'crownfall-beta-5.1';

alter table public.match_moves
  add column if not exists move_number    integer,
  add column if not exists piece_id       text,
  add column if not exists piece_type     text,
  add column if not exists from_row       smallint,
  add column if not exists from_col       smallint,
  add column if not exists to_row         smallint,
  add column if not exists to_col         smallint,
  add column if not exists captured_piece jsonb,
  add column if not exists action_type    text,
  add column if not exists state_snapshot jsonb;

-- Cột Phase 1 (piece, to_sq) trở thành tuỳ chọn: tọa độ chính thức nay là from_/to_ row/col.
alter table public.match_moves alter column piece drop not null;
alter table public.match_moves alter column to_sq drop not null;

do $$
begin
  alter table public.match_moves drop constraint if exists match_moves_p2_chk;
  alter table public.match_moves add constraint match_moves_p2_chk check (
    (move_number is null or move_number = ply)
    and (piece_type is null or piece_type in ('L','V','M','C','S','G','N','T'))
    and (action_type is null or action_type in ('move','capture','swap'))
    and (from_row is null or from_row between 0 and 8) and (from_col is null or from_col between 0 and 8)
    and (to_row   is null or to_row   between 0 and 8) and (to_col   is null or to_col   between 0 and 8)
    and (state_snapshot is null or jsonb_typeof(state_snapshot -> 'version') = 'number')
  );
  alter table public.match_snapshots drop constraint if exists match_snapshots_version_chk;
  alter table public.match_snapshots add constraint match_snapshots_version_chk check (
    jsonb_typeof(state -> 'version') = 'number' and jsonb_typeof(state -> 'board') = 'array'
  );
end $$;

comment on column public.match_moves.state_snapshot is
  'JSONB version 1: {version, rules, turn, move_number, winner, win_reason, board:[{id,type,owner,row,col}]} — trạng thái SAU nước đi';
comment on column public.match_moves.captured_piece is
  'JSONB: quân bị bắt {id,type,owner,row,col,chain:[...]}; chain = Thuật còn lại bị loại kèm theo';

-- =====================================================================
-- PHASE 3 — MULTIPLAYER: phòng riêng, bạn bè, ghép nhanh, khán giả, đồng hồ lượt,
--           đầu hàng, xin hòa, rematch, reconnect.   (chạy lại được; chạy SAU phần Phase 1–2 ở trên)
--
-- NGUYÊN TẮC: database là nguồn sự thật. Client chỉ có SELECT (RLS) + gọi RPC (SECURITY DEFINER).
--  - Luật Crownfall Beta 5.1 được PORT sang PL/pgSQL (nhóm hàm cf_*, KHÔNG cấp cho client) từ engine JS.
--    Chạy `select public.cf_selftest();` để đối chiếu với engine JS (xem cuối file).
--  - Mọi RPC lấy danh tính từ public.cf_uid(); không nhận user_id/winner/role từ client.
--  - Không có realtime: client polling get_*_state (xem README).
--  - Chưa có cron: hết giờ được xử lý "lười" (lazy) bởi bất kỳ lời gọi nào chạm tới trận quá hạn.
--  - Chưa cập nhật HELO (để Phase 4); trận ranked chỉ được đánh dấu matches.ranked = true.
-- =====================================================================

-- ---------- 6.1 Cột mới ----------
alter table public.rooms
  add column if not exists mode text not null default 'private',
  add column if not exists rev  integer not null default 1;

alter table public.room_settings
  add column if not exists turn_seconds integer not null default 60;

alter table public.matches
  add column if not exists mode                  text    not null default 'private',
  add column if not exists ranked                boolean not null default false,
  add column if not exists version               integer not null default 0,      -- = số nước đã đi (ply); dùng cho khóa lạc quan
  add column if not exists rev                   integer not null default 1,      -- tăng ở MỌI thay đổi hiển thị (nước đi, hòa, kết thúc, rematch)
  add column if not exists turn_side             text    not null default 'red',  -- P2 = red đi trước
  add column if not exists turn_started_at       timestamptz,
  add column if not exists turn_deadline_at      timestamptz,
  add column if not exists turn_duration_seconds integer not null default 60,
  add column if not exists winner_id             text references public.profiles(user_id),
  add column if not exists end_reason            text,
  add column if not exists in_check              boolean not null default false,
  add column if not exists state                 jsonb,                           -- snapshot version 1 HIỆN TẠI
  add column if not exists draw_offer_by         text,
  add column if not exists draw_declined_at_ply  integer,
  add column if not exists red_seen_at           timestamptz,
  add column if not exists blue_seen_at          timestamptz,
  add column if not exists previous_match_id     uuid references public.matches(id);

alter table public.match_moves add column if not exists client_move_id uuid;
create unique index if not exists match_moves_client_uq
  on public.match_moves (match_id, client_move_id) where client_move_id is not null;

do $$
begin
  alter table public.rooms drop constraint if exists rooms_mode_chk;
  alter table public.rooms add constraint rooms_mode_chk check (mode in ('private','friend','quick'));
  alter table public.room_settings drop constraint if exists room_settings_turn_chk;
  alter table public.room_settings add constraint room_settings_turn_chk check (turn_seconds in (30,60,90,120));
  alter table public.matches drop constraint if exists matches_p3_chk;
  alter table public.matches add constraint matches_p3_chk check (
    mode in ('private','friend','quick')
    and turn_side in ('red','blue')
    and turn_duration_seconds in (30,60,90,120)
    and version >= 0
    and (end_reason is null or end_reason in ('king_captured','no_legal_moves','timeout','resignation','draw_agreement'))
    and (status <> 'finished' or end_reason is not null)
  );
end $$;

-- ---------- 6.2 Bảng mới ----------
create table if not exists public.game_invites (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  from_id      text not null references public.profiles(user_id) on delete cascade,
  to_id        text not null references public.profiles(user_id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','expired','cancelled')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '5 minutes',
  responded_at timestamptz,
  check (from_id <> to_id)
);
create unique index if not exists game_invites_pending_uq on public.game_invites (room_id, to_id) where status = 'pending';
create index if not exists game_invites_to_idx on public.game_invites (to_id, status);

create table if not exists public.quick_queue (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references public.profiles(user_id) on delete cascade,
  rating       integer not null,
  status       text not null default 'waiting' check (status in ('waiting','matched','cancelled','expired')),
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  match_id     uuid references public.matches(id) on delete set null
);
create unique index if not exists quick_queue_one_waiting on public.quick_queue (user_id) where status = 'waiting';
create index if not exists quick_queue_status_idx on public.quick_queue (status, joined_at);

-- Mỗi tài khoản tối đa MỘT trận đang chơi (PK bảo đảm ở mức dữ liệu, chống race condition).
create table if not exists public.match_players_active (
  user_id  text primary key references public.profiles(user_id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade
);

-- Phiếu rematch tách riêng để trận cũ (kết quả, nước đi, snapshot) không bị sửa.
create table if not exists public.match_rematches (
  match_id     uuid primary key references public.matches(id) on delete cascade,
  red_vote     text check (red_vote in ('yes','no')),
  blue_vote    text check (blue_vote in ('yes','no')),
  new_match_id uuid references public.matches(id),
  updated_at   timestamptz not null default now()
);

alter table public.game_invites         enable row level security;
alter table public.quick_queue          enable row level security;
alter table public.match_players_active enable row level security;   -- không policy => client không đọc/ghi
alter table public.match_rematches      enable row level security;

drop policy if exists game_invites_select  on public.game_invites;
drop policy if exists quick_queue_select   on public.quick_queue;
drop policy if exists match_rematch_select on public.match_rematches;
create policy game_invites_select on public.game_invites for select to authenticated
  using (from_id = public.cf_uid() or to_id = public.cf_uid());
create policy quick_queue_select on public.quick_queue for select to authenticated
  using (user_id = public.cf_uid());
create policy match_rematch_select on public.match_rematches for select to authenticated
  using (public.is_match_participant(match_id));
grant select on public.game_invites, public.quick_queue, public.match_rematches to authenticated;

-- Người đã rời phòng không còn đọc được phòng; chủ phòng chỉ đọc khi phòng chưa đóng.
create or replace function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = p_room and user_id = public.cf_uid() and left_at is null)
      or exists (select 1 from public.rooms where id = p_room and owner_id = public.cf_uid() and status <> 'closed');
$$;

-- Trạng thái hoạt động do heartbeat RPC ghi; client không tự sửa last_seen_at nữa.
revoke update (last_seen_at) on public.profiles from authenticated;

-- =====================================================================
-- 7. ENGINE LUẬT BETA 5.1 (PL/pgSQL) — port từ engine JS trong script.js
--    Bàn cờ: smallint[81], chỉ số = hàng*9 + cột + 1. Giá trị 0 = ô trống; ngược lại = chủ*10 + loại,
--    chủ: 1 = P1 (Xanh, trên), 2 = P2 (Đỏ, dưới, đi trước); loại: 1 L,2 V,3 M,4 C,5 S,6 G,7 N,8 T.
--    ids: text[81] song song (id quân, vd 'P2-L3') — giữ đúng contract snapshot version 1.
--    Giả định A1–A7 giữ nguyên như engine JS (xem README Phase 2).
-- =====================================================================
create or replace function public.cf_tcode(t text) returns integer language sql immutable as
$$ select position(t in 'LVMCSGNT') $$;
create or replace function public.cf_tchar(n integer) returns text language sql immutable as
$$ select substr('LVMCSGNT', n, 1) $$;

create or replace function public.cf_find(cells smallint[], o integer, typ integer) returns integer[]
language plpgsql immutable as $$
declare i integer; res integer[] := '{}';
begin
  for i in 1..81 loop if cells[i] = o * 10 + typ then res := res || i; end if; end loop;
  return res;
end $$;

-- Đường Cấm áp lên quân của `o`: các ô GIỮA Mã và Ngưu của đối phương cùng hàng/cột.
create or replace function public.cf_forbidden(cells smallint[], o integer) returns integer[]
language plpgsql immutable as $$
declare e integer := 3 - o; m integer; n integer; mr integer; mc integer; nr integer; nc integer; k integer; res integer[] := '{}';
begin
  m := (public.cf_find(cells, e, 3))[1]; n := (public.cf_find(cells, e, 7))[1];
  if m is null or n is null then return res; end if;
  mr := (m - 1) / 9; mc := (m - 1) % 9; nr := (n - 1) / 9; nc := (n - 1) % 9;
  if mr = nr then
    for k in least(mc, nc) + 1 .. greatest(mc, nc) - 1 loop res := res || (mr * 9 + k + 1); end loop;
  elsif mc = nc then
    for k in least(mr, nr) + 1 .. greatest(mr, nr) - 1 loop res := res || (k * 9 + mc + 1); end loop;
  end if;
  return res;
end $$;

create or replace function public.cf_pair_active(cells smallint[], o integer) returns boolean
language plpgsql immutable as $$
declare t integer[] := public.cf_find(cells, o, 8);
begin
  return coalesce(array_length(t, 1), 0) = 2
     and ((t[1] - 1) / 9 = (t[2] - 1) / 9 or (t[1] - 1) % 9 = (t[2] - 1) % 9);
end $$;

create or replace function public.cf_supported(cells smallint[], p integer) returns boolean
language plpgsql immutable as $$
declare o integer := cells[p] / 10; r integer := (p - 1) / 9; c integer := (p - 1) % 9; i integer;
begin
  if cells[p] % 10 = 8 then return false; end if;
  for i in 1..81 loop
    if cells[i] = o * 10 + 8 and ((i - 1) / 9 = r or (i - 1) % 9 = c) then return true; end if;
  end loop;
  return false;
end $$;

-- Đếm đồng minh của `o` trong 8 ô quanh ô t (tính cả Lính đang bắt nếu đứng kề: RULES_OPTIONS.SOLDIER_COUNTS_CAPTURER = true).
create or replace function public.cf_allies_around(cells smallint[], t integer, o integer) returns integer
language plpgsql immutable as $$
declare r integer := (t - 1) / 9; c integer := (t - 1) % 9; dr integer; dc integer; n integer := 0; nr integer; nc integer;
begin
  for dr in -1..1 loop for dc in -1..1 loop
    if dr <> 0 or dc <> 0 then
      nr := r + dr; nc := c + dc;
      if nr between 0 and 8 and nc between 0 and 8 and cells[nr * 9 + nc + 1] <> 0 and cells[nr * 9 + nc + 1] / 10 = o then n := n + 1; end if;
    end if;
  end loop; end loop;
  return n;
end $$;

create or replace function public.cf_can_capture(cells smallint[], p integer, t integer) returns boolean
language plpgsql immutable as $$
declare o integer := cells[p] / 10; typ integer := cells[p] % 10; ttyp integer := cells[t] % 10;
        tr integer := (t - 1) / 9; tc integer := (t - 1) % 9; pr integer := (p - 1) / 9; pc integer := (p - 1) % 9;
begin
  if ttyp = 6 and tr <> 4 then return false; end if;          -- Gấu ngoài biên giới bất tử
  case typ
    when 1 then return public.cf_supported(cells, p) or public.cf_allies_around(cells, t, o) >= 2;
    when 2 then return public.cf_supported(cells, p);
    when 3, 4, 7 then return true;
    when 5 then return public.cf_supported(cells, p) or greatest(abs(tr - pr), abs(tc - pc)) = 2;
    when 6 then return pr = 4;
    when 8 then return public.cf_pair_active(cells, o);
    else return false;
  end case;
end $$;

-- Nước đi giả-hợp-lệ của quân ở ô p (chưa xét Vua bị chiếu).
create or replace function public.cf_moves(cells smallint[], p integer)
returns table(to_idx integer, is_cap boolean) language plpgsql immutable as $$
declare
  o integer := cells[p] / 10; typ integer := cells[p] % 10; r integer := (p - 1) / 9; c integer := (p - 1) % 9;
  forb integer[] := public.cf_forbidden(cells, cells[p] / 10);
  dr integer[] := array[-1,1,0,0,-1,-1,1,1]; dc integer[] := array[0,0,-1,1,-1,1,-1,1];
  nd integer; mx integer; d integer; s integer; nr integer; nc integer; ti integer; q integer; a integer; b integer;
begin
  if typ = 5 then                                   -- Sói: nhảy trong vùng 5×5 (A3)
    for a in -2..2 loop for b in -2..2 loop
      if a <> 0 or b <> 0 then
        nr := r + a; nc := c + b;
        if nr between 0 and 8 and nc between 0 and 8 then
          ti := nr * 9 + nc + 1; q := cells[ti];
          if not (ti = any(forb)) then
            if q = 0 then to_idx := ti; is_cap := false; return next;
            elsif q / 10 <> o and public.cf_can_capture(cells, p, ti) then to_idx := ti; is_cap := true; return next;
            end if;
          end if;
        end if;
      end if;
    end loop; end loop;
    return;
  end if;
  nd := case when typ in (1,2,3,4) then 8 else 4 end;
  mx := case typ when 1 then 2 when 2 then 1 when 3 then 8 when 4 then 8 when 6 then 1 when 7 then 2 else 1 end;
  for d in 1..nd loop
    for s in 1..mx loop
      nr := r + dr[d] * s; nc := c + dc[d] * s;
      exit when nr < 0 or nr > 8 or nc < 0 or nc > 8;
      ti := nr * 9 + nc + 1;
      exit when ti = any(forb);                     -- không vào, không đi xuyên Đường Cấm
      q := cells[ti];
      if q = 0 then to_idx := ti; is_cap := false; return next; continue; end if;
      if q / 10 <> o and public.cf_can_capture(cells, p, ti) then to_idx := ti; is_cap := true; return next; end if;
      exit;
    end loop;
  end loop;
end $$;

create or replace function public.cf_piece_json(code smallint, pid text, idx integer) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', pid, 'type', public.cf_tchar(code % 10), 'owner', 'P' || (code / 10),
                            'row', (idx - 1) / 9, 'col', (idx - 1) % 9)
$$;

-- Áp nước đi lên BẢN SAO; trả bàn mới + danh sách quân bị loại (kèm Thuật còn lại nếu một Thuật bị bắt).
create or replace function public.cf_apply(cells smallint[], ids text[], f integer, t integer, swap boolean,
                                           out ncells smallint[], out nids text[], out captured jsonb)
language plpgsql immutable as $$
declare tc integer; i integer; tmp smallint; tmpi text;
begin
  ncells := cells; nids := ids; captured := '[]'::jsonb;
  if swap then
    tmp := ncells[f]; ncells[f] := ncells[t]; ncells[t] := tmp;
    tmpi := nids[f];  nids[f] := nids[t];   nids[t] := tmpi;
    return;
  end if;
  tc := ncells[t];
  if tc <> 0 then
    captured := captured || jsonb_build_array(public.cf_piece_json(ncells[t], nids[t], t));
    ncells[t] := 0; nids[t] := null;
    if tc % 10 = 8 then                               -- một Thuật bị bắt => Thuật còn lại bị loại
      for i in 1..81 loop
        if ncells[i] = (tc / 10) * 10 + 8 then
          captured := captured || jsonb_build_array(public.cf_piece_json(ncells[i], nids[i], i));
          ncells[i] := 0; nids[i] := null; exit;
        end if;
      end loop;
    end if;
  end if;
  ncells[t] := ncells[f]; nids[t] := nids[f]; ncells[f] := 0; nids[f] := null;
end $$;

create or replace function public.cf_in_check(cells smallint[], o integer) returns boolean
language plpgsql immutable as $$
declare k integer := (public.cf_find(cells, o, 2))[1]; i integer;
begin
  if k is null then return false; end if;
  for i in 1..81 loop
    if cells[i] <> 0 and cells[i] / 10 = 3 - o then
      if exists (select 1 from public.cf_moves(cells, i) mv where mv.is_cap and mv.to_idx = k) then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- Vua đổi chỗ Thuật (f = ô Vua, t = ô Thuật). Điều kiện đúng như KingSpellSwap.actions trong JS.
create or replace function public.cf_swap_ok(cells smallint[], ids text[], o integer, f integer, t integer) returns boolean
language plpgsql immutable as $$
declare kr integer := (f - 1) / 9; r record;
begin
  if f is null or t is null or cells[f] <> o * 10 + 2 or cells[t] <> o * 10 + 8 then return false; end if;
  if not ((o = 1 and kr <= 3) or (o = 2 and kr >= 5)) then return false; end if;      -- Vua phải đứng trong lãnh thổ mình (A1)
  if f = any(public.cf_forbidden(cells, o)) then return false; end if;                 -- ô của Vua không nằm trong Đường Cấm địch
  select * into r from public.cf_apply(cells, ids, f, t, true);
  return not public.cf_in_check(r.ncells, o);
end $$;

-- Nước đi thường: trả 'move' | 'capture' | null (không hợp lệ hoặc để Vua bị chiếu).
create or replace function public.cf_move_legal(cells smallint[], ids text[], o integer, f integer, t integer) returns text
language plpgsql immutable as $$
declare mv record; r record;
begin
  if f is null or t is null or cells[f] = 0 or cells[f] / 10 <> o then return null; end if;
  for mv in select * from public.cf_moves(cells, f) loop
    if mv.to_idx = t then
      select * into r from public.cf_apply(cells, ids, f, t, false);
      if public.cf_in_check(r.ncells, o) then return null; end if;
      return case when mv.is_cap then 'capture' else 'move' end;
    end if;
  end loop;
  return null;
end $$;

create or replace function public.cf_has_legal(cells smallint[], ids text[], o integer) returns boolean
language plpgsql immutable as $$
declare i integer; mv record; r record; ts integer; k integer := (public.cf_find(cells, o, 2))[1];
begin
  for i in 1..81 loop
    if cells[i] <> 0 and cells[i] / 10 = o then
      for mv in select * from public.cf_moves(cells, i) loop
        select * into r from public.cf_apply(cells, ids, i, mv.to_idx, false);
        if not public.cf_in_check(r.ncells, o) then return true; end if;
      end loop;
    end if;
  end loop;
  if k is not null then
    foreach ts in array public.cf_find(cells, o, 8) loop
      if public.cf_swap_ok(cells, ids, o, k, ts) then return true; end if;
    end loop;
  end if;
  return false;
end $$;

-- Chỉ dùng cho cf_selftest: đếm toàn bộ nước hợp lệ.
create or replace function public.cf_legal_count(cells smallint[], ids text[], o integer) returns integer
language plpgsql immutable as $$
declare i integer; mv record; r record; ts integer; n integer := 0; k integer := (public.cf_find(cells, o, 2))[1];
begin
  for i in 1..81 loop
    if cells[i] <> 0 and cells[i] / 10 = o then
      for mv in select * from public.cf_moves(cells, i) loop
        select * into r from public.cf_apply(cells, ids, i, mv.to_idx, false);
        if not public.cf_in_check(r.ncells, o) then n := n + 1; end if;
      end loop;
    end if;
  end loop;
  if k is not null then
    foreach ts in array public.cf_find(cells, o, 8) loop
      if public.cf_swap_ok(cells, ids, o, k, ts) then n := n + 1; end if;
    end loop;
  end if;
  return n;
end $$;

create or replace function public.cf_initial_board(out cells smallint[], out ids text[])
language plpgsql immutable as $$
declare back text[] := array['T','S','M','C','V','C','N','G','T']; o integer; rb integer; rf integer; c integer; t integer; idx integer; cnt integer[];
begin
  cells := array_fill(0::smallint, array[81]); ids := array_fill(null::text, array[81]);
  foreach o in array array[1,2] loop
    rb := case o when 1 then 0 else 8 end; rf := case o when 1 then 1 else 7 end;
    cnt := array_fill(0, array[9]);
    for c in 0..8 loop
      t := public.cf_tcode(back[c + 1]); cnt[t] := cnt[t] + 1; idx := rb * 9 + c + 1;
      cells[idx] := (o * 10 + t)::smallint; ids[idx] := 'P' || o || '-' || back[c + 1] || cnt[t];
    end loop;
    for c in 0..8 loop
      cnt[1] := cnt[1] + 1; idx := rf * 9 + c + 1;
      cells[idx] := (o * 10 + 1)::smallint; ids[idx] := 'P' || o || '-L' || cnt[1];
    end loop;
  end loop;
end $$;

create or replace function public.cf_snapshot(cells smallint[], ids text[], turn integer, move_number integer, winner integer, reason text)
returns jsonb language plpgsql immutable as $$
declare i integer; b jsonb := '[]'::jsonb;
begin
  for i in 1..81 loop
    if cells[i] <> 0 then b := b || jsonb_build_array(public.cf_piece_json(cells[i], ids[i], i)); end if;
  end loop;
  return jsonb_build_object('version', 1, 'rules', 'crownfall-beta-5.1', 'turn', 'P' || turn, 'move_number', move_number,
    'winner', case when winner is null then null else 'P' || winner end, 'win_reason', reason, 'board', b);
end $$;

create or replace function public.cf_unpack(snap jsonb, out cells smallint[], out ids text[])
language plpgsql immutable as $$
declare p jsonb; idx integer;
begin
  cells := array_fill(0::smallint, array[81]); ids := array_fill(null::text, array[81]);
  for p in select * from jsonb_array_elements(snap -> 'board') loop
    idx := (p ->> 'row')::integer * 9 + (p ->> 'col')::integer + 1;
    cells[idx] := (substr(p ->> 'owner', 2)::integer * 10 + public.cf_tcode(p ->> 'type'))::smallint;
    ids[idx] := p ->> 'id';
  end loop;
end $$;

-- =====================================================================
-- 8. HÀM NỘI BỘ (cf_*, không cấp cho client)
-- =====================================================================
create or replace function public.cf_uid() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_u text := public.cf_uid(); v_st text;
begin
  if v_u is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select status into v_st from public.profiles where user_id = v_u;
  if v_st is null then raise exception 'profile_missing'; end if;
  if v_st <> 'active' then raise exception 'account_suspended'; end if;
  return v_u;
end $$;

create or replace function public.cf_profile_json(p_uid text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('user_id', user_id, 'username', username, 'display_name', display_name, 'avatar_url', avatar_url)
  from public.profiles where user_id = p_uid
$$;

create or replace function public.cf_gen_code() returns text
language plpgsql volatile as $$
declare v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_hex text := replace(gen_random_uuid()::text, '-', ''); v_out text := ''; i integer;
begin
  for i in 0..6 loop
    v_out := v_out || substr(v_alpha, (get_byte(decode(substr(v_hex, i * 2 + 1, 2), 'hex'), 0) % 32) + 1, 1);
  end loop;
  return v_out;
end $$;

-- Kết thúc trận đúng MỘT lần (bất kỳ lời gọi thứ hai nào là no-op). Giải phóng "trận đang chơi" của hai người.
create or replace function public.cf_finish_match(p_match uuid, p_winner_side text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m public.matches; v_wid text; v_win integer;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found or v_m.status <> 'active' then return; end if;
  v_wid := case p_winner_side when 'red' then v_m.red_id when 'blue' then v_m.blue_id else null end;
  v_win := case p_winner_side when 'red' then 2 when 'blue' then 1 else null end;
  update public.matches set
    status = 'finished', winner_side = p_winner_side, winner_id = v_wid, end_reason = p_reason, result_reason = p_reason,
    ended_at = now(), draw_offer_by = null, rev = rev + 1,
    state = case when state is null then null else state || jsonb_build_object(
      'winner', case when v_win is null then null else 'P' || v_win end, 'win_reason', p_reason) end
  where id = p_match;
  delete from public.match_players_active where match_id = p_match;
  insert into public.match_events (match_id, event_type, payload)
  values (p_match, 'match_finished', jsonb_build_object('reason', p_reason, 'winner_side', p_winner_side));
  update public.rooms set rev = rev + 1 where id = v_m.room_id;
  -- Phase 4: cập nhật HELO đúng một lần, cùng transaction. Lỗi HELO KHÔNG được làm kẹt trận: ghi sự kiện rating_failed,
  -- rating_processed_at vẫn NULL => RPC update_ratings / finalize_match có thể thử lại (idempotent).
  if v_m.ranked then
    begin
      perform public.cf_apply_rating(p_match);
    exception when others then
      insert into public.match_events (match_id, event_type, payload)
      values (p_match, 'rating_failed', jsonb_build_object('error', left(sqlerrm, 200)));
    end;
  end if;
end $$;

-- Hết giờ (kiểm tra bằng đồng hồ DATABASE). Gọi được bởi mọi hàm chạm tới trận.
create or replace function public.cf_expire_due(p_match uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_m public.matches;
begin
  perform 1 from public.matches where id = p_match and status = 'active' and turn_deadline_at < now();
  if not found then return false; end if;
  select * into v_m from public.matches where id = p_match for update;
  if v_m.status = 'active' and v_m.turn_deadline_at < now() then
    perform public.cf_finish_match(p_match, case v_m.turn_side when 'red' then 'blue' else 'red' end, 'timeout');
    return true;
  end if;
  return false;
end $$;

create or replace function public.cf_expire_user_matches(p_uid text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in select match_id from public.match_players_active where user_id = p_uid loop
    perform public.cf_expire_due(v_id);
  end loop;
end $$;

create or replace function public.cf_match_role(p_match uuid, p_uid text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_m public.matches;
begin
  select * into v_m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if p_uid = v_m.red_id then return 'red'; end if;
  if p_uid = v_m.blue_id then return 'blue'; end if;
  if exists (select 1 from public.room_members rm join public.rooms r on r.id = rm.room_id
             where rm.room_id = v_m.room_id and rm.user_id = p_uid and rm.left_at is null
               and rm.side = 'spectator' and r.status <> 'closed') then return 'spectator'; end if;
  if exists (select 1 from public.user_roles ur join public.profiles pr on pr.user_id = ur.user_id
             where ur.user_id = p_uid and ur.role in ('admin','boss') and pr.status = 'active') then return 'spectator'; end if;   -- Phase 4: Admin/Boss theo dõi trận (chỉ đọc)
  raise exception 'not_allowed';
end $$;

-- Heartbeat hiện diện trong trận (tối đa 1 ghi / 3 giây / người). Không đổi rev.
create or replace function public.cf_touch_seen(p_match uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_role = 'red' then
    update public.matches set red_seen_at = now() where id = p_match and (red_seen_at is null or red_seen_at < now() - interval '3 seconds');
  elsif p_role = 'blue' then
    update public.matches set blue_seen_at = now() where id = p_match and (blue_seen_at is null or blue_seen_at < now() - interval '3 seconds');
  end if;
end $$;

-- JSON trạng thái trận đầy đủ cho client (nguồn sự thật). moves = các nước có move_number > p_since.
create or replace function public.cf_match_state(p_match uuid, p_uid text, p_since integer default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m public.matches; v_role text; v_mv jsonb; v_rm public.match_rematches; v_since integer := greatest(coalesce(p_since, 0), 0); v_code text;
begin
  v_role := public.cf_match_role(p_match, p_uid);
  perform public.cf_touch_seen(p_match, v_role);
  select * into v_m from public.matches where id = p_match;
  select * into v_rm from public.match_rematches where match_id = p_match;
  select coalesce(jsonb_agg(jsonb_build_object(
      'move_number', x.move_number, 'side', case when x.player_id = v_m.red_id then 'red' else 'blue' end,
      'piece_id', x.piece_id, 'piece_type', x.piece_type, 'from_row', x.from_row, 'from_col', x.from_col,
      'to_row', x.to_row, 'to_col', x.to_col, 'captured_piece', x.captured_piece, 'action_type', x.action_type,
      'created_at', x.created_at) order by x.move_number), '[]'::jsonb)
    into v_mv from public.match_moves x where x.match_id = p_match and x.move_number > v_since;
  if v_role <> 'spectator' then select code into v_code from public.rooms where id = v_m.room_id; end if;
  return jsonb_build_object(
    'rev', v_m.rev, 'server_time', now(), 'moves_since', v_since, 'you', v_role,
    'red_online',  coalesce(v_m.red_seen_at  > now() - interval '10 seconds', false),
    'blue_online', coalesce(v_m.blue_seen_at > now() - interval '10 seconds', false),
    'match', jsonb_build_object(
      'id', v_m.id, 'room_id', v_m.room_id, 'room_code', v_code, 'mode', v_m.mode, 'ranked', v_m.ranked, 'status', v_m.status,
      'turn_side', v_m.turn_side, 'version', v_m.version, 'turn_started_at', v_m.turn_started_at,
      'turn_deadline_at', v_m.turn_deadline_at, 'turn_duration_seconds', v_m.turn_duration_seconds,
      'winner_side', v_m.winner_side, 'winner_id', v_m.winner_id, 'end_reason', v_m.end_reason, 'in_check', v_m.in_check,
      'draw_offer_by', case when v_m.draw_offer_by = v_m.red_id then 'red' when v_m.draw_offer_by = v_m.blue_id then 'blue' else null end,
      'started_at', v_m.started_at, 'ended_at', v_m.ended_at, 'previous_match_id', v_m.previous_match_id,
      'red', public.cf_profile_json(v_m.red_id), 'blue', public.cf_profile_json(v_m.blue_id)),
    'rematch', jsonb_build_object('red', v_rm.red_vote, 'blue', v_rm.blue_vote, 'new_match_id', v_rm.new_match_id),
    'rating', public.cf_rating_json(p_match),
    'state', v_m.state, 'moves', v_mv);
end $$;

-- Tạo trận (đã bắt đầu). Ràng buộc "một người một trận" do PK match_players_active bảo đảm.
create or replace function public.cf_new_match(p_room uuid, p_red text, p_blue text, p_mode text, p_ranked boolean,
                                               p_turn integer, p_prev uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_b record; v_snap jsonb; v_id uuid;
begin
  select * into v_b from public.cf_initial_board();
  v_snap := public.cf_snapshot(v_b.cells, v_b.ids, 2, 0, null, null);        -- P2 (Đỏ) đi trước
  insert into public.matches (room_id, red_id, blue_id, status, mode, ranked, version, turn_side, turn_started_at,
      turn_deadline_at, turn_duration_seconds, state, started_at, previous_match_id, red_seen_at, blue_seen_at)
  values (p_room, p_red, p_blue, 'active', p_mode, p_ranked, 0, 'red', now(), now() + p_turn * interval '1 second', p_turn,
      v_snap, now(), p_prev, now(), now())
  returning id into v_id;
  begin
    insert into public.match_players_active (user_id, match_id) values (p_red, v_id), (p_blue, v_id);
  exception when unique_violation then raise exception 'already_in_match';
  end;
  insert into public.match_snapshots (match_id, ply, state) values (v_id, 0, v_snap);
  insert into public.match_events (match_id, event_type, payload)
  values (v_id, 'match_started', jsonb_build_object('mode', p_mode, 'ranked', p_ranked, 'turn_seconds', p_turn));
  update public.rooms set status = 'playing', rev = rev + 1 where id = p_room;
  update public.game_invites set status = 'cancelled' where room_id = p_room and status = 'pending';
  return v_id;
end $$;

-- ---------- 8.1 Nước đi ----------
-- Chuỗi kiểm tra: xác thực → thành viên → trận đang chơi → hết giờ (DB) → đúng lượt → phiên bản → luật → ghi → kết thúc.
-- Khóa dòng matches (FOR UPDATE) => hai client gửi đồng thời được tuần tự hóa. p_client_move_id => idempotent.
create or replace function public.submit_move(
  p_match uuid, p_expected_version integer, p_client_move_id uuid,
  p_from_row integer, p_from_col integer, p_to_row integer, p_to_col integer, p_action text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid text := public.cf_uid(); v_m public.matches; v_side text; v_mover integer; v_next integer;
  v_b record; v_r record; v_f integer; v_t integer; v_act text; v_pc smallint; v_pid text;
  v_win integer; v_reason text; v_chk boolean := false; v_snap jsonb; v_ply integer; v_cap jsonb;
begin
  if p_match is null or p_client_move_id is null or p_expected_version is null
     or p_from_row is null or p_from_col is null or p_to_row is null or p_to_col is null
     or p_from_row not between 0 and 8 or p_from_col not between 0 and 8 or p_to_row not between 0 and 8 or p_to_col not between 0 and 8
     or (p_action is not null and p_action not in ('move','capture','swap')) then
    raise exception 'invalid_input';
  end if;
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid = v_m.red_id then v_side := 'red'; elsif v_uid = v_m.blue_id then v_side := 'blue';
  else raise exception 'not_a_player'; end if;                                  -- khán giả/người ngoài không đi được

  if exists (select 1 from public.match_moves where match_id = p_match and client_move_id = p_client_move_id) then
    return public.cf_match_state(p_match, v_uid, p_expected_version) || jsonb_build_object('duplicate', true);
  end if;
  if v_m.status <> 'active' then raise exception 'match_finished'; end if;
  if v_m.turn_deadline_at < now() then                                          -- hết giờ: server quyết định, không nhận nước đi
    perform public.cf_finish_match(p_match, case v_m.turn_side when 'red' then 'blue' else 'red' end, 'timeout');
    return public.cf_match_state(p_match, v_uid, p_expected_version) || jsonb_build_object('rejected', 'timeout');
  end if;
  if v_m.turn_side <> v_side then raise exception 'not_your_turn'; end if;
  if v_m.version <> p_expected_version then raise exception 'version_conflict'; end if;

  select * into v_b from public.cf_unpack(v_m.state);
  v_mover := case v_side when 'red' then 2 else 1 end; v_next := 3 - v_mover;
  v_f := p_from_row * 9 + p_from_col + 1; v_t := p_to_row * 9 + p_to_col + 1;
  if coalesce(p_action, 'move') = 'swap' then
    if not public.cf_swap_ok(v_b.cells, v_b.ids, v_mover, v_f, v_t) then raise exception 'illegal_move'; end if;
    v_act := 'swap';
  else
    v_act := public.cf_move_legal(v_b.cells, v_b.ids, v_mover, v_f, v_t);
    if v_act is null or (p_action is not null and p_action <> v_act) then raise exception 'illegal_move'; end if;
  end if;

  v_pc := v_b.cells[v_f]; v_pid := v_b.ids[v_f];
  select * into v_r from public.cf_apply(v_b.cells, v_b.ids, v_f, v_t, v_act = 'swap');
  v_cap := v_r.captured; v_ply := v_m.version + 1;

  if (public.cf_find(v_r.ncells, v_next, 2))[1] is null then
    v_win := v_mover; v_reason := 'king_captured';
  else
    v_chk := public.cf_in_check(v_r.ncells, v_next);
    if not public.cf_has_legal(v_r.ncells, v_r.nids, v_next) then v_win := v_mover; v_reason := 'no_legal_moves'; end if;
  end if;
  v_snap := public.cf_snapshot(v_r.ncells, v_r.nids, v_next, v_ply, v_win, v_reason);

  insert into public.match_moves (match_id, ply, move_number, player_id, piece, piece_id, piece_type, from_sq, to_sq,
      from_row, from_col, to_row, to_col, captured_piece, action_type, state_snapshot, client_move_id)
  values (p_match, v_ply, v_ply, v_uid, public.cf_tchar(v_pc % 10), v_pid, public.cf_tchar(v_pc % 10),
      (p_from_row + 1) || ',' || (p_from_col + 1), (p_to_row + 1) || ',' || (p_to_col + 1),
      p_from_row, p_from_col, p_to_row, p_to_col,
      case when jsonb_array_length(v_cap) = 0 then null else (v_cap -> 0) || jsonb_build_object('chain', v_cap - 0) end,
      v_act, v_snap, p_client_move_id);
  insert into public.match_snapshots (match_id, ply, state) values (p_match, v_ply, v_snap) on conflict do nothing;

  if v_m.draw_offer_by is not null and v_m.draw_offer_by <> v_uid then          -- đề nghị hòa hết hiệu lực khi đối phương đi
    insert into public.match_events (match_id, event_type, actor_id, payload)
    values (p_match, 'draw_expired', v_m.draw_offer_by, jsonb_build_object('ply', v_ply));
  end if;
  update public.matches set
    state = v_snap, version = v_ply, turn_side = case v_side when 'red' then 'blue' else 'red' end,
    turn_started_at = now(), turn_deadline_at = now() + turn_duration_seconds * interval '1 second',
    in_check = v_chk, rev = rev + 1,
    draw_offer_by = case when draw_offer_by is not null and draw_offer_by <> v_uid then null else draw_offer_by end
  where id = p_match;
  if v_win is not null then perform public.cf_finish_match(p_match, v_side, v_reason); end if;
  return public.cf_match_state(p_match, v_uid, p_expected_version);
end $$;

-- ---------- 8.2 Đọc trạng thái (polling) ----------
create or replace function public.get_match_state(p_match uuid, p_known_rev integer default null, p_since_ply integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_role text; v_m public.matches;
begin
  v_role := public.cf_match_role(p_match, v_uid);                              -- chỉ người trong trận / khán giả mới được hỏi
  perform public.cf_expire_due(p_match);                                       -- hết giờ được xác nhận ở DB
  perform public.cf_touch_seen(p_match, v_role);
  select * into v_m from public.matches where id = p_match;
  if p_known_rev is not null and p_known_rev = v_m.rev then                    -- không đổi: trả bản nhẹ
    return jsonb_build_object('unchanged', true, 'rev', v_m.rev, 'server_time', now(), 'you', v_role, 'status', v_m.status,
      'red_online',  coalesce(v_m.red_seen_at  > now() - interval '10 seconds', false),
      'blue_online', coalesce(v_m.blue_seen_at > now() - interval '10 seconds', false));
  end if;
  return public.cf_match_state(p_match, v_uid, p_since_ply);
end $$;

-- Vào/khôi phục trận (người chơi hoặc khán giả đã tham gia phòng): tải toàn bộ trạng thái chính thức.
create or replace function public.join_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid();
begin
  perform public.cf_match_role(p_match, v_uid);
  perform public.cf_expire_due(p_match);
  return public.cf_match_state(p_match, v_uid, 0);
end $$;

create or replace function public.expire_turn(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid();
begin
  perform public.cf_match_role(p_match, v_uid);                                 -- phải là người trong trận / khán giả
  perform public.cf_expire_due(p_match);                                        -- chỉ kết thúc nếu DB thấy đã quá hạn
  return public.cf_match_state(p_match, v_uid, 0);
end $$;

-- ---------- 8.3 Đầu hàng / hòa ----------
create or replace function public.resign_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches; v_side text;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid = v_m.red_id then v_side := 'red'; elsif v_uid = v_m.blue_id then v_side := 'blue'; else raise exception 'not_a_player'; end if;
  if v_m.status <> 'active' then
    if v_m.end_reason = 'resignation' and v_m.winner_id is distinct from v_uid then   -- bấm lặp: trả kết quả cũ
      return public.cf_match_state(p_match, v_uid, v_m.version);
    end if;
    raise exception 'match_finished';
  end if;
  if v_m.turn_deadline_at < now() then
    perform public.cf_finish_match(p_match, case v_m.turn_side when 'red' then 'blue' else 'red' end, 'timeout');
  else
    perform public.cf_finish_match(p_match, case v_side when 'red' then 'blue' else 'red' end, 'resignation');
    insert into public.match_events (match_id, event_type, actor_id) values (p_match, 'resigned', v_uid);
  end if;
  return public.cf_match_state(p_match, v_uid, v_m.version);
end $$;

create or replace function public.offer_draw(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid <> v_m.red_id and v_uid <> v_m.blue_id then raise exception 'not_a_player'; end if;   -- khán giả không xin hòa
  if v_m.status <> 'active' then raise exception 'match_finished'; end if;
  if v_m.turn_deadline_at < now() then
    perform public.cf_finish_match(p_match, case v_m.turn_side when 'red' then 'blue' else 'red' end, 'timeout');
    return public.cf_match_state(p_match, v_uid, v_m.version) || jsonb_build_object('rejected', 'timeout');
  end if;
  if v_m.draw_offer_by = v_uid then return public.cf_match_state(p_match, v_uid, v_m.version); end if;   -- idempotent
  if v_m.draw_offer_by is not null then raise exception 'draw_offer_pending'; end if;
  if v_m.draw_declined_at_ply is not null and v_m.version < v_m.draw_declined_at_ply + 2 then raise exception 'draw_cooldown'; end if;
  update public.matches set draw_offer_by = v_uid, rev = rev + 1 where id = p_match;
  insert into public.match_events (match_id, event_type, actor_id, payload)
  values (p_match, 'draw_offered', v_uid, jsonb_build_object('ply', v_m.version));
  return public.cf_match_state(p_match, v_uid, v_m.version);
end $$;

create or replace function public.respond_draw(p_match uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches;
begin
  if p_accept is null then raise exception 'invalid_input'; end if;
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid <> v_m.red_id and v_uid <> v_m.blue_id then raise exception 'not_a_player'; end if;
  if v_m.status <> 'active' then
    if p_accept and v_m.end_reason = 'draw_agreement' then return public.cf_match_state(p_match, v_uid, v_m.version); end if;
    raise exception 'match_finished';
  end if;
  if v_m.turn_deadline_at < now() then
    perform public.cf_finish_match(p_match, case v_m.turn_side when 'red' then 'blue' else 'red' end, 'timeout');
    return public.cf_match_state(p_match, v_uid, v_m.version) || jsonb_build_object('rejected', 'timeout');
  end if;
  if v_m.draw_offer_by is null then raise exception 'no_draw_offer'; end if;
  if v_m.draw_offer_by = v_uid then raise exception 'own_draw_offer'; end if;
  if p_accept then
    perform public.cf_finish_match(p_match, 'draw', 'draw_agreement');
    insert into public.match_events (match_id, event_type, actor_id) values (p_match, 'draw_accepted', v_uid);
  else
    update public.matches set draw_offer_by = null, draw_declined_at_ply = version, rev = rev + 1 where id = p_match;
    insert into public.match_events (match_id, event_type, actor_id) values (p_match, 'draw_declined', v_uid);
  end if;
  return public.cf_match_state(p_match, v_uid, v_m.version);
end $$;

-- ---------- 8.4 Rematch ----------
-- Chỉ tạo trận mới khi CẢ HAI cùng đồng ý. Trận cũ không bị sửa (phiếu nằm ở match_rematches; matches.rev chỉ là bộ đếm đồng bộ).
-- Trận mới: bàn cờ mới, đổi phe để công bằng, LUÔN unranked.
create or replace function public.cf_rematch_vote(p_match uuid, p_uid text, p_vote text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m public.matches; v_r public.rooms; v_rm public.match_rematches; v_latest uuid; v_new uuid; v_mine text; v_theirs text;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if p_uid <> v_m.red_id and p_uid <> v_m.blue_id then raise exception 'not_a_player'; end if;
  if v_m.status <> 'finished' then raise exception 'match_not_finished'; end if;
  select id into v_latest from public.matches where room_id = v_m.room_id order by created_at desc, id desc limit 1;
  select * into v_r from public.rooms where id = v_m.room_id for update;
  if v_latest <> v_m.id or v_r.status = 'closed'
     or (select count(*) from public.room_members where room_id = v_m.room_id and left_at is null and user_id in (v_m.red_id, v_m.blue_id)) <> 2 then
    raise exception 'rematch_unavailable';
  end if;
  insert into public.match_rematches (match_id) values (p_match) on conflict do nothing;
  select * into v_rm from public.match_rematches where match_id = p_match for update;
  if v_rm.new_match_id is not null then return public.cf_match_state(p_match, p_uid, v_m.version); end if;
  if p_uid = v_m.red_id then
    v_theirs := v_rm.blue_vote; update public.match_rematches set red_vote = p_vote, updated_at = now() where match_id = p_match;
  else
    v_theirs := v_rm.red_vote;  update public.match_rematches set blue_vote = p_vote, updated_at = now() where match_id = p_match;
  end if;
  if p_vote = 'yes' and v_theirs = 'no' then raise exception 'rematch_declined'; end if;
  insert into public.match_events (match_id, event_type, actor_id, payload)
  values (p_match, 'rematch_vote', p_uid, jsonb_build_object('vote', p_vote));
  if p_vote = 'yes' and v_theirs = 'yes' then
    v_new := public.cf_new_match(v_m.room_id, v_m.blue_id, v_m.red_id, v_m.mode, false, v_m.turn_duration_seconds, v_m.id);
    update public.room_members set side = 'spectator' where room_id = v_m.room_id and user_id in (v_m.red_id, v_m.blue_id);
    update public.room_members set side = 'red'  where room_id = v_m.room_id and user_id = v_m.blue_id;
    update public.room_members set side = 'blue' where room_id = v_m.room_id and user_id = v_m.red_id;
    update public.match_rematches set new_match_id = v_new where match_id = p_match;
    insert into public.match_events (match_id, event_type, actor_id, payload)
    values (p_match, 'rematch_created', p_uid, jsonb_build_object('new_match_id', v_new));
  end if;
  update public.matches set rev = rev + 1 where id = p_match;
  return public.cf_match_state(p_match, p_uid, v_m.version);
end $$;

create or replace function public.request_rematch(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin return public.cf_rematch_vote(p_match, public.cf_uid(), 'yes'); end $$;

create or replace function public.respond_rematch(p_match uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_accept is null then raise exception 'invalid_input'; end if;
  return public.cf_rematch_vote(p_match, public.cf_uid(), case when p_accept then 'yes' else 'no' end);
end $$;

-- =====================================================================
-- 9. PHÒNG, BẠN BÈ, LỜI MỜI, GHÉP NHANH, KHÁN GIẢ
-- =====================================================================
create or replace function public.cf_close_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.rooms set status = 'closed', closed_at = now(), rev = rev + 1 where id = p_room and status <> 'closed';
  update public.game_invites set status = 'cancelled' where room_id = p_room and status = 'pending';
end $$;

-- Người chơi rời phòng đã kết thúc trận (không còn trận đang chơi) => đóng phòng; coi như từ chối rematch.
create or replace function public.cf_leave_postgame_rooms(p_uid text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in
    select r.id from public.room_members rm join public.rooms r on r.id = rm.room_id
    where rm.user_id = p_uid and rm.left_at is null and rm.side in ('red','blue') and r.status = 'playing'
      and not exists (select 1 from public.matches m where m.room_id = r.id and m.status = 'active')
  loop
    update public.room_members set left_at = now() where room_id = v_id and user_id = p_uid;
    perform public.cf_close_room(v_id);
  end loop;
end $$;

-- Một người không thể vừa ở trong trận / hàng đợi / phòng chờ khác.
create or replace function public.cf_assert_free(p_uid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.cf_expire_user_matches(p_uid);
  if exists (select 1 from public.match_players_active where user_id = p_uid) then raise exception 'already_in_match'; end if;
  if exists (select 1 from public.quick_queue where user_id = p_uid and status = 'waiting') then raise exception 'in_queue'; end if;
  perform public.cf_leave_postgame_rooms(p_uid);
  if exists (select 1 from public.room_members rm join public.rooms r on r.id = rm.room_id
             where rm.user_id = p_uid and rm.left_at is null and rm.side in ('red','blue') and r.status = 'open') then
    raise exception 'already_in_room';
  end if;
end $$;

create or replace function public.cf_create_room(p_uid text, p_mode text, p_turn integer, p_spectators boolean, p_host_side text default 'red')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_try integer := 0;
begin
  loop
    v_code := public.cf_gen_code();
    begin
      insert into public.rooms (code, owner_id, mode) values (v_code, p_uid, p_mode) returning id into v_id;
      exit;
    exception when unique_violation then
      v_try := v_try + 1; if v_try > 8 then raise exception 'code_generation_failed'; end if;
    end;
  end loop;
  insert into public.room_settings (room_id, turn_seconds, allow_spectators, is_private) values (v_id, p_turn, p_spectators, true);
  insert into public.room_members (room_id, user_id, side) values (v_id, p_uid, p_host_side);
  return v_id;
end $$;

create or replace function public.cf_room_json(p_room uuid, p_uid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_r public.rooms; v_s public.room_settings; v_pl jsonb; v_sc integer; v_cur record;
begin
  select * into v_r from public.rooms where id = p_room;
  select * into v_s from public.room_settings where room_id = p_room;
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', rm.user_id, 'side', rm.side, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
      'online', case when coalesce(us.show_online_status, true) then p.last_seen_at > now() - interval '75 seconds' else null end)
      order by rm.joined_at), '[]'::jsonb)
    into v_pl
    from public.room_members rm join public.profiles p on p.user_id = rm.user_id
    left join public.user_settings us on us.user_id = rm.user_id
    where rm.room_id = p_room and rm.left_at is null and rm.side in ('red','blue');
  select count(*) into v_sc from public.room_members where room_id = p_room and left_at is null and side = 'spectator';
  select id, status into v_cur from public.matches where room_id = p_room order by created_at desc, id desc limit 1;
  return jsonb_build_object('id', v_r.id, 'code', v_r.code, 'mode', v_r.mode, 'status', v_r.status, 'owner_id', v_r.owner_id,
    'rev', v_r.rev, 'server_time', now(),
    'settings', jsonb_build_object('turn_seconds', v_s.turn_seconds, 'allow_spectators', v_s.allow_spectators, 'is_private', v_s.is_private),
    'players', v_pl, 'spectators', v_sc, 'match_id', v_cur.id, 'match_status', v_cur.status,
    'you', (select side from public.room_members where room_id = p_room and user_id = p_uid and left_at is null),
    'is_host', v_r.owner_id = p_uid);
end $$;

create or replace function public.create_room(p_turn_seconds integer default 60, p_allow_spectators boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_room uuid;
begin
  if p_turn_seconds is null or p_turn_seconds not in (30, 60, 90, 120) then raise exception 'invalid_input'; end if;
  perform public.cf_assert_free(v_uid);
  v_room := public.cf_create_room(v_uid, 'private', p_turn_seconds, coalesce(p_allow_spectators, true));
  return public.cf_room_json(v_room, v_uid);
end $$;

create or replace function public.join_room(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_code text := upper(btrim(coalesce(p_code, ''))); v_r public.rooms; v_n integer; v_side text;
begin
  if v_code !~ '^[A-Z0-9]{6,8}$' then raise exception 'invalid_code'; end if;
  select * into v_r from public.rooms where code = v_code for update;            -- khóa phòng: join đồng thời được tuần tự hóa
  if not found or v_r.status = 'closed' then raise exception 'room_not_found'; end if;
  if exists (select 1 from public.room_members where room_id = v_r.id and user_id = v_uid and left_at is null and side in ('red','blue')) then
    return public.cf_room_json(v_r.id, v_uid);                                    -- đã ở trong phòng: idempotent
  end if;
  if v_r.mode <> 'private' then raise exception 'invite_only'; end if;           -- phòng bạn bè / ghép nhanh không vào bằng mã
  if v_r.status <> 'open' then raise exception 'room_started'; end if;
  perform public.cf_assert_free(v_uid);
  select count(*) into v_n from public.room_members where room_id = v_r.id and left_at is null and side in ('red','blue');
  if v_n >= 2 then raise exception 'room_full'; end if;                           -- người thứ ba không vào được với tư cách người chơi
  v_side := case when exists (select 1 from public.room_members where room_id = v_r.id and left_at is null and side = 'red') then 'blue' else 'red' end;
  insert into public.room_members (room_id, user_id, side) values (v_r.id, v_uid, v_side)
  on conflict (room_id, user_id) do update set side = excluded.side, left_at = null, joined_at = now();
  update public.rooms set rev = rev + 1 where id = v_r.id;
  return public.cf_room_json(v_r.id, v_uid);
end $$;

create or replace function public.leave_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_r public.rooms; v_mem public.room_members; v_other text;
begin
  select * into v_r from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  select * into v_mem from public.room_members where room_id = p_room and user_id = v_uid and left_at is null;
  if not found then return jsonb_build_object('left', true); end if;              -- đã rời: idempotent
  if v_mem.side = 'spectator' then
    update public.room_members set left_at = now() where room_id = p_room and user_id = v_uid;
    return jsonb_build_object('left', true);
  end if;
  if exists (select 1 from public.matches where room_id = p_room and status = 'active') then raise exception 'match_in_progress'; end if;
  update public.room_members set left_at = now() where room_id = p_room and user_id = v_uid;
  if v_r.status = 'open' then
    select user_id into v_other from public.room_members where room_id = p_room and left_at is null and side in ('red','blue') limit 1;
    if v_other is null then perform public.cf_close_room(p_room);
    else
      if v_r.owner_id = v_uid then update public.rooms set owner_id = v_other where id = p_room; end if;   -- chuyển quyền chủ phòng
      update public.rooms set rev = rev + 1 where id = p_room;
      update public.game_invites set status = 'cancelled' where room_id = p_room and from_id = v_uid and status = 'pending';
    end if;
  else
    perform public.cf_close_room(p_room);                                         -- rời sau trận => đóng phòng (hết rematch)
  end if;
  return jsonb_build_object('left', true);
end $$;

create or replace function public.get_room_state(p_room uuid, p_known_rev integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_r public.rooms; v_mem public.room_members;
begin
  select * into v_r from public.rooms where id = p_room;
  select * into v_mem from public.room_members where room_id = p_room and user_id = v_uid;
  if v_r.id is null or v_mem.user_id is null then raise exception 'not_allowed'; end if;     -- người ngoài không đọc được phòng
  if v_r.status = 'closed' or v_mem.left_at is not null then return jsonb_build_object('closed', true, 'rev', v_r.rev); end if;
  if p_known_rev is not null and p_known_rev = v_r.rev then
    return jsonb_build_object('unchanged', true, 'rev', v_r.rev, 'server_time', now());
  end if;
  return public.cf_room_json(p_room, v_uid);
end $$;

create or replace function public.start_match(p_room uuid, p_host_side text default 'random') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_r public.rooms; v_s public.room_settings; v_ids text[]; v_other text;
        v_hs text; v_red text; v_blue text; v_match uuid;
begin
  if p_host_side is null or p_host_side not in ('random','red','blue') then raise exception 'invalid_input'; end if;
  select * into v_r from public.rooms where id = p_room for update;
  if not found then raise exception 'room_not_found'; end if;
  if v_r.owner_id <> v_uid then raise exception 'not_host'; end if;
  if v_r.status <> 'open' then raise exception 'room_started'; end if;
  select array_agg(user_id order by joined_at) into v_ids from public.room_members
    where room_id = p_room and left_at is null and side in ('red','blue');
  if coalesce(array_length(v_ids, 1), 0) <> 2 or not (v_uid = any(v_ids)) then raise exception 'need_two_players'; end if;
  select * into v_s from public.room_settings where room_id = p_room;
  v_other := case when v_ids[1] = v_uid then v_ids[2] else v_ids[1] end;
  v_hs := case p_host_side when 'random' then case when random() < 0.5 then 'red' else 'blue' end else p_host_side end;
  v_red := case v_hs when 'red' then v_uid else v_other end; v_blue := case v_hs when 'red' then v_other else v_uid end;
  update public.room_members set side = 'spectator' where room_id = p_room and user_id in (v_red, v_blue);   -- tránh đụng unique index khi đổi phe
  update public.room_members set side = 'red'  where room_id = p_room and user_id = v_red;
  update public.room_members set side = 'blue' where room_id = p_room and user_id = v_blue;
  v_match := public.cf_new_match(p_room, v_red, v_blue, v_r.mode, false, v_s.turn_seconds, null);     -- private/friend: unranked
  return jsonb_build_object('match_id', v_match);
end $$;


-- Chủ phòng chỉnh thiết lập khi phòng còn mở (thời gian lượt 30/60/90/120 giây, cho phép khán giả).
create or replace function public.update_room_settings(p_room uuid, p_turn_seconds integer, p_allow_spectators boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_r public.rooms;
begin
  if p_turn_seconds is null or p_turn_seconds not in (30, 60, 90, 120) or p_allow_spectators is null then raise exception 'invalid_input'; end if;
  select * into v_r from public.rooms where id = p_room for update;
  if not found or v_r.status <> 'open' then raise exception 'room_not_found'; end if;
  if v_r.owner_id <> v_uid then raise exception 'not_host'; end if;
  update public.room_settings set turn_seconds = p_turn_seconds, allow_spectators = p_allow_spectators, updated_at = now() where room_id = p_room;
  update public.rooms set rev = rev + 1 where id = p_room;
  return public.cf_room_json(p_room, v_uid);
end $$;

-- ---------- 9.1 Khán giả ----------
create or replace function public.join_spectator(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_code text := upper(btrim(coalesce(p_code, ''))); v_r public.rooms; v_s public.room_settings; v_cur record; v_n integer;
begin
  if v_code !~ '^[A-Z0-9]{6,8}$' then raise exception 'invalid_code'; end if;
  select * into v_r from public.rooms where code = v_code for update;
  if not found or v_r.status = 'closed' then raise exception 'room_not_found'; end if;
  select * into v_s from public.room_settings where room_id = v_r.id;
  if not v_s.allow_spectators then raise exception 'spectators_not_allowed'; end if;
  select id, status into v_cur from public.matches where room_id = v_r.id order by created_at desc, id desc limit 1;
  if v_cur.id is null or v_cur.status <> 'active' then raise exception 'no_active_match'; end if;
  if exists (select 1 from public.room_members where room_id = v_r.id and user_id = v_uid and left_at is null and side in ('red','blue')) then
    raise exception 'already_player';
  end if;
  select count(*) into v_n from public.room_members where room_id = v_r.id and left_at is null and side = 'spectator';
  if v_n >= 50 then raise exception 'spectators_full'; end if;
  insert into public.room_members (room_id, user_id, side) values (v_r.id, v_uid, 'spectator')
  on conflict (room_id, user_id) do update set side = 'spectator', left_at = null, joined_at = now();
  return jsonb_build_object('match_id', v_cur.id, 'room_id', v_r.id);
end $$;

create or replace function public.leave_spectator(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid();
begin
  update public.room_members set left_at = now() where room_id = p_room and user_id = v_uid and side = 'spectator' and left_at is null;
  return jsonb_build_object('left', true);
end $$;

-- ---------- 9.2 Bạn bè & lời mời ----------
create or replace function public.heartbeat() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid();
begin update public.profiles set last_seen_at = now() where user_id = v_uid; end $$;

create or replace function public.send_friend_request(p_username text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_to text; v_f public.friendships;
begin
  select user_id into v_to from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and status = 'active';
  if v_to is null then raise exception 'user_not_found'; end if;
  if v_to = v_uid then raise exception 'cannot_friend_self'; end if;
  select * into v_f from public.friendships
    where least(requester_id, addressee_id) = least(v_uid, v_to) and greatest(requester_id, addressee_id) = greatest(v_uid, v_to) for update;
  if found then
    if v_f.status = 'accepted' then raise exception 'already_friends'; end if;
    if v_f.status = 'blocked' then raise exception 'cannot_request'; end if;
    if v_f.status = 'pending' then
      if v_f.requester_id = v_uid then return jsonb_build_object('status', 'pending'); end if;
      update public.friendships set status = 'accepted' where id = v_f.id;               -- họ đã mời mình: tự chấp nhận
      return jsonb_build_object('status', 'accepted');
    end if;
    update public.friendships set requester_id = v_uid, addressee_id = v_to, status = 'pending', responded_at = null where id = v_f.id;   -- mời lại sau khi bị từ chối
    return jsonb_build_object('status', 'pending');
  end if;
  insert into public.friendships (requester_id, addressee_id) values (v_uid, v_to);
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.respond_friend_request(p_friendship uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_f public.friendships;
begin
  if p_accept is null then raise exception 'invalid_input'; end if;
  select * into v_f from public.friendships where id = p_friendship for update;
  if not found or v_f.addressee_id <> v_uid or v_f.status <> 'pending' then raise exception 'request_not_found'; end if;
  update public.friendships set status = case when p_accept then 'accepted' else 'declined' end where id = p_friendship;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end $$;

-- Online chỉ true/false khi người đó bật hiển thị và có heartbeat trong 75 giây; ngược lại null (không biết).
create or replace function public.get_social() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_fr jsonb; v_in jsonb; v_out jsonb; v_inv jsonb;
begin
  update public.game_invites set status = 'expired' where status = 'pending' and expires_at < now();
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', p.username, 'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'online', case when coalesce(us.show_online_status, true) then p.last_seen_at > now() - interval '75 seconds' else null end)
      order by p.username), '[]'::jsonb) into v_fr
    from public.friendships f
    join public.profiles p on p.user_id = case when f.requester_id = v_uid then f.addressee_id else f.requester_id end
    left join public.user_settings us on us.user_id = p.user_id
    where f.status = 'accepted' and v_uid in (f.requester_id, f.addressee_id);
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'from', public.cf_profile_json(f.requester_id), 'created_at', f.created_at)
      order by f.created_at), '[]'::jsonb) into v_in
    from public.friendships f where f.addressee_id = v_uid and f.status = 'pending';
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'to', public.cf_profile_json(f.addressee_id)) order by f.created_at), '[]'::jsonb) into v_out
    from public.friendships f where f.requester_id = v_uid and f.status = 'pending';
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'room_id', i.room_id, 'from', public.cf_profile_json(i.from_id),
      'turn_seconds', s.turn_seconds, 'expires_at', i.expires_at) order by i.created_at), '[]'::jsonb) into v_inv
    from public.game_invites i join public.room_settings s on s.room_id = i.room_id join public.rooms r on r.id = i.room_id
    where i.to_id = v_uid and i.status = 'pending' and r.status = 'open';
  return jsonb_build_object('friends', v_fr, 'requests_in', v_in, 'requests_out', v_out, 'invites_in', v_inv, 'server_time', now());
end $$;

-- Mời một người bạn (đã kết bạn) vào phòng. Không truyền phòng => tạo phòng bạn bè mới (chỉ người được mời mới vào được).
create or replace function public.invite_friend(p_username text, p_room uuid default null, p_turn_seconds integer default 60) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_to text; v_room uuid := p_room; v_r public.rooms; v_inv uuid;
begin
  select user_id into v_to from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and status = 'active';
  if v_to is null then raise exception 'user_not_found'; end if;
  if v_to = v_uid then raise exception 'cannot_friend_self'; end if;
  if not exists (select 1 from public.friendships where status = 'accepted'
                 and least(requester_id, addressee_id) = least(v_uid, v_to) and greatest(requester_id, addressee_id) = greatest(v_uid, v_to)) then
    raise exception 'not_friends';
  end if;
  if (select count(*) from public.game_invites where from_id = v_uid and status = 'pending' and expires_at > now()) >= 5 then
    raise exception 'too_many_invites';
  end if;
  if v_room is null then
    if p_turn_seconds is null or p_turn_seconds not in (30, 60, 90, 120) then raise exception 'invalid_input'; end if;
    perform public.cf_assert_free(v_uid);
    v_room := public.cf_create_room(v_uid, 'friend', p_turn_seconds, true);
  else
    select * into v_r from public.rooms where id = v_room for update;
    if not found or v_r.status <> 'open' then raise exception 'room_not_found'; end if;
    if v_r.owner_id <> v_uid then raise exception 'not_host'; end if;
  end if;
  insert into public.game_invites (room_id, from_id, to_id) values (v_room, v_uid, v_to)
  on conflict (room_id, to_id) where status = 'pending' do update set expires_at = now() + interval '5 minutes'
  returning id into v_inv;
  update public.rooms set rev = rev + 1 where id = v_room;
  return jsonb_build_object('invite_id', v_inv, 'room', public.cf_room_json(v_room, v_uid));
end $$;

create or replace function public.respond_friend_invite(p_invite uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_i public.game_invites; v_r public.rooms; v_n integer; v_side text;
begin
  if p_accept is null then raise exception 'invalid_input'; end if;
  select * into v_i from public.game_invites where id = p_invite for update;
  if not found or v_i.to_id <> v_uid or v_i.status <> 'pending' then raise exception 'invite_not_found'; end if;
  if not p_accept then
    update public.game_invites set status = 'declined', responded_at = now() where id = p_invite;
    return jsonb_build_object('declined', true);
  end if;
  if v_i.expires_at < now() then
    update public.game_invites set status = 'expired' where id = p_invite;
    raise exception 'invite_expired';
  end if;
  select * into v_r from public.rooms where id = v_i.room_id for update;
  if not found or v_r.status <> 'open' then
    update public.game_invites set status = 'cancelled' where id = p_invite;
    raise exception 'room_not_found';
  end if;
  perform public.cf_assert_free(v_uid);
  select count(*) into v_n from public.room_members where room_id = v_r.id and left_at is null and side in ('red','blue');
  if v_n >= 2 then raise exception 'room_full'; end if;
  v_side := case when exists (select 1 from public.room_members where room_id = v_r.id and left_at is null and side = 'red') then 'blue' else 'red' end;
  insert into public.room_members (room_id, user_id, side) values (v_r.id, v_uid, v_side)
  on conflict (room_id, user_id) do update set side = excluded.side, left_at = null, joined_at = now();
  update public.game_invites set status = 'accepted', responded_at = now() where id = p_invite;
  update public.rooms set rev = rev + 1 where id = v_r.id;
  return jsonb_build_object('room', public.cf_room_json(v_r.id, v_uid));
end $$;

-- ---------- 9.3 Ghép nhanh (Quick Match, ranked) ----------
-- Hàng đợi được xử lý trong một transaction có advisory lock => không ghép trùng. Mỗi lần client hỏi (matchmake_players)
-- vừa là heartbeat vừa là lượt ghép. Không có bot: không tìm được đối thủ thì chờ tới timeout 120 giây.
create or replace function public.cf_matchmake(p_uid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q public.quick_queue; v_o public.quick_queue; v_red text; v_blue text; v_room uuid; v_match uuid; v_waited integer;
begin
  perform pg_advisory_xact_lock(7305501);
  update public.quick_queue set last_seen_at = now() where user_id = p_uid and status = 'waiting';
  update public.quick_queue set status = 'expired'
    where status = 'waiting' and (last_seen_at < now() - interval '15 seconds' or joined_at < now() - interval '120 seconds');   -- offline / hết thời gian chờ
  select * into v_q from public.quick_queue where user_id = p_uid order by joined_at desc limit 1;
  if not found then return jsonb_build_object('status', 'idle'); end if;
  if v_q.status <> 'waiting' then return jsonb_build_object('status', v_q.status, 'match_id', v_q.match_id); end if;
  v_waited := extract(epoch from (now() - v_q.joined_at))::integer;
  -- khoảng rating nới dần theo thời gian chờ của người chờ lâu hơn: 100 + 20 điểm/giây, tối đa 1000
  select * into v_o from public.quick_queue qq
    where qq.status = 'waiting' and qq.user_id <> p_uid
      and not exists (select 1 from public.match_players_active a where a.user_id = qq.user_id)
      and abs(qq.rating - v_q.rating) <= least(1000, 100 + 20 * extract(epoch from (now() - least(v_q.joined_at, qq.joined_at)))::integer)
    order by abs(qq.rating - v_q.rating), qq.joined_at limit 1;
  if not found then
    return jsonb_build_object('status', 'waiting', 'waited', v_waited, 'rating', v_q.rating);
  end if;
  v_red := case when random() < 0.5 then v_q.user_id else v_o.user_id end;
  v_blue := case when v_red = v_q.user_id then v_o.user_id else v_q.user_id end;
  v_room := public.cf_create_room(v_red, 'quick', public.cf_cfg_int('ranked_turn_seconds', 60), false, 'red');   -- Ranked: thời gian lượt do Boss cấu hình (mặc định 60), không khán giả
  insert into public.room_members (room_id, user_id, side) values (v_room, v_blue, 'blue');
  v_match := public.cf_new_match(v_room, v_red, v_blue, 'quick', true, public.cf_cfg_int('ranked_turn_seconds', 60), null);
  update public.quick_queue set status = 'matched', match_id = v_match where id in (v_q.id, v_o.id);
  return jsonb_build_object('status', 'matched', 'match_id', v_match);
end $$;

create or replace function public.join_quick_queue() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid();
begin
  if not exists (select 1 from public.quick_queue where user_id = v_uid and status = 'waiting') then
    perform public.cf_assert_free(v_uid);
    insert into public.quick_queue (user_id, rating)
    values (v_uid, coalesce((select rating from public.rating_profiles where user_id = v_uid), 0))
    on conflict (user_id) where status = 'waiting' do nothing;
  end if;
  return public.cf_matchmake(v_uid);
end $$;

create or replace function public.cancel_quick_queue() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_q public.quick_queue;
begin
  perform pg_advisory_xact_lock(7305501);
  update public.quick_queue set status = 'cancelled' where user_id = v_uid and status = 'waiting';
  select * into v_q from public.quick_queue where user_id = v_uid order by joined_at desc limit 1;
  if not found then return jsonb_build_object('status', 'idle'); end if;
  return jsonb_build_object('status', v_q.status, 'match_id', v_q.match_id);        -- 'matched' nếu vừa được ghép trước khi hủy
end $$;

create or replace function public.matchmake_players() returns jsonb
language plpgsql security definer set search_path = public as $$
begin return public.cf_matchmake(public.cf_uid()); end $$;

-- Khôi phục sau reload / mất mạng: tài khoản này đang ở đâu?
create or replace function public.get_my_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_match uuid; v_room record; v_q text;
begin
  perform public.cf_expire_user_matches(v_uid);
  select match_id into v_match from public.match_players_active where user_id = v_uid;
  select r.id, r.code into v_room from public.room_members rm join public.rooms r on r.id = rm.room_id
    where rm.user_id = v_uid and rm.left_at is null and rm.side in ('red','blue') and r.status = 'open' limit 1;
  select status into v_q from public.quick_queue where user_id = v_uid and status = 'waiting';
  return jsonb_build_object('match_id', v_match, 'room_id', v_room.id, 'room_code', v_room.code, 'queue', v_q);
end $$;

-- =====================================================================
-- 10. QUYỀN THỰC THI: cf_* KHÔNG cấp cho client; chỉ RPC công khai dưới đây được cấp cho `authenticated`.
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'cf\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

revoke all on function public.create_room(integer, boolean) from public;
revoke all on function public.join_room(text) from public;
revoke all on function public.leave_room(uuid) from public;
revoke all on function public.get_room_state(uuid, integer) from public;
revoke all on function public.start_match(uuid, text) from public;
revoke all on function public.update_room_settings(uuid, integer, boolean) from public;
revoke all on function public.join_match(uuid) from public;
revoke all on function public.get_match_state(uuid, integer, integer) from public;
revoke all on function public.submit_move(uuid, integer, uuid, integer, integer, integer, integer, text) from public;
revoke all on function public.expire_turn(uuid) from public;
revoke all on function public.resign_match(uuid) from public;
revoke all on function public.offer_draw(uuid) from public;
revoke all on function public.respond_draw(uuid, boolean) from public;
revoke all on function public.request_rematch(uuid) from public;
revoke all on function public.respond_rematch(uuid, boolean) from public;
revoke all on function public.join_spectator(text) from public;
revoke all on function public.leave_spectator(uuid) from public;
revoke all on function public.heartbeat() from public;
revoke all on function public.send_friend_request(text) from public;
revoke all on function public.respond_friend_request(uuid, boolean) from public;
revoke all on function public.get_social() from public;
revoke all on function public.invite_friend(text, uuid, integer) from public;
revoke all on function public.respond_friend_invite(uuid, boolean) from public;
revoke all on function public.join_quick_queue() from public;
revoke all on function public.cancel_quick_queue() from public;
revoke all on function public.matchmake_players() from public;
revoke all on function public.get_my_status() from public;

grant execute on function public.create_room(integer, boolean) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.get_room_state(uuid, integer) to authenticated;
grant execute on function public.start_match(uuid, text) to authenticated;
grant execute on function public.update_room_settings(uuid, integer, boolean) to authenticated;
grant execute on function public.join_match(uuid) to authenticated;
grant execute on function public.get_match_state(uuid, integer, integer) to authenticated;
grant execute on function public.submit_move(uuid, integer, uuid, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.expire_turn(uuid) to authenticated;
grant execute on function public.resign_match(uuid) to authenticated;
grant execute on function public.offer_draw(uuid) to authenticated;
grant execute on function public.respond_draw(uuid, boolean) to authenticated;
grant execute on function public.request_rematch(uuid) to authenticated;
grant execute on function public.respond_rematch(uuid, boolean) to authenticated;
grant execute on function public.join_spectator(text) to authenticated;
grant execute on function public.leave_spectator(uuid) to authenticated;
grant execute on function public.heartbeat() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.get_social() to authenticated;
grant execute on function public.invite_friend(text, uuid, integer) to authenticated;
grant execute on function public.respond_friend_invite(uuid, boolean) to authenticated;
grant execute on function public.join_quick_queue() to authenticated;
grant execute on function public.cancel_quick_queue() to authenticated;
grant execute on function public.matchmake_players() to authenticated;
grant execute on function public.get_my_status() to authenticated;

-- =====================================================================
-- 11. TỰ KIỂM ĐỐI CHIẾU ENGINE (SQL ↔ JS). Chạy trong SQL Editor:  select public.cf_selftest();
--     Dữ liệu sinh từ engine JS (3 ván giả lập, 280 nước, có bắt quân / đổi Vua–Thuật / chiếu): mỗi bước kiểm
--     (a) số nước hợp lệ của bên đi, (b) nước đi được chấp nhận đúng loại, (c) cờ chiếu, rồi (d) bàn cờ cuối và số nước hợp lệ cuối.
--     Kết quả {"ok": true} nghĩa là port PL/pgSQL khớp engine JS trên các ca này. Không cấp hàm cho client.
-- =====================================================================
create or replace function public.cf_selftest() returns jsonb
language plpgsql set search_path = public as $$
declare
  v_b record; v_r record; g jsonb; stp text; p text[]; v_cells smallint[]; v_ids text[]; v_mover integer; v_act text; v_ok boolean;
  v_f integer; v_t integer; v_n integer; v_chk boolean; v_gi integer := 0; v_steps integer := 0; v_fails jsonb := '[]'::jsonb;
begin
  select * into v_b from public.cf_initial_board();
  if array_to_string(v_b.cells, ',') <> '18,15,13,14,12,14,17,16,18,11,11,11,11,11,11,11,11,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,21,21,21,21,21,21,21,21,21,28,25,23,24,22,24,27,26,28' then v_fails := v_fails || jsonb_build_array('initial_board'); end if;
  if public.cf_legal_count(v_b.cells, v_b.ids, 2) <> 54 then v_fails := v_fails || jsonb_build_array('initial_legal_count'); end if;
  for g in select * from jsonb_array_elements('[{"steps":"77,81,s,54,0;18,26,m,54,0;81,77,s,54,0;2,22,m,57,0;77,81,s,54,0;16,24,m,67,0;69,59,m,54,0;24,25,m,72,0;67,58,m,64,0;25,45,m,71,0;66,46,m,68,0;5,9,s,79,0;64,56,m,85,0;9,5,s,79,0;78,15,c,87,0;10,2,m,75,0;75,12,c,103,0;6,15,c,68,0;76,67,m,94,0;13,12,c,86,0;59,50,m,80,0;22,39,m,92,0;81,73,s,88,0;26,18,m,106,0;73,81,s,88,0;7,25,m,99,0;81,77,s,88,0;17,26,m,102,0;77,73,s,87,0;4,58,c,106,0;71,53,m,85,0;58,56,c,122,0;74,57,m,95,0;15,31,m,115,0;70,69,m,96,0;31,58,m,129,0;79,78,m,92,0;5,1,s,126,0;57,39,c,89,0;56,48,m,102,0;39,58,c,101,0;1,5,s,85,0;50,34,m,94,0;48,21,m,88,0;53,63,m,96,0;11,10,m,84,0;46,30,m,92,0;21,81,c,83,0;58,40,m,99,0;12,4,m,76,0;72,81,c,106,0;26,44,m,68,0;69,49,m,104,0;4,22,m,73,0;63,79,m,106,0;44,34,c,80,0;65,75,m,93,0;3,21,m,80,0;49,59,m,90,0;45,63,m,84,0;40,21,c,79,1;5,9,s,4,0;79,71,m,88,0;10,30,c,64,0;67,22,c,80,0;30,22,c,66,0;71,62,m,72,0;22,38,m,62,0;21,28,m,78,0;9,1,s,68,0","final":"12,11,0,0,18,0,0,16,18,0,0,0,0,11,0,0,0,11,0,0,0,0,0,0,17,0,0,25,0,0,0,0,0,11,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,21,0,0,21,11,0,0,0,0,21,0,0,0,0,22,0,21,0,0,27,0,26,21","next":67},{"steps":"77,81,s,54,0;15,24,m,54,0;81,77,s,54,0;24,34,m,59,0;77,81,s,54,0;5,9,s,68,0;67,59,m,54,0;9,5,s,67,0;59,61,m,66,0;14,23,m,68,0;81,77,s,68,0;12,28,m,84,0;69,60,m,69,0;3,66,c,97,0;71,63,m,70,0;5,1,s,111,0;76,66,c,74,0;6,60,c,93,0;77,81,s,76,0;5,6,m,107,0;70,54,m,76,0;60,68,c,106,0;65,55,m,82,0;6,5,m,101,0;66,34,c,85,0;17,26,m,92,0;63,62,m,99,0;28,48,m,93,0;34,28,m,93,0;11,31,m,99,0;74,65,m,85,0;1,9,s,104,0;65,56,m,88,0;9,5,s,109,0;77,68,c,91,0;16,25,m,90,0;78,6,m,97,1;5,1,s,5,0;28,12,m,107,0;31,29,m,91,0;12,10,c,111,1;2,10,c,3,0;62,42,m,95,0;25,35,m,93,0;75,35,c,102,0;4,54,c,85,0;56,66,m,101,0;48,46,m,94,0;42,58,m,103,0;29,11,m,91,0;61,71,m,105,0;10,30,m,86,0;6,30,c,92,0;54,72,c,78,1;81,73,s,4,0;72,81,c,72,0;64,56,m,96,0;81,71,c,64,0;58,60,m,94,0;7,16,m,75,0;35,26,c,96,0;71,21,m,73,0;26,18,c,94,0;46,37,m,60,0;66,64,m,92,0;21,30,c,62,0;18,9,c,64,0;30,60,c,78,0;56,58,m,47,0;60,58,c,76,0;64,56,m,38,0;58,56,c,77,0;9,54,m,27,0;11,12,m,76,0;54,44,m,36,0;56,76,m,80,1;73,65,m,4,0;76,79,c,75,0;44,52,m,37,0;79,52,c,73,0;55,64,m,17,0;37,46,m,81,0;65,66,m,15,0;12,32,m,78,0;66,75,m,16,0;46,37,m,78,0;75,74,m,15,0;23,22,m,80,0;64,65,m,14,0;22,31,m,80,0","final":"12,0,0,0,0,0,0,16,0,0,0,0,11,0,0,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,11,0,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,0,0,0,0,0,21,0,0,0,0,0,0,0,0,22,0,0,0,0,0,26,0","next":17},{"steps":"77,73,s,54,0;12,22,m,54,0;70,52,m,54,0;5,1,s,67,0;65,56,m,67,0;15,23,m,67,0;73,77,s,72,0;17,27,m,73,0;72,62,m,71,0;13,21,m,76,0;56,46,m,73,0;14,13,m,80,0;46,37,m,75,0;1,5,s,80,0;52,32,m,79,0;11,12,m,79,0;64,46,m,80,0;5,9,s,75,0;67,57,m,82,0;4,14,m,75,0;37,29,m,99,0;27,26,m,73,0;29,37,m,106,0;26,44,m,74,0;68,60,m,98,0;16,32,c,77,0;76,40,m,97,0;12,4,m,85,0;57,41,m,114,0;32,41,c,83,0;37,21,c,106,0;9,1,s,86,0;62,53,m,110,0;22,21,c,85,0;66,58,m,106,0;41,61,m,92,0;40,44,c,108,0;61,41,m,79,0;77,81,s,104,0;41,43,m,84,0;53,43,c,98,0;21,12,m,72,0;75,39,m,106,0;13,21,m,65,0;44,14,c,113,0;6,60,c,68,0;43,45,m,106,0;60,6,m,82,0;39,43,m,106,0;23,41,m,70,0;81,72,m,108,0;4,14,c,75,0;46,38,m,95,0;6,51,m,83,0;43,3,c,91,0;14,30,m,85,0;3,5,c,83,0;51,75,m,85,0;5,2,c,86,1;12,2,c,2,0;58,59,m,72,0;21,13,m,73,0;69,67,m,74,0;30,22,m,76,0;59,57,m,85,0;10,19,m,71,0;38,28,m,84,0;2,10,m,75,0;28,19,c,82,0;7,25,m,62,0;67,65,m,82,0;75,65,c,70,0;45,53,m,68,0;65,57,c,77,0;19,28,m,61,0;10,30,m,88,0;74,57,c,61,0;8,7,m,70,0;53,43,m,78,0;41,40,m,69,0;71,53,m,82,0;13,11,m,66,0;57,55,m,85,0;25,43,c,66,0;53,35,m,63,0;30,10,m,67,0;72,73,s,63,0;40,41,m,63,0;78,60,m,62,0;18,36,m,63,0;60,10,c,74,1;11,10,c,1,0;28,46,m,48,0;1,2,m,59,0;55,65,m,46,0;36,35,c,60,0;77,68,m,38,0;22,21,m,62,0;46,55,m,40,0;35,27,m,61,0;80,81,m,37,0;2,3,m,58,0;79,70,m,36,0;43,42,m,59,0;68,77,m,36,0;21,1,m,58,0;72,71,m,36,0;10,11,m,47,0;65,48,m,37,0;41,31,m,48,0;48,68,m,50,0;3,2,m,50,0;73,71,s,42,0;2,3,m,48,0;71,73,s,44,0;27,17,m,50,0;55,56,m,42,0;42,60,m,51,0;56,64,m,46,0;3,2,m,51,0","final":"11,12,0,0,0,0,16,0,0,0,11,0,0,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,17,0,0,0,21,0,0,0,25,0,27,28,0,22,0,0,0,28,0,0,0,26","next":39}]'::jsonb) loop
    v_gi := v_gi + 1; v_cells := v_b.cells; v_ids := v_b.ids; v_mover := 2;
    foreach stp in array string_to_array(g ->> 'steps', ';') loop
      p := string_to_array(stp, ','); v_f := p[1]::integer; v_t := p[2]::integer; v_n := p[4]::integer; v_steps := v_steps + 1;
      if public.cf_legal_count(v_cells, v_ids, v_mover) <> v_n then
        v_fails := v_fails || jsonb_build_array('game' || v_gi || ' step' || v_steps || ' legal_count'); exit;
      end if;
      if p[3] = 's' then v_ok := public.cf_swap_ok(v_cells, v_ids, v_mover, v_f, v_t);
      else
        v_act := public.cf_move_legal(v_cells, v_ids, v_mover, v_f, v_t);
        v_ok := v_act is not null and v_act = case p[3] when 'c' then 'capture' else 'move' end;
      end if;
      if not v_ok then v_fails := v_fails || jsonb_build_array('game' || v_gi || ' step' || v_steps || ' move_rejected'); exit; end if;
      select * into v_r from public.cf_apply(v_cells, v_ids, v_f, v_t, p[3] = 's');
      v_cells := v_r.ncells; v_ids := v_r.nids;
      v_chk := public.cf_in_check(v_cells, 3 - v_mover);
      if v_chk <> (p[5] = '1') then v_fails := v_fails || jsonb_build_array('game' || v_gi || ' step' || v_steps || ' check_flag'); exit; end if;
      v_mover := 3 - v_mover;
    end loop;
    if array_to_string(v_cells, ',') <> g ->> 'final' then v_fails := v_fails || jsonb_build_array('game' || v_gi || ' final_board'); end if;
    if public.cf_legal_count(v_cells, v_ids, v_mover) <> (g ->> 'next')::integer then v_fails := v_fails || jsonb_build_array('game' || v_gi || ' final_legal_count'); end if;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(v_fails) = 0, 'games', v_gi, 'steps_checked', v_steps, 'failures', v_fails);
end $$;
revoke all on function public.cf_selftest() from public;

-- =====================================================================
-- PHASE 4 — XẾP HẠNG (HELO), BẢNG XẾP HẠNG, REPLAY, ADMIN / BOSS, AUDIT LOG   (chạy lại được; chạy SAU Phase 1–3)
--
-- NGUYÊN TẮC: database là nguồn sự thật.
--  - HELO chỉ do cf_finish_match -> cf_apply_rating tính, MỘT lần/trận (khóa dòng + rating_processed_at + unique index).
--    Không RPC nào nhận số điểm từ client. Chỉ Quick Match (matches.ranked = true, do cf_matchmake đặt) có HELO.
--  - Role (user/admin/boss) kiểm tra trong từng RPC (cf_staff). Ẩn nút trên giao diện KHÔNG phải cơ chế bảo vệ.
--  - Mọi thao tác quản trị ghi admin_logs (bất biến: UPDATE/DELETE/TRUNCATE bị chặn bằng trigger).
--  - Trận Ranked đã kết thúc: kết quả, nước đi, snapshot, rating_events không sửa/xóa được qua client; có trigger chặn thêm.
--  - Chưa chạy được trên PostgreSQL trong môi trường phát triển: hãy chạy `select public.cf_phase4_selftest();` (cuối file).
-- =====================================================================

-- ---------- 12.1 Migration schema (an toàn khi chạy lại) ----------
-- Role: player -> user; thêm boss.
do $$
begin
  alter table public.user_roles drop constraint if exists user_roles_role_check;
  alter table public.user_roles drop constraint if exists user_roles_role_chk;
  update public.user_roles set role = 'user' where role = 'player';
  alter table public.user_roles alter column role set default 'user';
  alter table public.user_roles add constraint user_roles_role_chk check (role in ('user','admin','boss'));
end $$;

-- Trận Ranked đã kết thúc TRƯỚC Phase 4 không được tính HELO hồi tố (chỉ chạy đúng một lần, khi cột chưa tồn tại).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'matches' and column_name = 'rating_processed_at') then
    alter table public.matches add column rating_processed_at timestamptz;
    update public.matches set rating_processed_at = coalesce(ended_at, now()) where status = 'finished' and ranked;
  end if;
end $$;
alter table public.matches add column if not exists replay_purged_at timestamptz;

do $$
begin
  alter table public.matches drop constraint if exists matches_ranked_mode_chk;
  alter table public.matches add constraint matches_ranked_mode_chk check (not ranked or mode = 'quick');   -- Ranked chỉ có ở Quick Match
end $$;

alter table public.rating_events
  add column if not exists result      text,
  add column if not exists k_factor    integer,
  add column if not exists opponent_id text;
do $$
begin
  alter table public.rating_events drop constraint if exists rating_events_result_chk;
  alter table public.rating_events add constraint rating_events_result_chk check (result is null or result in ('win','loss','draw'));
end $$;
create unique index if not exists rating_events_match_user_uq on public.rating_events (match_id, user_id) where match_id is not null;
create index if not exists rating_events_created_idx on public.rating_events (created_at);

-- Audit log = admin_logs (mở rộng). actor = admin_id.
alter table public.admin_logs
  add column if not exists actor_role   text,
  add column if not exists reason       text,
  add column if not exists before_value jsonb,
  add column if not exists after_value  jsonb;
create index if not exists admin_logs_created_idx on public.admin_logs (created_at desc);

alter table public.reports add column if not exists resolution_note text;

-- Ảnh đại diện: chỉ URL https không chứa khoảng trắng / dấu nháy / < > \ (NOT VALID: không làm hỏng dữ liệu cũ, áp cho ghi mới).
alter table public.profiles drop constraint if exists profiles_avatar_safe;
alter table public.profiles add constraint profiles_avatar_safe
  check (avatar_url is null or avatar_url !~ '[[:space:]<>"''\\]') not valid;

-- Trạng thái replay riêng từng người, theo từng trận (replay_preferences của Phase 1 là cài đặt xem replay theo người dùng, PK = user_id).
create table if not exists public.replay_saves (
  match_id   uuid not null references public.matches(id) on delete cascade,
  user_id    text not null references public.profiles(user_id) on delete cascade,
  saved      boolean not null default false,   -- bookmark / "giữ lại"
  removed    boolean not null default false,   -- (Private/Friend) đã bỏ replay cá nhân
  hidden     boolean not null default false,   -- (Ranked) ẩn khỏi trang cá nhân
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index if not exists replay_saves_user_idx on public.replay_saves (user_id);
alter table public.replay_saves enable row level security;
drop policy if exists replay_saves_select on public.replay_saves;
create policy replay_saves_select on public.replay_saves for select to authenticated using (user_id = public.cf_uid());
grant select on public.replay_saves to authenticated;

-- Cấu hình tập trung (public để client hiển thị; CHỈ Boss sửa, qua RPC boss_update_setting).
insert into public.app_settings (key, value, is_public) values
  ('helo_config', '{"k_new":40,"k_established":32,"provisional_games":20}'::jsonb, true),
  ('rank_tiers', '[{"name":"Bronze","min":0},{"name":"Silver","min":100},{"name":"Gold","min":250},{"name":"Platinum","min":450},{"name":"Diamond","min":700},{"name":"Master","min":1000},{"name":"Grandmaster","min":1400}]'::jsonb, true),
  ('ranked_turn_seconds', '60'::jsonb, true)
on conflict (key) do nothing;

-- Bảo vệ lớp dữ liệu (chặn cả lỗi vận hành): audit log bất biến; kết quả/nước đi Ranked đã kết thúc không đổi/xóa.
create or replace function public.cf_audit_immutable() returns trigger
language plpgsql as $$ begin raise exception 'audit_immutable' using errcode = '42501'; end $$;
drop trigger if exists admin_logs_no_change   on public.admin_logs;
drop trigger if exists admin_logs_no_truncate on public.admin_logs;
create trigger admin_logs_no_change   before update or delete on public.admin_logs for each row       execute function public.cf_audit_immutable();
create trigger admin_logs_no_truncate before truncate          on public.admin_logs for each statement execute function public.cf_audit_immutable();

create or replace function public.cf_guard_match_result() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.ranked and old.status = 'finished' then raise exception 'result_locked' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status = 'finished' and old.ranked and
     (new.status, new.winner_side, new.winner_id, new.end_reason, new.ranked, new.red_id, new.blue_id, new.mode)
       is distinct from (old.status, old.winner_side, old.winner_id, old.end_reason, old.ranked, old.red_id, old.blue_id, old.mode) then
    raise exception 'result_locked' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists matches_result_lock on public.matches;
create trigger matches_result_lock before update or delete on public.matches for each row execute function public.cf_guard_match_result();

create or replace function public.cf_guard_ranked_children() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.matches m where m.id = old.match_id and m.ranked and m.status = 'finished') then
    raise exception 'audit_locked' using errcode = '42501';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
drop trigger if exists match_moves_ranked_lock     on public.match_moves;
drop trigger if exists match_snapshots_ranked_lock on public.match_snapshots;
drop trigger if exists match_events_ranked_lock    on public.match_events;
create trigger match_moves_ranked_lock     before update or delete on public.match_moves     for each row execute function public.cf_guard_ranked_children();
create trigger match_snapshots_ranked_lock before update or delete on public.match_snapshots for each row execute function public.cf_guard_ranked_children();
create trigger match_events_ranked_lock    before update or delete on public.match_events    for each row execute function public.cf_guard_ranked_children();

-- Đóng các quyền ghi cũ của Phase 1 nếu DB đã được cài bản trước (chạy lại an toàn).
drop policy if exists admin_logs_select       on public.admin_logs;
drop policy if exists admin_logs_insert       on public.admin_logs;
drop policy if exists reports_insert          on public.reports;
drop policy if exists reports_admin_update    on public.reports;
drop policy if exists app_settings_admin_write on public.app_settings;
revoke select, insert, update, delete on public.admin_logs from authenticated;
revoke insert, update, delete on public.reports from authenticated;
revoke insert, update, delete on public.app_settings from authenticated;

-- ---------- 12.2 Hàm nội bộ: cấu hình, rank, HELO ----------
create or replace function public.cf_cfg_int(p_key text, p_def integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric::integer end
                   from public.app_settings where key = p_key), p_def)
$$;

create or replace function public.cf_cfg_helo(p_field text, p_def integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(value -> p_field) = 'number' then (value ->> p_field)::numeric::integer end
                   from public.app_settings where key = 'helo_config' and jsonb_typeof(value) = 'object'), p_def)
$$;

-- Rank tính từ HELO hiện tại theo cấu hình tập trung app_settings.rank_tiers (không hardcode ngưỡng ở nơi khác).
create or replace function public.cf_rank_tier(p_rating integer) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.name from jsonb_to_recordset(coalesce((select value from public.app_settings
                                                      where key = 'rank_tiers' and jsonb_typeof(value) = 'array'), '[]'::jsonb)) as t(name text, min integer)
     where t.min <= p_rating order by t.min desc limit 1), 'Unranked')
$$;

-- HELO chuẩn: E = 1/(1+10^((Rb-Ra)/400)); R' = Ra + K*(S-E); sàn 0 (rating_profiles.rating >= 0).
create or replace function public.cf_helo_calc(p_ra integer, p_rb integer, p_sa numeric, p_k integer) returns integer
language sql immutable as $$
  select greatest(0, round(p_ra + p_k * (p_sa - 1.0 / (1.0 + power(10::numeric, (p_rb - p_ra)::numeric / 400.0))))::integer)
$$;

-- Đầu tuần (thứ Hai 00:00) theo Asia/Ho_Chi_Minh.
create or replace function public.cf_week_start(p_at timestamptz default now()) returns timestamptz
language sql stable as $$
  select date_trunc('week', p_at at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
$$;

-- Kết quả rating của một trận (NULL nếu chưa có) — đính kèm vào cf_match_state.
create or replace function public.cf_rating_json(p_match uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'red',  (select jsonb_build_object('before', e.rating_before, 'after', e.rating_after, 'delta', e.delta, 'tier', public.cf_rank_tier(e.rating_after))
             from public.rating_events e join public.matches m on m.id = e.match_id where e.match_id = p_match and e.user_id = m.red_id),
    'blue', (select jsonb_build_object('before', e.rating_before, 'after', e.rating_after, 'delta', e.delta, 'tier', public.cf_rank_tier(e.rating_after))
             from public.rating_events e join public.matches m on m.id = e.match_id where e.match_id = p_match and e.user_id = m.blue_id))
  where exists (select 1 from public.rating_events where match_id = p_match)
$$;

-- LÕI cập nhật HELO. Idempotent: khóa dòng matches (FOR UPDATE) -> kiểm rating_processed_at -> tính -> ghi -> đánh dấu.
-- unique index (match_id, user_id) trên rating_events là lớp chặn thứ hai chống cộng lặp.
create or replace function public.cf_apply_rating(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m public.matches; v_a public.rating_profiles; v_b public.rating_profiles;
  v_sa numeric; v_ka integer; v_kb integer; v_na integer; v_nb integer;
  v_knew  integer := public.cf_cfg_helo('k_new', 40);
  v_kest  integer := public.cf_cfg_helo('k_established', 32);
  v_prov  integer := public.cf_cfg_helo('provisional_games', 20);
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.rating_processed_at is not null then return jsonb_build_object('processed', true, 'already', true); end if;
  if not v_m.ranked then return jsonb_build_object('processed', false, 'reason', 'unranked'); end if;
  if v_m.status <> 'finished' or v_m.end_reason is null or v_m.winner_side is null or v_m.red_id = v_m.blue_id then
    return jsonb_build_object('processed', false, 'reason', 'not_final');
  end if;
  insert into public.rating_profiles (user_id) values (v_m.red_id), (v_m.blue_id) on conflict do nothing;
  perform 1 from public.rating_profiles where user_id in (v_m.red_id, v_m.blue_id) order by user_id for update;   -- thứ tự khóa cố định
  select * into v_a from public.rating_profiles where user_id = v_m.red_id;
  select * into v_b from public.rating_profiles where user_id = v_m.blue_id;
  v_sa := case v_m.winner_side when 'red' then 1 when 'blue' then 0 else 0.5 end;                 -- hòa: S = 0.5 cho cả hai
  v_ka := case when v_a.games_played < v_prov then v_knew else v_kest end;
  v_kb := case when v_b.games_played < v_prov then v_knew else v_kest end;
  v_na := public.cf_helo_calc(v_a.rating, v_b.rating, v_sa, v_ka);
  v_nb := public.cf_helo_calc(v_b.rating, v_a.rating, 1 - v_sa, v_kb);

  update public.rating_profiles set rating = v_na, peak_rating = greatest(peak_rating, v_na), games_played = games_played + 1,
    wins   = wins   + case when v_sa = 1   then 1 else 0 end,
    losses = losses + case when v_sa = 0   then 1 else 0 end,
    draws  = draws  + case when v_sa = 0.5 then 1 else 0 end, updated_at = now()
  where user_id = v_m.red_id;
  update public.rating_profiles set rating = v_nb, peak_rating = greatest(peak_rating, v_nb), games_played = games_played + 1,
    wins   = wins   + case when v_sa = 0   then 1 else 0 end,
    losses = losses + case when v_sa = 1   then 1 else 0 end,
    draws  = draws  + case when v_sa = 0.5 then 1 else 0 end, updated_at = now()
  where user_id = v_m.blue_id;

  insert into public.rating_events (user_id, match_id, delta, rating_before, rating_after, result, k_factor, opponent_id) values
    (v_m.red_id,  p_match, v_na - v_a.rating, v_a.rating, v_na, case v_sa when 1 then 'win' when 0 then 'loss' else 'draw' end, v_ka, v_m.blue_id),
    (v_m.blue_id, p_match, v_nb - v_b.rating, v_b.rating, v_nb, case v_sa when 0 then 'win' when 1 then 'loss' else 'draw' end, v_kb, v_m.red_id);

  update public.matches set rating_processed_at = now(), rev = rev + 1 where id = p_match;
  insert into public.match_events (match_id, event_type, payload)
  values (p_match, 'rating_updated', jsonb_build_object('red_delta', v_na - v_a.rating, 'blue_delta', v_nb - v_b.rating));
  return jsonb_build_object('processed', true, 'already', false);
end $$;

-- Người chơi đã đăng nhập, có thẩm quyền? (user -> admin -> boss). Trả về role. KHÔNG nhận role từ client.
create or replace function public.cf_staff(p_boss_only boolean default false) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_role text;
begin
  select role into v_role from public.user_roles where user_id = v_uid;
  if v_role is null or v_role not in ('admin','boss') or (p_boss_only and v_role <> 'boss') then raise exception 'not_allowed'; end if;
  return v_role;
end $$;

create or replace function public.cf_audit(p_actor text, p_role text, p_action text, p_target_type text, p_target_id text,
                                           p_before jsonb, p_after jsonb, p_reason text, p_meta jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_logs (admin_id, actor_role, action, target_type, target_id, before_value, after_value, reason, details)
  values (p_actor, p_role, p_action, p_target_type, p_target_id, p_before, p_after, p_reason, coalesce(p_meta, '{}'::jsonb));
end $$;

create or replace function public.cf_audit_rows(p_limit integer, p_before bigint, p_action text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.id desc), '[]'::jsonb) from (
    select l.id, jsonb_build_object('id', l.id, 'created_at', l.created_at, 'actor_id', l.admin_id, 'actor', pa.username, 'actor_role', l.actor_role,
      'action', l.action, 'target_type', l.target_type, 'target_id', l.target_id, 'target_name', pt.username, 'reason', l.reason,
      'before', l.before_value, 'after', l.after_value, 'meta', l.details) as j
    from public.admin_logs l
    join public.profiles pa on pa.user_id = l.admin_id
    left join public.profiles pt on l.target_type = 'user' and pt.user_id = l.target_id
    where (p_before is null or l.id < p_before) and (p_action is null or l.action = p_action)
    order by l.id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x
$$;

-- Dòng xếp hạng (nguồn chung cho RPC và "vị trí của tôi").
create or replace function public.cf_global_rows() returns table (user_id text, username text, display_name text, avatar_url text,
  rating integer, games integer, wins integer, draws integer, losses integer, pos bigint)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, rp.rating, rp.games_played, rp.wins, rp.draws, rp.losses,
         rank() over (order by rp.rating desc, rp.wins desc)
  from public.rating_profiles rp join public.profiles p on p.user_id = rp.user_id
  where rp.games_played > 0 and p.status = 'active'
$$;

-- Tuần: tổng biến động HELO từ rating_events trong [p_start, p_end). Hòa điểm: nhiều trận thắng hơn, rồi nhiều trận Ranked hơn.
create or replace function public.cf_weekly_rows(p_start timestamptz, p_end timestamptz) returns table (user_id text, username text, display_name text,
  avatar_url text, rating integer, delta integer, games integer, wins integer, draws integer, losses integer, pos bigint)
language sql stable security definer set search_path = public as $$
  select w.user_id, p.username, p.display_name, p.avatar_url, coalesce(rp.rating, 0), w.delta, w.games, w.wins, w.draws, w.losses,
         rank() over (order by w.delta desc, w.wins desc, w.games desc)
  from (select e.user_id, sum(e.delta)::integer as delta, count(*)::integer as games,
               (count(*) filter (where e.result = 'win'))::integer as wins, (count(*) filter (where e.result = 'draw'))::integer as draws,
               (count(*) filter (where e.result = 'loss'))::integer as losses
        from public.rating_events e where e.created_at >= p_start and e.created_at < p_end group by e.user_id) w
  join public.profiles p on p.user_id = w.user_id and p.status = 'active'
  left join public.rating_profiles rp on rp.user_id = w.user_id
$$;

-- ---------- 13. RPC cho client ----------
-- 13.1 finalize_match / update_ratings: chỉ NGƯỜI CHƠI của trận; không nhận số điểm; chỉ chạy lõi idempotent.
create or replace function public.update_ratings(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches; v_res jsonb;
begin
  if p_match is null then raise exception 'invalid_input'; end if;
  select * into v_m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid <> v_m.red_id and v_uid <> v_m.blue_id then raise exception 'not_a_player'; end if;
  v_res := public.cf_apply_rating(p_match);
  return v_res || jsonb_build_object('rating', public.cf_rating_json(p_match));
end $$;

create or replace function public.finalize_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches;
begin
  if p_match is null then raise exception 'invalid_input'; end if;
  select * into v_m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid <> v_m.red_id and v_uid <> v_m.blue_id then raise exception 'not_a_player'; end if;
  perform public.cf_expire_due(p_match);                                   -- hết giờ do đồng hồ DATABASE quyết định
  select * into v_m from public.matches where id = p_match;
  if v_m.status = 'finished' and v_m.ranked then perform public.cf_apply_rating(p_match); end if;
  return public.cf_match_state(p_match, v_uid, v_m.version);
end $$;

-- 13.2 Bảng xếp hạng
create or replace function public.get_global_leaderboard(p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 100); v_off integer := greatest(coalesce(p_offset, 0), 0);
        v_rows jsonb; v_my jsonb; v_total integer;
begin
  select count(*)::integer into v_total from public.cf_global_rows();
  select coalesce(jsonb_agg(jsonb_build_object('rank', y.pos, 'user_id', y.user_id, 'username', y.username, 'display_name', y.display_name,
      'avatar_url', y.avatar_url, 'rating', y.rating, 'tier', public.cf_rank_tier(y.rating), 'games', y.games, 'wins', y.wins, 'draws', y.draws,
      'losses', y.losses, 'win_rate', case when y.games >= 5 then round(y.wins::numeric * 100 / y.games, 1) end) order by y.pos, y.username), '[]'::jsonb)
    into v_rows from (select * from public.cf_global_rows() order by pos, username limit v_lim offset v_off) y;
  select jsonb_build_object('rank', r.pos, 'rating', r.rating, 'tier', public.cf_rank_tier(r.rating), 'games', r.games, 'wins', r.wins, 'draws', r.draws, 'losses', r.losses)
    into v_my from public.cf_global_rows() r where r.user_id = v_uid;
  return jsonb_build_object('rows', v_rows, 'my', v_my, 'total', v_total, 'offset', v_off, 'min_games_for_win_rate', 5);
end $$;

create or replace function public.get_weekly_leaderboard(p_week_offset integer default 0, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 100); v_off integer := greatest(coalesce(p_offset, 0), 0);
        v_w integer := least(greatest(coalesce(p_week_offset, 0), -52), 0); v_start timestamptz; v_end timestamptz; v_rows jsonb; v_my jsonb; v_total integer;
begin
  v_start := public.cf_week_start(now() + v_w * interval '7 days');
  v_end   := v_start + interval '7 days';                                   -- [thứ Hai 00:00, thứ Hai kế tiếp 00:00) = đến Chủ nhật 23:59:59
  select count(*)::integer into v_total from public.cf_weekly_rows(v_start, v_end);
  select coalesce(jsonb_agg(jsonb_build_object('rank', y.pos, 'user_id', y.user_id, 'username', y.username, 'display_name', y.display_name,
      'avatar_url', y.avatar_url, 'delta', y.delta, 'rating', y.rating, 'tier', public.cf_rank_tier(y.rating), 'games', y.games, 'wins', y.wins,
      'draws', y.draws, 'losses', y.losses) order by y.pos, y.username), '[]'::jsonb)
    into v_rows from (select * from public.cf_weekly_rows(v_start, v_end) order by pos, username limit v_lim offset v_off) y;
  select jsonb_build_object('rank', r.pos, 'delta', r.delta, 'games', r.games, 'wins', r.wins) into v_my
    from public.cf_weekly_rows(v_start, v_end) r where r.user_id = v_uid;
  return jsonb_build_object('rows', v_rows, 'my', v_my, 'total', v_total, 'offset', v_off, 'week_start', v_start, 'week_end', v_end - interval '1 second',
                            'timezone', 'Asia/Ho_Chi_Minh', 'week_offset', v_w);
end $$;

-- 13.3 Lịch sử HELO (công khai giữa người chơi đã đăng nhập: kết quả Ranked là dữ liệu chính thức)
create or replace function public.get_rating_history(p_user text default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_t text := coalesce(nullif(btrim(p_user), ''), v_uid); v_rp public.rating_profiles; v_ev jsonb;
begin
  if not exists (select 1 from public.profiles where user_id = v_t) then raise exception 'user_not_found'; end if;
  select * into v_rp from public.rating_profiles where user_id = v_t;
  select coalesce(jsonb_agg(jsonb_build_object('match_id', e.match_id, 'delta', e.delta, 'before', e.rating_before, 'after', e.rating_after,
      'result', e.result, 'created_at', e.created_at, 'opponent', (select p.username from public.profiles p where p.user_id = e.opponent_id)) order by e.id desc), '[]'::jsonb)
    into v_ev from (select * from public.rating_events where user_id = v_t order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) e;
  return jsonb_build_object('user_id', v_t, 'rating', coalesce(v_rp.rating, 0), 'tier', public.cf_rank_tier(coalesce(v_rp.rating, 0)), 'events', v_ev);
end $$;

-- 13.4 Hồ sơ công khai + thống kê + thành tích (suy ra từ số liệu thật) + lịch sử trận
--      Người khác chỉ thấy trận Ranked không bị chủ hồ sơ ẩn; chính chủ thấy mọi chế độ (trừ replay Private/Friend đã bỏ).
create or replace function public.get_player_profile(p_username text default null, p_match_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid text := public.cf_uid(); v_p public.profiles; v_rp public.rating_profiles; v_me boolean; v_pos bigint; v_ach jsonb := '[]'::jsonb; v_mt jsonb;
  v_off integer := greatest(coalesce(p_match_offset, 0), 0);
begin
  if p_username is null or btrim(p_username) = '' then select * into v_p from public.profiles where user_id = v_uid;
  else select * into v_p from public.profiles where username = lower(btrim(p_username)); end if;
  if not found then raise exception 'user_not_found'; end if;
  v_me := v_p.user_id = v_uid;
  select * into v_rp from public.rating_profiles where user_id = v_p.user_id;
  select pos into v_pos from public.cf_global_rows() r where r.user_id = v_p.user_id;
  if coalesce(v_rp.wins, 0) >= 1  then v_ach := v_ach || jsonb_build_array(jsonb_build_object('key', 'first_win', 'label', 'Chiến thắng Ranked đầu tiên')); end if;
  if coalesce(v_rp.wins, 0) >= 10 then v_ach := v_ach || jsonb_build_array(jsonb_build_object('key', 'wins_10', 'label', '10 trận thắng Ranked')); end if;
  if coalesce(v_rp.games_played, 0) >= 50 then v_ach := v_ach || jsonb_build_array(jsonb_build_object('key', 'games_50', 'label', '50 trận Ranked')); end if;
  if coalesce(v_rp.games_played, 0) >= 1 then
    v_ach := v_ach || jsonb_build_array(jsonb_build_object('key', 'peak_tier', 'label', 'Hạng cao nhất: ' || public.cf_rank_tier(v_rp.peak_rating)));
  end if;

  select coalesce(jsonb_agg(z.j order by z.ended desc, z.mid desc), '[]'::jsonb) into v_mt from (
    select m.ended_at as ended, m.id as mid, jsonb_build_object(
      'match_id', m.id, 'mode', m.mode, 'ranked', m.ranked, 'ended_at', m.ended_at, 'end_reason', m.end_reason, 'plies', m.version,
      'side', case when m.red_id = v_p.user_id then 'red' else 'blue' end,
      'result', case when m.winner_side = 'draw' then 'draw'
                     when (m.winner_side = 'red' and m.red_id = v_p.user_id) or (m.winner_side = 'blue' and m.blue_id = v_p.user_id) then 'win' else 'loss' end,
      'opponent', public.cf_profile_json(case when m.red_id = v_p.user_id then m.blue_id else m.red_id end),
      'delta', (select e.delta from public.rating_events e where e.match_id = m.id and e.user_id = v_p.user_id),
      'replay_available', m.replay_purged_at is null,
      'saved',  case when v_me then coalesce(rs.saved, false) end,
      'hidden', case when v_me then coalesce(rs.hidden, false) end) as j
    from public.matches m
    left join public.replay_saves rs on rs.match_id = m.id and rs.user_id = v_p.user_id
    where m.status = 'finished' and (m.red_id = v_p.user_id or m.blue_id = v_p.user_id)
      and ((v_me and not (not m.ranked and coalesce(rs.removed, false))) or (not v_me and m.ranked and not coalesce(rs.hidden, false)))
    order by m.ended_at desc nulls last, m.id desc limit 20 offset v_off) z;

  return jsonb_build_object('user_id', v_p.user_id, 'username', v_p.username, 'display_name', v_p.display_name, 'avatar_url', v_p.avatar_url,
    'bio', v_p.bio, 'joined_at', v_p.created_at, 'is_me', v_me, 'status', case when v_me or public.is_admin() then v_p.status end,
    'rating', jsonb_build_object('rating', coalesce(v_rp.rating, 0), 'peak', coalesce(v_rp.peak_rating, 0), 'games', coalesce(v_rp.games_played, 0),
      'wins', coalesce(v_rp.wins, 0), 'draws', coalesce(v_rp.draws, 0), 'losses', coalesce(v_rp.losses, 0),
      'win_rate', case when coalesce(v_rp.games_played, 0) >= 5 then round(v_rp.wins::numeric * 100 / v_rp.games_played, 1) end,
      'tier', public.cf_rank_tier(coalesce(v_rp.rating, 0)), 'position', v_pos),
    'achievements', v_ach, 'matches', v_mt, 'match_offset', v_off);
end $$;

-- 13.5 Replay
create or replace function public.export_match_notation_data(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches; v_rs public.replay_saves; v_mv jsonb; v_init jsonb; v_part boolean; v_staff boolean := public.is_admin();
begin
  if p_match is null then raise exception 'invalid_input'; end if;
  select * into v_m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.status <> 'finished' then raise exception 'match_not_finished'; end if;
  if v_m.replay_purged_at is not null then raise exception 'replay_unavailable'; end if;
  v_part := v_uid in (v_m.red_id, v_m.blue_id);
  select * into v_rs from public.replay_saves where match_id = p_match and user_id = v_uid;
  if v_staff then null;
  elsif v_part then
    if not v_m.ranked and coalesce(v_rs.removed, false) then raise exception 'replay_unavailable'; end if;     -- đã bỏ replay cá nhân (Private/Friend)
  elsif v_m.ranked then
    if exists (select 1 from public.replay_saves where match_id = p_match and hidden) then raise exception 'replay_unavailable'; end if;   -- người chơi đã ẩn
  else raise exception 'not_allowed';
  end if;
  select state into v_init from public.match_snapshots where match_id = p_match and ply = 0;
  select coalesce(jsonb_agg(jsonb_build_object('move_number', x.move_number, 'side', case when x.player_id = v_m.red_id then 'red' else 'blue' end,
      'player_id', x.player_id, 'piece_id', x.piece_id, 'piece_type', x.piece_type, 'from_row', x.from_row, 'from_col', x.from_col,
      'to_row', x.to_row, 'to_col', x.to_col, 'captured_piece', x.captured_piece, 'action_type', x.action_type, 'created_at', x.created_at,
      'state_snapshot', x.state_snapshot) order by x.move_number), '[]'::jsonb)
    into v_mv from public.match_moves x where x.match_id = p_match;
  return jsonb_build_object(
    'match', jsonb_build_object('id', v_m.id, 'mode', v_m.mode, 'ranked', v_m.ranked, 'winner_side', v_m.winner_side, 'winner_id', v_m.winner_id,
      'end_reason', v_m.end_reason, 'started_at', v_m.started_at, 'ended_at', v_m.ended_at, 'plies', v_m.version,
      'red', public.cf_profile_json(v_m.red_id), 'blue', public.cf_profile_json(v_m.blue_id)),
    'initial', v_init, 'moves', v_mv, 'rating', public.cf_rating_json(p_match),
    'you', case when v_part then case when v_uid = v_m.red_id then 'red' else 'blue' end else 'viewer' end,
    'mine', case when v_part then jsonb_build_object('saved', coalesce(v_rs.saved, false), 'removed', coalesce(v_rs.removed, false), 'hidden', coalesce(v_rs.hidden, false)) end);
end $$;

create or replace function public.save_replay(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches;
begin
  if p_match is null then raise exception 'invalid_input'; end if;
  select * into v_m from public.matches where id = p_match for update;           -- tuần tự hóa với delete_personal_replay
  if not found then raise exception 'match_not_found'; end if;
  if v_uid <> v_m.red_id and v_uid <> v_m.blue_id then raise exception 'not_a_player'; end if;
  if v_m.status <> 'finished' then raise exception 'match_not_finished'; end if;
  if v_m.replay_purged_at is not null then raise exception 'replay_unavailable'; end if;
  insert into public.replay_saves (match_id, user_id, saved, removed, hidden) values (p_match, v_uid, true, false, false)
  on conflict (match_id, user_id) do update set saved = true, removed = false, hidden = false, updated_at = now();
  return jsonb_build_object('match_id', p_match, 'saved', true, 'removed', false, 'hidden', false, 'ranked', v_m.ranked);
end $$;

-- Private/Friend: bỏ replay CÁ NHÂN của mình. Chỉ khi CẢ HAI đã bỏ thì xóa dữ liệu replay chung (nước đi + snapshot; bản ghi trận và kết quả vẫn giữ).
-- Ranked: KHÔNG xóa dữ liệu nào; p_hide = true => ẩn khỏi trang cá nhân; ngược lại => bỏ bookmark.
create or replace function public.delete_personal_replay(p_match uuid, p_hide boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_m public.matches; v_purged boolean := false; v_hide boolean := coalesce(p_hide, false);
begin
  if p_match is null then raise exception 'invalid_input'; end if;
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid <> v_m.red_id and v_uid <> v_m.blue_id then raise exception 'not_a_player'; end if;
  if v_m.status <> 'finished' then raise exception 'match_not_finished'; end if;
  if v_m.ranked then
    insert into public.replay_saves (match_id, user_id, saved, hidden) values (p_match, v_uid, false, v_hide)
    on conflict (match_id, user_id) do update set
      saved = case when v_hide then public.replay_saves.saved else false end,
      hidden = case when v_hide then true else public.replay_saves.hidden end, updated_at = now();
  else
    insert into public.replay_saves (match_id, user_id, saved, removed) values (p_match, v_uid, false, true)
    on conflict (match_id, user_id) do update set saved = false, removed = true, updated_at = now();
    if v_m.replay_purged_at is null and
       (select count(*) from public.replay_saves where match_id = p_match and removed and user_id in (v_m.red_id, v_m.blue_id)) = 2 then
      delete from public.match_moves where match_id = p_match;
      delete from public.match_snapshots where match_id = p_match;
      update public.matches set replay_purged_at = now() where id = p_match;
      v_purged := true;
    end if;
  end if;
  return jsonb_build_object('match_id', p_match, 'ranked', v_m.ranked, 'hidden', v_m.ranked and v_hide, 'removed', not v_m.ranked, 'shared_data_purged', v_purged);
end $$;

-- 13.6 Báo cáo người chơi (thay INSERT trực tiếp): giới hạn tốc độ + chống trùng
create or replace function public.submit_report(p_target_user text, p_match uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_reason text := btrim(coalesce(p_reason, '')); v_t text; v_id uuid; v_m public.matches;
begin
  if char_length(v_reason) not between 5 and 1000 then raise exception 'invalid_reason'; end if;
  select user_id into v_t from public.profiles where user_id = p_target_user;
  if v_t is null then raise exception 'user_not_found'; end if;
  if v_t = v_uid then raise exception 'cannot_target_self'; end if;
  if p_match is not null then
    select * into v_m from public.matches where id = p_match;
    if not found or v_uid not in (v_m.red_id, v_m.blue_id) or v_t not in (v_m.red_id, v_m.blue_id) then raise exception 'invalid_input'; end if;
  end if;
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then raise exception 'too_many_reports'; end if;
  if exists (select 1 from public.reports where reporter_id = v_uid and target_user_id = v_t and status in ('open','reviewing') and created_at > now() - interval '24 hours') then
    raise exception 'report_duplicate';
  end if;
  insert into public.reports (reporter_id, target_user_id, match_id, reason) values (v_uid, v_t, p_match, v_reason) returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'open');
end $$;

-- 13.7 Admin: khóa/mở khóa, xử lý báo cáo. Mọi thao tác có lý do và ghi audit log.
--  Admin: suspend/restore người chơi thường; xem xét/xử lý/bỏ qua báo cáo. Boss: thêm ban và tác động lên Admin.
--  Không ai (kể cả Boss) đổi được HELO/kết quả (không có RPC nào làm việc đó). Không tự tác động lên chính mình; không tác động lên Boss.
create or replace function public.admin_user_action(p_action text, p_target_user text default null, p_report uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := public.cf_uid(); v_role text := public.cf_staff(false); v_reason text := btrim(coalesce(p_reason, ''));
  v_old text; v_new text; v_trole text; v_rep public.reports; v_tid text;
begin
  if char_length(v_reason) not between 5 and 500 then raise exception 'invalid_reason'; end if;
  if p_action in ('suspend','ban','restore') then
    if p_target_user is null then raise exception 'invalid_input'; end if;
    select p.status, coalesce(ur.role, 'user') into v_old, v_trole
      from public.profiles p left join public.user_roles ur on ur.user_id = p.user_id where p.user_id = p_target_user for update of p;
    if not found then raise exception 'target_not_found'; end if;
    if p_target_user = v_uid then raise exception 'cannot_target_self'; end if;
    if v_trole = 'boss' or (v_trole = 'admin' and v_role <> 'boss') then raise exception 'cannot_target_role'; end if;
    if p_action = 'ban' and v_role <> 'boss' then raise exception 'not_allowed'; end if;
    if v_old = 'banned' and v_role <> 'boss' then raise exception 'not_allowed'; end if;          -- chỉ Boss gỡ lệnh cấm
    v_new := case p_action when 'suspend' then 'suspended' when 'ban' then 'banned' else 'active' end;
    if v_old = v_new then return jsonb_build_object('changed', false, 'status', v_new); end if;
    update public.profiles set status = v_new where user_id = p_target_user;
    perform public.cf_audit(v_uid, v_role, 'user_' || p_action, 'user', p_target_user, jsonb_build_object('status', v_old), jsonb_build_object('status', v_new), v_reason);
    return jsonb_build_object('changed', true, 'status', v_new);
  elsif p_action in ('review','resolve','dismiss') then
    if p_report is null then raise exception 'invalid_input'; end if;
    select * into v_rep from public.reports where id = p_report for update;
    if not found then raise exception 'report_not_found'; end if;
    select coalesce(ur.role, 'user') into v_trole from public.profiles p left join public.user_roles ur on ur.user_id = p.user_id where p.user_id = v_rep.target_user_id;
    if v_rep.target_user_id = v_uid or v_rep.reporter_id = v_uid then raise exception 'cannot_target_self'; end if;
    if v_trole = 'boss' and v_role <> 'boss' then raise exception 'cannot_target_role'; end if;
    v_new := case p_action when 'review' then 'reviewing' when 'resolve' then 'resolved' else 'dismissed' end;
    if v_rep.status in ('resolved','dismissed') or v_rep.status = v_new then return jsonb_build_object('changed', false, 'status', v_rep.status); end if;
    update public.reports set status = v_new, resolution_note = v_reason,
      resolved_by = case when v_new in ('resolved','dismissed') then v_uid else resolved_by end,
      resolved_at = case when v_new in ('resolved','dismissed') then now() else resolved_at end where id = p_report;
    perform public.cf_audit(v_uid, v_role, 'report_' || p_action, 'report', p_report::text, jsonb_build_object('status', v_rep.status), jsonb_build_object('status', v_new), v_reason,
      jsonb_build_object('target_user_id', v_rep.target_user_id));
    return jsonb_build_object('changed', true, 'status', v_new);
  end if;
  raise exception 'invalid_action';
end $$;

-- 13.8 Boss: chỉ định / thu hồi Admin
create or replace function public.boss_manage_admin(p_action text, p_target_user text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_role text := public.cf_staff(true); v_reason text := btrim(coalesce(p_reason, '')); v_old text; v_st text; v_new text;
begin
  if char_length(v_reason) not between 5 and 500 then raise exception 'invalid_reason'; end if;
  if p_action not in ('grant','revoke') or p_target_user is null then raise exception 'invalid_action'; end if;
  if p_target_user = v_uid then raise exception 'cannot_target_self'; end if;
  select p.status, coalesce(ur.role, 'user') into v_st, v_old
    from public.profiles p left join public.user_roles ur on ur.user_id = p.user_id where p.user_id = p_target_user for update of p;
  if not found then raise exception 'target_not_found'; end if;
  if v_old = 'boss' then raise exception 'cannot_target_role'; end if;
  if p_action = 'grant' then
    if v_st <> 'active' then raise exception 'cannot_target_role'; end if;
    v_new := 'admin';
  else v_new := 'user'; end if;
  if v_old = v_new then return jsonb_build_object('changed', false, 'role', v_new); end if;
  insert into public.user_roles (user_id, role, granted_at) values (p_target_user, v_new, now())
  on conflict (user_id) do update set role = excluded.role, granted_at = now();
  perform public.cf_audit(v_uid, v_role, 'admin_' || p_action, 'user', p_target_user, jsonb_build_object('role', v_old), jsonb_build_object('role', v_new), v_reason);
  return jsonb_build_object('changed', true, 'role', v_new);
end $$;

-- 13.9 Boss: cấu hình hệ thống (whitelist 3 khóa, có kiểm tra giá trị)
create or replace function public.boss_update_setting(p_key text, p_value jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := public.cf_uid(); v_role text := public.cf_staff(true); v_reason text := btrim(coalesce(p_reason, '')); v_old jsonb;
  v_el jsonb; v_prev integer := -1; v_i integer := 0; v_min integer; v_names text[] := '{}'; v_k text; v_n integer;
begin
  if char_length(v_reason) not between 5 and 500 then raise exception 'invalid_reason'; end if;
  if p_value is null then raise exception 'invalid_setting'; end if;
  if p_key = 'ranked_turn_seconds' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') not in ('30','60','90','120') then raise exception 'invalid_setting'; end if;
  elsif p_key = 'helo_config' then
    if jsonb_typeof(p_value) <> 'object' then raise exception 'invalid_setting'; end if;
    for v_k in select jsonb_object_keys(p_value) loop
      if v_k not in ('k_new','k_established','provisional_games') then raise exception 'invalid_setting'; end if;
    end loop;
    foreach v_k in array array['k_new','k_established','provisional_games'] loop
      if coalesce(jsonb_typeof(p_value -> v_k), '') <> 'number' or (p_value ->> v_k) !~ '^[0-9]{1,3}$' then raise exception 'invalid_setting'; end if;
      v_n := (p_value ->> v_k)::integer;
      if (v_k <> 'provisional_games' and v_n not between 1 and 100) or (v_k = 'provisional_games' and v_n not between 0 and 200) then raise exception 'invalid_setting'; end if;
    end loop;
  elsif p_key = 'rank_tiers' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) not between 2 and 10 then raise exception 'invalid_setting'; end if;
    for v_el in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_el) <> 'object' or coalesce(jsonb_typeof(v_el -> 'name'), '') <> 'string' or coalesce(jsonb_typeof(v_el -> 'min'), '') <> 'number' then
        raise exception 'invalid_setting';
      end if;
      v_min := case when (v_el ->> 'min') ~ '^[0-9]{1,5}$' then (v_el ->> 'min')::integer else -1 end;
      if v_min <= v_prev or (v_i = 0 and v_min <> 0) or char_length(btrim(v_el ->> 'name')) not between 1 and 20 or btrim(v_el ->> 'name') = any (v_names) then
        raise exception 'invalid_setting';
      end if;
      v_prev := v_min; v_names := v_names || btrim(v_el ->> 'name'); v_i := v_i + 1;
    end loop;
  else raise exception 'invalid_setting';
  end if;
  select value into v_old from public.app_settings where key = p_key for update;
  insert into public.app_settings (key, value, is_public, updated_by) values (p_key, p_value, true, v_uid)
  on conflict (key) do update set value = excluded.value, updated_by = v_uid;
  perform public.cf_audit(v_uid, v_role, 'setting_update', 'setting', p_key, to_jsonb(v_old), p_value, v_reason);
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- 13.10 Dashboard (chỉ số thật; không có dữ liệu thì không trả)
create or replace function public.get_admin_dashboard(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid text := public.cf_uid(); v_role text := public.cf_staff(false); v_s text := nullif(btrim(coalesce(p_search, '')), ''); v_pat text;
  v_users jsonb; v_reports jsonb; v_queue jsonb; v_live jsonb;
begin
  if v_s is not null then v_pat := '%' || replace(replace(replace(lower(left(v_s, 30)), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', u.user_id, 'username', u.username, 'display_name', u.display_name, 'status', u.status,
      'role', u.role, 'created_at', u.created_at, 'rating', u.rating) order by u.created_at desc), '[]'::jsonb) into v_users from (
    select p.user_id, p.username, p.display_name, p.status, coalesce(ur.role, 'user') as role, p.created_at, rp.rating
    from public.profiles p left join public.user_roles ur on ur.user_id = p.user_id left join public.rating_profiles rp on rp.user_id = p.user_id
    where v_pat is null or p.username like v_pat escape '\' order by p.created_at desc limit 30) u;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'created_at', r.created_at, 'match_id', r.match_id,
      'reporter_id', r.reporter_id, 'reporter', pr.username, 'target_user_id', r.target_user_id, 'target', pt.username, 'target_status', pt.status) order by r.created_at), '[]'::jsonb)
    into v_reports from (select * from public.reports where status in ('open','reviewing') order by created_at limit 50) r
    join public.profiles pr on pr.user_id = r.reporter_id join public.profiles pt on pt.user_id = r.target_user_id;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', q.target_user_id, 'username', p.username, 'pending_reports', q.n) order by q.n desc), '[]'::jsonb) into v_queue
    from (select target_user_id, count(*)::integer as n from public.reports where status in ('open','reviewing') group by target_user_id having count(*) >= 2 order by 2 desc limit 10) q
    join public.profiles p on p.user_id = q.target_user_id;
  select coalesce(jsonb_agg(jsonb_build_object('match_id', m.id, 'mode', m.mode, 'ranked', m.ranked, 'plies', m.version, 'started_at', m.started_at,
      'red', public.cf_profile_json(m.red_id), 'blue', public.cf_profile_json(m.blue_id)) order by m.started_at desc), '[]'::jsonb) into v_live
    from (select * from public.matches where status = 'active' order by started_at desc limit 20) m;
  return jsonb_build_object(
    'role', v_role, 'generated_at', now(),
    'users_total', (select count(*) from public.profiles),
    'users_new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'users_active_5m', (select count(*) from public.profiles where last_seen_at > now() - interval '5 minutes'),
    'users_suspended', (select count(*) from public.profiles where status <> 'active'),
    'reports_open', (select count(*) from public.reports where status = 'open'),
    'reports_reviewing', (select count(*) from public.reports where status = 'reviewing'),
    'reports_resolved', (select count(*) from public.reports where status = 'resolved'),
    'reports_dismissed', (select count(*) from public.reports where status = 'dismissed'),
    'matches_active', (select count(*) from public.matches where status = 'active'),
    'matches_finished', (select count(*) from public.matches where status = 'finished'),
    'users', v_users, 'reports', v_reports, 'review_queue', v_queue, 'live_matches', v_live);
end $$;

create or replace function public.get_boss_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid text := public.cf_uid(); v_role text := public.cf_staff(true); v_admins jsonb; v_set jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', p.username, 'display_name', p.display_name, 'status', p.status,
      'granted_at', ur.granted_at) order by ur.granted_at desc), '[]'::jsonb) into v_admins
    from public.user_roles ur join public.profiles p on p.user_id = ur.user_id where ur.role = 'admin';
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_set from public.app_settings where key in ('helo_config','rank_tiers','ranked_turn_seconds');
  return public.get_admin_dashboard(null) || jsonb_build_object(
    'admins', v_admins, 'settings', v_set,
    'bosses_total', (select count(*) from public.user_roles where role = 'boss'),
    'admins_total', (select count(*) from public.user_roles where role = 'admin'),
    'ranked_finished', (select count(*) from public.matches where status = 'finished' and ranked),
    'rating_events_total', (select count(*) from public.rating_events),
    'audit_total', (select count(*) from public.admin_logs),
    'recent_audit', public.cf_audit_rows(20, null, null));
end $$;

create or replace function public.get_audit_logs(p_limit integer default 50, p_before bigint default null, p_action text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text := public.cf_staff(false);
begin
  return jsonb_build_object('rows', public.cf_audit_rows(p_limit, p_before, nullif(btrim(coalesce(p_action, '')), '')));
end $$;

-- ---------- 14. Quyền thực thi ----------
-- (mỗi hàm một cặp câu lệnh đơn giản, không dùng khối DO, để tương thích mọi trình chạy SQL)
revoke all on function public.update_ratings(uuid) from public;
grant execute on function public.update_ratings(uuid) to authenticated;
revoke all on function public.finalize_match(uuid) from public;
grant execute on function public.finalize_match(uuid) to authenticated;
revoke all on function public.get_global_leaderboard(integer,integer) from public;
grant execute on function public.get_global_leaderboard(integer,integer) to authenticated;
revoke all on function public.get_weekly_leaderboard(integer,integer,integer) from public;
grant execute on function public.get_weekly_leaderboard(integer,integer,integer) to authenticated;
revoke all on function public.get_rating_history(text,integer) from public;
grant execute on function public.get_rating_history(text,integer) to authenticated;
revoke all on function public.get_player_profile(text,integer) from public;
grant execute on function public.get_player_profile(text,integer) to authenticated;
revoke all on function public.export_match_notation_data(uuid) from public;
grant execute on function public.export_match_notation_data(uuid) to authenticated;
revoke all on function public.save_replay(uuid) from public;
grant execute on function public.save_replay(uuid) to authenticated;
revoke all on function public.delete_personal_replay(uuid,boolean) from public;
grant execute on function public.delete_personal_replay(uuid,boolean) to authenticated;
revoke all on function public.submit_report(text,uuid,text) from public;
grant execute on function public.submit_report(text,uuid,text) to authenticated;
revoke all on function public.admin_user_action(text,text,uuid,text) from public;
grant execute on function public.admin_user_action(text,text,uuid,text) to authenticated;
revoke all on function public.boss_manage_admin(text,text,text) from public;
grant execute on function public.boss_manage_admin(text,text,text) to authenticated;
revoke all on function public.boss_update_setting(text,jsonb,text) from public;
grant execute on function public.boss_update_setting(text,jsonb,text) to authenticated;
revoke all on function public.get_admin_dashboard(text) from public;
grant execute on function public.get_admin_dashboard(text) to authenticated;
revoke all on function public.get_boss_dashboard() from public;
grant execute on function public.get_boss_dashboard() to authenticated;
revoke all on function public.get_audit_logs(integer,bigint,text) from public;
grant execute on function public.get_audit_logs(integer,bigint,text) to authenticated;
grant execute on function public.is_boss() to authenticated;

-- cf_* (kể cả hàm mới của Phase 4) KHÔNG cấp cho client.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'cf\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
  end loop;
end $$;

-- ---------- 15. Tự kiểm Phase 4 (chạy trong SQL Editor:  select public.cf_phase4_selftest(); ) ----------
-- Kiểm: công thức HELO, ngưỡng rank (theo cấu hình MẶC ĐỊNH — chạy trước khi Boss đổi cấu hình), ranh giới tuần Asia/Ho_Chi_Minh.
create or replace function public.cf_phase4_selftest() returns jsonb
language plpgsql set search_path = public as $$
declare v_f jsonb := '[]'::jsonb;
begin
  if public.cf_helo_calc(1000, 1000, 1, 40) <> 1020 then v_f := v_f || '"elo win 1000v1000 K40 = 1020"'::jsonb; end if;
  if public.cf_helo_calc(1000, 1000, 0, 40) <> 980  then v_f := v_f || '"elo loss 1000v1000 K40 = 980"'::jsonb; end if;
  if public.cf_helo_calc(1000, 1200, 0.5, 40) <> 1010 then v_f := v_f || '"elo draw 1000v1200 K40 = 1010"'::jsonb; end if;
  if public.cf_helo_calc(1200, 1000, 0.5, 40) <> 1190 then v_f := v_f || '"elo draw 1200v1000 K40 = 1190"'::jsonb; end if;
  if public.cf_helo_calc(1000, 1400, 1, 32) <> 1029 then v_f := v_f || '"elo upset 1000v1400 K32 = 1029"'::jsonb; end if;
  if public.cf_helo_calc(5, 2000, 0, 40) <> 5 then v_f := v_f || '"elo floor/clamp"'::jsonb; end if;
  if public.cf_helo_calc(0, 1000, 0, 40) <> 0 then v_f := v_f || '"elo never below 0"'::jsonb; end if;
  if public.cf_rank_tier(99) <> 'Bronze' or public.cf_rank_tier(100) <> 'Silver' or public.cf_rank_tier(249) <> 'Silver'
     or public.cf_rank_tier(250) <> 'Gold' or public.cf_rank_tier(449) <> 'Gold' or public.cf_rank_tier(450) <> 'Platinum'
     or public.cf_rank_tier(699) <> 'Platinum' or public.cf_rank_tier(700) <> 'Diamond' or public.cf_rank_tier(999) <> 'Diamond'
     or public.cf_rank_tier(1000) <> 'Master' or public.cf_rank_tier(1399) <> 'Master' or public.cf_rank_tier(1400) <> 'Grandmaster' or public.cf_rank_tier(3500) <> 'Grandmaster' then
    v_f := v_f || '"rank tiers (cấu hình mặc định)"'::jsonb;
  end if;
  if public.cf_week_start('2026-11-09 00:00:00+07') <> '2026-11-09 00:00:00+07'::timestamptz then v_f := v_f || '"week start monday 00:00 is itself"'::jsonb; end if;
  if public.cf_week_start('2026-11-08 23:59:59+07') <> '2026-11-02 00:00:00+07'::timestamptz then v_f := v_f || '"week start sunday 23:59:59 belongs to previous week"'::jsonb; end if;
  if public.cf_week_start('2026-11-12 10:00:00+07') <> '2026-11-09 00:00:00+07'::timestamptz then v_f := v_f || '"week start thursday"'::jsonb; end if;
  return jsonb_build_object('ok', jsonb_array_length(v_f) = 0, 'failures', v_f);
end $$;
revoke all on function public.cf_phase4_selftest() from public;

-- Dọn quyền lần cuối: người chưa đăng nhập (anon) không đọc/ghi/gọi gì. PostgREST nạp lại schema.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
notify pgrst, 'reload schema';
