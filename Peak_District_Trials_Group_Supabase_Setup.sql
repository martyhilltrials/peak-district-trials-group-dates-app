-- Peak District Trials Group Dates
-- Run this complete file once in Supabase: SQL Editor -> New query -> Run.

begin;

create extension if not exists pgcrypto;

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint clubs_name_not_blank check (length(trim(name)) > 0)
);

create unique index if not exists clubs_name_lower_unique
  on public.clubs (lower(name));

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  club_id uuid references public.clubs(id) on delete set null,
  role text not null default 'club',
  approved boolean not null default false,
  access_notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_valid check (role in ('admin', 'club'))
);

create table if not exists public.series (
  id text primary key,
  name text not null,
  colour text not null default '#537894',
  logo text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_name_not_blank check (length(trim(name)) > 0),
  constraint series_colour_valid check (colour ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.app_settings (
  id text primary key default 'main',
  header_logo text not null default '',
  updated_at timestamptz not null default now(),
  constraint app_settings_single_row check (id = 'main')
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  series_id text not null references public.series(id) on update cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  title text not null,
  status text not null default 'approved',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_date_order check (end_date >= start_date),
  constraint events_title_not_blank check (length(trim(title)) > 0),
  constraint events_status_valid check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists events_dates_index on public.events (start_date, end_date);
create index if not exists events_club_index on public.events (club_id);
create index if not exists events_status_index on public.events (status);

alter table public.profiles
  add column if not exists access_notification_sent_at timestamptz;

alter table public.events
  alter column status set default 'approved';

update public.events
set status = 'approved'
where status = 'pending';

insert into public.app_settings (id) values ('main')
on conflict (id) do nothing;

insert into public.series (id, name, colour, sort_order) values
  ('s0',  'FIM TrialGP',             '#1f6fae', 0),
  ('s1',  'FIM TDN',                 '#c0394e', 1),
  ('s2',  'FIM X - Trial',           '#7248a4', 2),
  ('s3',  'FIM X - TDN',             '#327989', 3),
  ('s4',  'European Championship',   '#2f8a60', 4),
  ('s5',  'TrialGB',                 '#df8133', 5),
  ('s6',  'Trial GB Youth',           '#c24770', 6),
  ('s7',  'ACU S3 Parts NTC',         '#1554a3', 7),
  ('s8',  'Normandale Masters',       '#6c7686', 8),
  ('s9',  'ACU Kickstart',            '#bd673c', 9),
  ('s10', 'SSDT',                     '#235b89', 10),
  ('s11', 'ACU Inter Centre',         '#7667a9', 11),
  ('s12', 'ACU British Sidecar',      '#56864b', 12),
  ('s13', 'ACU Trail Bike',           '#a15c65', 13),
  ('s14', 'National Trials',          '#467d86', 14),
  ('s15', 'Others',                   '#808992', 15)
on conflict (id) do nothing;

create or replace function public.is_calendar_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role = 'admin'
      and approved = true
  );
$$;

create or replace function public.current_calendar_club_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select club_id
  from public.profiles
  where user_id = auth.uid()
    and approved = true
  limit 1;
$$;

create or replace function public.set_calendar_timestamps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  if tg_table_name = 'events' then
    new.updated_by = auth.uid();
    if tg_op = 'INSERT' then
      new.created_by = coalesce(new.created_by, auth.uid());
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.publish_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    new.status = 'approved';
  end if;
  return new;
end;
$$;

create or replace function public.create_calendar_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first_admin boolean := lower(coalesce(new.email, '')) = 'martyhilltrials@gmail.com';
  profile_name text := left(regexp_replace(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '[[:space:]]+', ' ', 'g'), 100);
begin
  if new.email is null then
    return new;
  end if;
  insert into public.profiles as existing (user_id, email, display_name, role, approved)
  values (
    new.id,
    lower(new.email),
    profile_name,
    case when is_first_admin then 'admin' else 'club' end,
    is_first_admin
  )
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = case when profile_name <> '' then profile_name else existing.display_name end,
        role = case when is_first_admin then 'admin' else existing.role end,
        approved = case when is_first_admin then true else existing.approved end,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists calendar_profile_from_auth_user on auth.users;
create trigger calendar_profile_from_auth_user
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.create_calendar_profile();

create or replace function public.set_my_calendar_display_name(requested_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_name text := left(regexp_replace(trim(coalesce(requested_name, '')), '[[:space:]]+', ' ', 'g'), 100);
begin
  if length(cleaned_name) < 2 then
    raise exception 'Enter your full name.';
  end if;

  update public.profiles
  set display_name = cleaned_name,
      updated_at = now()
  where user_id = auth.uid();

  if not found then
    raise exception 'No calendar profile was found.';
  end if;

  return cleaned_name;
end;
$$;

create or replace function public.pending_calendar_access_notification()
returns table(request_user_id uuid, request_email text, request_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.email, p.display_name
  from public.profiles as p
  where p.user_id = auth.uid()
    and p.approved = false
    and p.access_notification_sent_at is null
  limit 1;
$$;

create or replace function public.mark_calendar_access_notification_sent()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set access_notification_sent_at = now(),
      updated_at = now()
  where user_id = auth.uid()
    and approved = false;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_calendar_timestamps();

drop trigger if exists series_set_updated_at on public.series;
create trigger series_set_updated_at
before update on public.series
for each row execute function public.set_calendar_timestamps();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_calendar_timestamps();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before insert or update on public.events
for each row execute function public.set_calendar_timestamps();

drop trigger if exists events_auto_publish on public.events;
create trigger events_auto_publish
before insert or update on public.events
for each row execute function public.publish_calendar_event();

insert into public.profiles as existing (user_id, email, display_name, role, approved)
select
  id,
  lower(email),
  left(regexp_replace(trim(coalesce(raw_user_meta_data ->> 'display_name', '')), '[[:space:]]+', ' ', 'g'), 100),
  case when lower(email) = 'martyhilltrials@gmail.com' then 'admin' else 'club' end,
  lower(email) = 'martyhilltrials@gmail.com'
from auth.users
where email is not null
on conflict (user_id) do update
  set email = excluded.email,
      display_name = case when excluded.display_name <> '' then excluded.display_name else existing.display_name end,
      role = case when excluded.email = 'martyhilltrials@gmail.com' then 'admin' else existing.role end,
      approved = case when excluded.email = 'martyhilltrials@gmail.com' then true else existing.approved end,
      updated_at = now();

alter table public.clubs enable row level security;
alter table public.profiles enable row level security;
alter table public.series enable row level security;
alter table public.app_settings enable row level security;
alter table public.events enable row level security;

revoke all on table public.clubs, public.profiles, public.series, public.app_settings, public.events from anon, authenticated;
grant select on table public.clubs, public.series, public.app_settings to anon, authenticated;
grant select (id, start_date, end_date, series_id, club_id, title, status, created_at, updated_at)
  on table public.events to anon, authenticated;
grant select, update on table public.profiles to authenticated;
grant insert, update, delete on table public.clubs, public.series, public.app_settings, public.events to authenticated;
grant execute on function public.is_calendar_admin() to anon, authenticated;
grant execute on function public.current_calendar_club_id() to anon, authenticated;
revoke all on function public.set_my_calendar_display_name(text) from public;
revoke all on function public.pending_calendar_access_notification() from public;
revoke all on function public.mark_calendar_access_notification_sent() from public;
grant execute on function public.set_my_calendar_display_name(text) to authenticated;
grant execute on function public.pending_calendar_access_notification() to authenticated;
grant execute on function public.mark_calendar_access_notification_sent() to authenticated;

drop policy if exists clubs_public_read on public.clubs;
create policy clubs_public_read on public.clubs
for select to anon, authenticated using (true);

drop policy if exists clubs_admin_insert on public.clubs;
create policy clubs_admin_insert on public.clubs
for insert to authenticated with check (public.is_calendar_admin());

drop policy if exists clubs_admin_update on public.clubs;
create policy clubs_admin_update on public.clubs
for update to authenticated
using (public.is_calendar_admin())
with check (public.is_calendar_admin());

drop policy if exists clubs_admin_delete on public.clubs;
create policy clubs_admin_delete on public.clubs
for delete to authenticated using (public.is_calendar_admin());

drop policy if exists profiles_own_or_admin_read on public.profiles;
create policy profiles_own_or_admin_read on public.profiles
for select to authenticated
using (user_id = auth.uid() or public.is_calendar_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (public.is_calendar_admin())
with check (public.is_calendar_admin());

drop policy if exists series_public_read on public.series;
create policy series_public_read on public.series
for select to anon, authenticated using (true);

drop policy if exists series_admin_insert on public.series;
create policy series_admin_insert on public.series
for insert to authenticated with check (public.is_calendar_admin());

drop policy if exists series_admin_update on public.series;
create policy series_admin_update on public.series
for update to authenticated
using (public.is_calendar_admin())
with check (public.is_calendar_admin());

drop policy if exists series_admin_delete on public.series;
create policy series_admin_delete on public.series
for delete to authenticated using (public.is_calendar_admin());

drop policy if exists settings_public_read on public.app_settings;
create policy settings_public_read on public.app_settings
for select to anon, authenticated using (true);

drop policy if exists settings_admin_insert on public.app_settings;
create policy settings_admin_insert on public.app_settings
for insert to authenticated with check (public.is_calendar_admin());

drop policy if exists settings_admin_update on public.app_settings;
create policy settings_admin_update on public.app_settings
for update to authenticated
using (public.is_calendar_admin())
with check (public.is_calendar_admin());

drop policy if exists events_visible_to_public_and_members on public.events;
create policy events_visible_to_public_and_members on public.events
for select to anon, authenticated
using (
  status = 'approved'
  or public.is_calendar_admin()
  or club_id = public.current_calendar_club_id()
);

drop policy if exists events_member_insert on public.events;
create policy events_member_insert on public.events
for insert to authenticated
with check (
  public.is_calendar_admin()
  or (
    club_id = public.current_calendar_club_id()
    and status = 'approved'
    and created_by = auth.uid()
  )
);

drop policy if exists events_member_update on public.events;
create policy events_member_update on public.events
for update to authenticated
using (
  public.is_calendar_admin()
  or club_id = public.current_calendar_club_id()
)
with check (
  public.is_calendar_admin()
  or (
    club_id = public.current_calendar_club_id()
    and status = 'approved'
  )
);

drop policy if exists events_member_delete on public.events;
create policy events_member_delete on public.events
for delete to authenticated
using (
  public.is_calendar_admin()
  or club_id = public.current_calendar_club_id()
);

do $$
begin
  alter publication supabase_realtime add table public.events;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;

-- After running this file:
-- 1. Sign in to the app once with martyhilltrials@gmail.com.
-- 2. Your account becomes the approved administrator automatically.
-- 3. Other club representatives enter their name and email, then appear in Setup for approval.
-- 4. Once their access is approved, their dates publish immediately.
-- 5. Configure RESEND_API_KEY in Vercel for administrator email notifications.
