-- =====================================================================
-- WAS GIBT'S? – Version 4.2: Hilfe & Support
-- Live-Chat, Anfragen (Tickets), Notfall, Plus-Vorrang, Inhalte melden,
-- Status-Seite und Bewertung. Gesperrte Personen dürfen den Support
-- weiter erreichen.
-- =====================================================================

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category    text not null check (category in ('chat','konto','familie','fehler','abo','datenschutz','sonstiges','sperre','notfall','melden')),
  priority    text not null default 'normal' check (priority in ('normal','plus','notfall')),
  subject     text not null check (char_length(subject) between 1 and 120),
  status      text not null default 'offen' check (status in ('offen','in_arbeit','geloest')),
  last_from   text not null default 'user' check (last_from in ('user','support')),
  user_unread boolean not null default false,
  rating      int check (rating in (-1, 1)),
  report_kind text, report_id text, report_text text check (report_text is null or char_length(report_text) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists support_tickets_user on public.support_tickets (user_id, updated_at desc);
alter table public.support_tickets enable row level security;
drop policy if exists "tickets eigene lesen" on public.support_tickets;
create policy "tickets eigene lesen" on public.support_tickets for select using (user_id = auth.uid() or public.is_app_admin());
drop policy if exists "tickets admin ändern" on public.support_tickets;
create policy "tickets admin ändern" on public.support_tickets for update using (public.is_app_admin()) with check (public.is_app_admin());
drop policy if exists "tickets admin löschen" on public.support_tickets;
create policy "tickets admin löschen" on public.support_tickets for delete using (public.is_app_admin());

create table if not exists public.support_messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.support_tickets(id) on delete cascade,
  sender       uuid default auth.uid() references auth.users(id) on delete set null,
  from_support boolean not null default false,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index if not exists support_messages_ticket on public.support_messages (ticket_id, created_at);
alter table public.support_messages enable row level security;
drop policy if exists "nachrichten lesen" on public.support_messages;
create policy "nachrichten lesen" on public.support_messages for select using (
  public.is_app_admin() or exists (select 1 from support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));
drop policy if exists "nachrichten schreiben" on public.support_messages;
create policy "nachrichten schreiben" on public.support_messages for insert with check (
  (from_support and public.is_app_admin())
  or (not from_support and exists (select 1 from support_tickets t where t.id = ticket_id and t.user_id = auth.uid())));

-- Neue Nachricht: Ticket aktualisieren
create or replace function public.support_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update support_tickets set updated_at = now(),
    last_from = case when new.from_support then 'support' else 'user' end,
    user_unread = new.from_support,
    status = case when new.from_support and status = 'offen' then 'in_arbeit'
                  when not new.from_support and status = 'geloest' then 'offen' else status end
  where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists support_on_message on public.support_messages;
create trigger support_on_message after insert on public.support_messages for each row execute function public.support_on_message();

-- Anfrage eröffnen (Priorität legt der Server fest)
create or replace function public.support_open(cat text, subj text, body text, plus boolean default false,
  rkind text default null, rid text default null, rtext text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; n int;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  select count(*) into n from support_tickets where user_id = auth.uid() and status <> 'geloest';
  if n >= 6 then raise exception 'Du hast schon mehrere offene Anfragen – bitte warte kurz auf eine Antwort.'; end if;
  select count(*) into n from support_tickets where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if n >= 4 then raise exception 'Zu viele Anfragen in kurzer Zeit – bitte versuch es später nochmal.'; end if;
  insert into support_tickets (user_id, category, priority, subject, report_kind, report_id, report_text)
  values (auth.uid(), cat, case when cat = 'notfall' then 'notfall' when plus then 'plus' else 'normal' end,
          left(coalesce(nullif(trim(subj), ''), 'Anfrage'), 120), rkind, rid, left(rtext, 300))
  returning id into tid;
  insert into support_messages (ticket_id, sender, from_support, body) values (tid, auth.uid(), false, left(body, 2000));
  return tid;
end $$;

create or replace function public.support_seen(tid uuid) returns void
language sql security definer set search_path = public as $$
  update support_tickets set user_unread = false where id = tid and user_id = auth.uid();
$$;
create or replace function public.support_rate(tid uuid, val int) returns void
language sql security definer set search_path = public as $$
  update support_tickets set rating = case when val > 0 then 1 else -1 end where id = tid and user_id = auth.uid() and status = 'geloest';
$$;
create or replace function public.support_close(tid uuid) returns void
language sql security definer set search_path = public as $$
  update support_tickets set status = 'geloest' where id = tid and user_id = auth.uid();
$$;

-- Liste für das Dashboard
create or replace function public.admin_tickets() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return (select coalesce(json_agg(x order by x.ord, x.updated_at desc), '[]') from (
    select t.*, p.name, p.avatar, p.color, u.email::text as email,
      (coalesce(p.banned, false) and (p.banned_until is null or p.banned_until > now())) as banned,
      (select body from support_messages m where m.ticket_id = t.id order by created_at desc limit 1) as last_body,
      (select count(*)::int from support_messages m where m.ticket_id = t.id) as n,
      case when t.status = 'geloest' then 9 when t.priority = 'notfall' then 0 when t.priority = 'plus' then 1 else 2 end as ord
    from support_tickets t left join profiles p on p.id = t.user_id left join auth.users u on u.id = t.user_id
    order by t.updated_at desc limit 300) x);
end $$;

-- Status-Seite und Support-Einstellungen für alle lesbar
drop policy if exists "status lesen" on public.app_settings;
create policy "status lesen" on public.app_settings for select using (key in ('status', 'support'));
insert into public.app_settings (key, value) values
  ('status',  '{"state":"ok","text":""}'::jsonb),
  ('support', '{"reply":"Wir antworten meistens innerhalb von 24 Stunden.","plus":"Plus-Mitglieder bekommen bevorzugt eine Antwort."}'::jsonb)
on conflict (key) do nothing;

-- Live-Updates
do $$ begin
  begin alter publication supabase_realtime add table public.support_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.support_tickets; exception when others then null; end;
end $$;
