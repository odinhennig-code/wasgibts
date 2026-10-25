-- =====================================================================
-- WAS GIBT'S? – Version 1.6: Admin-Panel, Push-Nachrichten, Ankündigungen
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
-- Danach EINMAL den eigenen Account zum App-Admin machen (siehe ganz unten).
-- =====================================================================

-- ---------- App-Admins (Betreiber der App, nicht Familien-Admins) ----------
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- keine Policies: nur über die Funktion unten lesbar

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- ---------- Profile: zuletzt aktiv + Sperre ----------
alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles add column if not exists banned boolean not null default false;

-- Gesperrte Nutzer verlieren den Zugriff auf alle Familiendaten
create or replace function public.is_member(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where family_id = fam and user_id = auth.uid() and status = 'active')
     and not exists (select 1 from profiles where id = auth.uid() and banned);
$$;
create or replace function public.is_admin(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where family_id = fam and user_id = auth.uid() and status = 'active' and role = 'admin')
     and not exists (select 1 from profiles where id = auth.uid() and banned);
$$;

-- Nutzer dürfen sich nicht selbst entsperren
create or replace function public.protect_banned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.banned is distinct from old.banned and not public.is_app_admin() then
    new.banned := old.banned;
  end if;
  return new;
end $$;
drop trigger if exists protect_banned on public.profiles;
create trigger protect_banned before update on public.profiles
  for each row execute function public.protect_banned();

-- Zuletzt aktiv setzen (ruft die App beim Start auf)
create or replace function public.touch_seen() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
$$;

-- ---------- Push-Abos (ein Eintrag pro Gerät) ----------
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "push eigenes anlegen" on public.push_subs;
create policy "push eigenes anlegen" on public.push_subs for insert with check (user_id = auth.uid());
drop policy if exists "push eigenes ändern" on public.push_subs;
create policy "push eigenes ändern" on public.push_subs for update using (user_id = auth.uid());
drop policy if exists "push eigenes lesen" on public.push_subs;
create policy "push eigenes lesen" on public.push_subs for select using (user_id = auth.uid());
drop policy if exists "push eigenes löschen" on public.push_subs;
create policy "push eigenes löschen" on public.push_subs for delete using (user_id = auth.uid());

-- Schlüssel für Push (erzeugt die Server-Funktion selbst, niemand muss ihn eintippen)
create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
-- keine Policies: nur die Server-Funktion (Service-Rolle) kommt dran

-- Protokoll gesendeter Nachrichten
create table if not exists public.push_log (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  target     text not null default 'alle',
  sent       int not null default 0,
  failed     int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
drop policy if exists "push log admin" on public.push_log;
create policy "push log admin" on public.push_log for select using (public.is_app_admin());

-- ---------- Ankündigungs-Banner ----------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  text       text not null check (char_length(text) between 1 and 200),
  emoji      text not null default '📣',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "ankündigung lesen" on public.announcements;
create policy "ankündigung lesen" on public.announcements for select using (auth.uid() is not null);
drop policy if exists "ankündigung verwalten" on public.announcements;
create policy "ankündigung verwalten" on public.announcements for all using (public.is_app_admin()) with check (public.is_app_admin());

-- ---------- Feedback: Admin liest alles und hakt ab ----------
alter table public.feedback add column if not exists done boolean not null default false;
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check check (kind in ('fehler','idee','lob','plus'));
drop policy if exists "feedback admin lesen" on public.feedback;
create policy "feedback admin lesen" on public.feedback for select using (public.is_app_admin());
drop policy if exists "feedback admin ändern" on public.feedback;
create policy "feedback admin ändern" on public.feedback for update using (public.is_app_admin());
drop policy if exists "feedback admin löschen" on public.feedback;
create policy "feedback admin löschen" on public.feedback for delete using (public.is_app_admin());

-- ---------- Admin-Auswertungen ----------
create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return json_build_object(
    'users',        (select count(*) from auth.users),
    'users_7d',     (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_today', (select count(*) from profiles where last_seen > now() - interval '24 hours'),
    'active_7d',    (select count(*) from profiles where last_seen > now() - interval '7 days'),
    'families',     (select count(*) from families),
    'members',      (select count(*) from memberships where status = 'active'),
    'pending',      (select count(*) from memberships where status = 'pending'),
    'recipes',      (select count(*) from custom_recipes),
    'wishes',       (select count(*) from wishes),
    'polls',        (select count(*) from polls),
    'feedback_open',(select count(*) from feedback where not done),
    'plus',         (select count(*) from feedback where kind = 'plus'),
    'push_devices', (select count(*) from push_subs),
    'banned',       (select count(*) from profiles where banned),
    'signups',      (select coalesce(json_agg(json_build_object('day', d, 'n', n) order by d), '[]'::json) from (
                       select date_trunc('day', created_at)::date d, count(*) n from auth.users
                       where created_at > now() - interval '14 days' group by 1) s)
  );
end $$;

create or replace function public.admin_users() returns table (
  id uuid, name text, avatar text, email text, family text, role text,
  created_at timestamptz, last_seen timestamptz, banned boolean, devices int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return query
    select u.id, p.name, p.avatar, u.email::text, f.name, m.role,
           u.created_at, p.last_seen, coalesce(p.banned, false),
           (select count(*)::int from push_subs s where s.user_id = u.id)
    from auth.users u
    left join profiles p on p.id = u.id
    left join memberships m on m.user_id = u.id and m.status = 'active'
    left join families f on f.id = m.family_id
    order by u.created_at desc;
end $$;

create or replace function public.admin_families() returns table (
  id uuid, name text, code text, created_at timestamptz, members int, pending int, recipes int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return query
    select f.id, f.name, f.code, f.created_at,
      (select count(*)::int from memberships m where m.family_id = f.id and m.status = 'active'),
      (select count(*)::int from memberships m where m.family_id = f.id and m.status = 'pending'),
      (select count(*)::int from custom_recipes r where r.family_id = f.id)
    from families f order by f.created_at desc;
end $$;

create or replace function public.admin_set_banned(uid uuid, val boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  if uid = auth.uid() then raise exception 'Du kannst dich nicht selbst sperren'; end if;
  update profiles set banned = val where id = uid;
  if val then delete from push_subs where user_id = uid; end if;
end $$;

create or replace function public.admin_feedback() returns table (
  id uuid, kind text, message text, app_version text, created_at timestamptz, done boolean, name text, email text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return query
    select fb.id, fb.kind, fb.message, fb.app_version, fb.created_at, fb.done, p.name, u.email::text
    from feedback fb left join profiles p on p.id = fb.user_id left join auth.users u on u.id = fb.user_id
    order by fb.created_at desc limit 300;
end $$;

-- Realtime für Ankündigungen
do $$ begin
  alter publication supabase_realtime add table public.announcements;
exception when others then null; end $$;

-- =====================================================================
-- EINMALIG: eigenen Account zum App-Admin machen (E-Mail anpassen):
--   insert into public.app_admins (user_id)
--   select id from auth.users where email = 'DEINE@EMAIL' on conflict do nothing;
-- =====================================================================
