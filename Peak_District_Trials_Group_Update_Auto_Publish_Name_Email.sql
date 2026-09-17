-- Peak District Trials Group Dates — existing live-app update
-- Run this complete file once in Supabase: SQL Editor -> New query -> Run.
-- It publishes club dates immediately after the representative has access,
-- stores the representative's private name, and enables one-time access-request notifications.

begin;

alter table public.profiles
  add column if not exists access_notification_sent_at timestamptz;

alter table public.events
  alter column status set default 'approved';

update public.events
set status = 'approved'
where status = 'pending';

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

drop trigger if exists events_auto_publish on public.events;
create trigger events_auto_publish
before insert or update on public.events
for each row execute function public.publish_calendar_event();

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

revoke all on function public.set_my_calendar_display_name(text) from public;
revoke all on function public.pending_calendar_access_notification() from public;
revoke all on function public.mark_calendar_access_notification_sent() from public;
grant execute on function public.set_my_calendar_display_name(text) to authenticated;
grant execute on function public.pending_calendar_access_notification() to authenticated;
grant execute on function public.mark_calendar_access_notification_sent() to authenticated;

revoke select on table public.events from anon, authenticated;
grant select (id, start_date, end_date, series_id, club_id, title, status, created_at, updated_at)
  on table public.events to anon, authenticated;

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

notify pgrst, 'reload schema';

commit;
