-- =====================================================================
-- WAS GIBT'S? – Version 1.8: Push-Vorlagen, geplante Push-Nachrichten,
-- automatische Benachrichtigungen (Wunsch, Abstimmung, Beitritt)
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
-- =====================================================================

-- Art der gesendeten Nachricht im Protokoll
alter table public.push_log add column if not exists kind text not null default 'manuell';
alter table public.push_log add column if not exists url text;

-- Vorlagen
create table if not exists public.push_templates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 80),
  body       text not null check (char_length(body) between 1 and 240),
  url        text,
  created_at timestamptz not null default now()
);
alter table public.push_templates enable row level security;
drop policy if exists "vorlagen admin" on public.push_templates;
create policy "vorlagen admin" on public.push_templates for all using (public.is_app_admin()) with check (public.is_app_admin());

-- Geplante Nachrichten
create table if not exists public.push_scheduled (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  url        text,
  target     text not null default 'all',
  family_id  uuid references public.families(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  send_at    timestamptz not null,
  status     text not null default 'geplant' check (status in ('geplant','gesendet','abgebrochen','fehler')),
  sent       int not null default 0,
  failed     int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.push_scheduled enable row level security;
drop policy if exists "geplant admin" on public.push_scheduled;
create policy "geplant admin" on public.push_scheduled for all using (public.is_app_admin()) with check (public.is_app_admin());

-- Einstellungen (z. B. welche automatischen Nachrichten an sind)
create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null
);
alter table public.app_settings enable row level security;
drop policy if exists "einstellungen admin" on public.app_settings;
create policy "einstellungen admin" on public.app_settings for all using (public.is_app_admin()) with check (public.is_app_admin());
insert into public.app_settings (key, value)
values ('auto_push', '{"wish":true,"poll":true,"join":true,"accept":true}'::jsonb)
on conflict (key) do nothing;

-- Schutz gegen Push-Spam (nur die Server-Funktion schreibt hier)
create table if not exists public.push_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  type       text not null,
  ref        text not null default '',
  created_at timestamptz not null default now()
);
alter table public.push_events enable row level security;
create index if not exists push_events_lookup on public.push_events (user_id, type, created_at desc);

-- Wie viele Geräte erreicht welche Zielgruppe?
create or replace function public.admin_push_counts() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return json_build_object(
    'all',        (select count(*) from push_subs),
    'active7',    (select count(*) from push_subs s join profiles p on p.id = s.user_id where p.last_seen > now() - interval '7 days'),
    'inactive14', (select count(*) from push_subs s join profiles p on p.id = s.user_id where p.last_seen is null or p.last_seen < now() - interval '14 days'),
    'users',      (select count(distinct user_id) from push_subs),
    'auto_7d',    (select coalesce(sum(sent),0) from push_log where kind = 'auto' and created_at > now() - interval '7 days')
  );
end $$;

-- ---------- Zeitgesteuertes Senden (jede Minute) ----------
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Geheimer Schlüssel nur für den Zeitplaner (wird hier zufällig erzeugt, niemand muss ihn kennen)
insert into public.app_secrets (name, value) values ('cron_secret', gen_random_uuid()::text)
on conflict (name) do nothing;

create or replace function public.run_push_queue() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from push_scheduled where status = 'geplant' and send_at <= now()) then
    perform net.http_post(
      url     := 'https://mqnpwfoauehykqyzchlx.supabase.co/functions/v1/send-push',
      body    := '{"action":"cron"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from app_secrets where name = 'cron_secret'))
    );
  end if;
end $$;
revoke all on function public.run_push_queue() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('wasgibts-push-queue');
exception when others then null; end $$;
select cron.schedule('wasgibts-push-queue', '* * * * *', 'select public.run_push_queue()');
