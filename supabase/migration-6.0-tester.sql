-- =====================================================================
-- WAS GIBT'S? – Version 6.0: Tester-Accounts ohne E-Mail
--
-- Neue Accounts entstehen ab jetzt im Dashboard, nicht mehr über eine
-- Registrierung mit E-Mail. Jeder Tester bekommt einen 4-stelligen Code.
--
-- Zum Code: 4 Ziffern sind nur 10.000 Möglichkeiten. Darum ist der Code
-- KEIN Passwort, sondern ein Einmal-Ticket:
--   * er gilt höchstens 24 Stunden,
--   * er wird beim ersten Einlösen verbraucht,
--   * danach hält das Handy die Anmeldung selbst,
--   * falsche Eingaben werden gezählt und gebremst.
-- Braucht jemand ein neues Gerät, erzeugst du im Dashboard einen neuen
-- Code. Das ist ein Klick.
--
-- Gefahrlos mehrfach ausführbar.
-- =====================================================================

-- ---------- Tester ----------
create table if not exists public.testers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  -- Zufälliger Schlüssel, mit dem die Server-Funktion den Tester anmeldet.
  -- Liest nur der Server (service_role). Durch RLS kommt sonst niemand ran,
  -- und im Dashboard taucht er nirgends auf.
  secret     text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.testers add column if not exists secret text;

-- ---------- Codes ----------
create table if not exists public.tester_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null check (code ~ '^[0-9]{4}$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  claimed_at timestamptz
);

-- Zwei offene Codes dürfen nie gleich sein. Verbrauchte stören nicht.
create unique index if not exists tester_codes_open
  on public.tester_codes (code) where claimed_at is null;
create index if not exists tester_codes_user on public.tester_codes (user_id);

-- ---------- Fehlversuche ----------
create table if not exists public.tester_attempts (
  id   bigserial primary key,
  ip   text,
  code text,
  ok   boolean not null default false,
  at   timestamptz not null default now()
);
create index if not exists tester_attempts_at on public.tester_attempts (at desc);

-- Niemand kommt mit dem öffentlichen Schlüssel an diese Tabellen heran.
-- Das Dashboard geht über die Funktionen unten, das Handy über die
-- Server-Funktion „tester" (die arbeitet mit dem service_role-Schlüssel).
alter table public.testers        enable row level security;
alter table public.tester_codes   enable row level security;
alter table public.tester_attempts enable row level security;

-- ---------- Freier Code ----------
-- Sucht eine 4-stellige Zahl, die gerade nicht offen vergeben ist.
create or replace function public.tester_free_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text; i int := 0;
begin
  loop
    c := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (
      select 1 from tester_codes
       where code = c and claimed_at is null and expires_at > now());
    i := i + 1;
    if i > 500 then raise exception 'Es sind gerade zu viele Codes offen'; end if;
  end loop;
  return c;
end $$;

-- ---------- Liste fürs Dashboard ----------
create or replace function public.admin_testers() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
    select t.user_id, t.note, t.created_at,
           p.name, p.avatar, p.last_seen,
           (coalesce(p.banned, false) and (p.banned_until is null or p.banned_until > now())) as banned,
           f.id as family_id, f.name as family,
           (select c.code from tester_codes c
             where c.user_id = t.user_id and c.claimed_at is null and c.expires_at > now()
             order by c.created_at desc limit 1) as open_code,
           (select c.expires_at from tester_codes c
             where c.user_id = t.user_id and c.claimed_at is null and c.expires_at > now()
             order by c.created_at desc limit 1) as code_until,
           (select max(c.claimed_at) from tester_codes c where c.user_id = t.user_id) as last_claim
      from testers t
      left join profiles p on p.id = t.user_id
      left join memberships m on m.user_id = t.user_id and m.status = 'active'
      left join families f on f.id = m.family_id) x);
end $$;

-- ---------- Neuen Code erzeugen ----------
-- Ältere offene Codes derselben Person werden dabei ungültig.
create or replace function public.admin_tester_code(uid uuid, hours int default 24) returns json
language plpgsql security definer set search_path = public as $$
declare c text; h int := greatest(1, least(coalesce(hours, 24), 720)); until_ts timestamptz;
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  if not exists (select 1 from testers where user_id = uid) then
    raise exception 'Das ist kein Tester-Account';
  end if;

  update tester_codes set expires_at = now()
   where user_id = uid and claimed_at is null and expires_at > now();

  c := public.tester_free_code();
  until_ts := now() + make_interval(hours => h);
  insert into tester_codes (code, user_id, created_by, expires_at)
       values (c, uid, auth.uid(), until_ts);
  return json_build_object('code', c, 'until', until_ts);
end $$;

-- ---------- Name und Bild ändern ----------
create or replace function public.admin_tester_edit(uid uuid, new_name text default null,
                                                    new_avatar text default null, new_note text default null) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  if not exists (select 1 from testers where user_id = uid) then
    raise exception 'Das ist kein Tester-Account';
  end if;
  update profiles set
    name   = coalesce(nullif(trim(new_name), ''), name),
    avatar = coalesce(nullif(trim(new_avatar), ''), avatar)
   where id = uid;
  if new_note is not null then
    update testers set note = nullif(trim(new_note), '') where user_id = uid;
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------- Code zurückziehen ----------
create or replace function public.admin_tester_code_off(uid uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  update tester_codes set expires_at = now()
   where user_id = uid and claimed_at is null and expires_at > now();
  return json_build_object('ok', true);
end $$;

-- ---------- Aufräumen ----------
-- Verbrauchte und abgelaufene Codes nach 30 Tagen weg, Fehlversuche nach 7.
create or replace function public.tester_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from tester_codes
   where (claimed_at is not null and claimed_at < now() - interval '30 days')
      or (claimed_at is null and expires_at < now() - interval '30 days');
  delete from tester_attempts where at < now() - interval '7 days';
$$;

grant execute on function public.admin_testers()            to authenticated;
grant execute on function public.admin_tester_code(uuid,int) to authenticated;
grant execute on function public.admin_tester_edit(uuid,text,text,text) to authenticated;
grant execute on function public.admin_tester_code_off(uuid) to authenticated;
