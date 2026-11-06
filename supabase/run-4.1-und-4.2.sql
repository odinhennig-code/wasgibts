-- =====================================================================
-- WAS GIBT'S? – Version 4.1: Admin-Dashboard mit Moderation
-- Zeitlich begrenzte Sperren mit Grund, Moderations-Verlauf,
-- Inhalte löschen, Profile zurücksetzen, Mitglieder entfernen,
-- Detailansichten für Personen und Familien, Aktivitäts-Diagramme.
-- Alle Funktionen prüfen selbst, ob ein App-Admin angemeldet ist.
-- =====================================================================

-- ---------- Sperren mit Grund und Ablaufdatum ----------
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason text check (ban_reason is null or char_length(ban_reason) <= 200);

-- Eine Sperre gilt nur, solange sie nicht abgelaufen ist
create or replace function public.is_member(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where family_id = fam and user_id = auth.uid() and status = 'active')
     and not exists (select 1 from profiles where id = auth.uid() and banned and (banned_until is null or banned_until > now()));
$$;
create or replace function public.is_admin(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where family_id = fam and user_id = auth.uid() and status = 'active' and role = 'admin')
     and not exists (select 1 from profiles where id = auth.uid() and banned and (banned_until is null or banned_until > now()));
$$;

-- Nutzer dürfen Sperre, Ablauf und Grund nicht selbst ändern
create or replace function public.protect_banned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then
    new.banned := old.banned; new.banned_until := old.banned_until; new.ban_reason := old.ban_reason;
  end if;
  return new;
end $$;

-- Abgelaufene Sperren alle 5 Minuten aufheben
create or replace function public.lift_expired_bans() returns void
language sql security definer set search_path = public as $$
  update profiles set banned = false, banned_until = null, ban_reason = null
  where banned and banned_until is not null and banned_until <= now();
$$;
do $$ begin
  perform cron.unschedule('wasgibts-bans');
exception when others then null; end $$;
select cron.schedule('wasgibts-bans', '*/5 * * * *', 'select public.lift_expired_bans()');

-- Eigene Sperre sofort prüfen (die App ruft das beim Start auf)
create or replace function public.my_ban() returns json
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  update profiles set banned = false, banned_until = null, ban_reason = null
   where id = auth.uid() and banned and banned_until is not null and banned_until <= now();
  select banned, banned_until, ban_reason into p from profiles where id = auth.uid();
  return json_build_object('banned', coalesce(p.banned, false), 'until', p.banned_until, 'reason', p.ban_reason);
end $$;

-- Support-Nachrichten (auch von gesperrten Personen) und Werbe-Zählung erlauben
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check check (kind in ('fehler','idee','lob','plus','werbung','support'));

-- ---------- Moderations-Verlauf ----------
create table if not exists public.mod_log (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid default auth.uid() references auth.users(id) on delete set null,
  action     text not null,
  target_user uuid references auth.users(id) on delete set null,
  target_family uuid references public.families(id) on delete set null,
  detail     text,
  created_at timestamptz not null default now()
);
alter table public.mod_log enable row level security;
drop policy if exists "modlog admin" on public.mod_log;
create policy "modlog admin" on public.mod_log for select using (public.is_app_admin());

create or replace function public._mod(act text, u uuid, f uuid, d text) returns void
language sql security definer set search_path = public as $$
  insert into mod_log (admin_id, action, target_user, target_family, detail) values (auth.uid(), act, u, f, d);
$$;
revoke execute on function public._mod(text, uuid, uuid, text) from public, anon, authenticated;

-- ---------- Sperren / Entsperren ----------
create or replace function public.admin_ban(uid uuid, until timestamptz, reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  if uid = auth.uid() then raise exception 'Du kannst dich nicht selbst sperren'; end if;
  update profiles set banned = true, banned_until = until, ban_reason = nullif(left(trim(reason), 200), '') where id = uid;
  delete from push_subs where user_id = uid;
  perform public._mod('ban', uid, null, coalesce(to_char(until at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'), 'dauerhaft') || coalesce(' · ' || nullif(trim(reason), ''), ''));
end $$;

create or replace function public.admin_unban(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  update profiles set banned = false, banned_until = null, ban_reason = null where id = uid;
  perform public._mod('unban', uid, null, null);
end $$;

-- Altes Panel weiter unterstützen
create or replace function public.admin_set_banned(uid uuid, val boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if val then perform public.admin_ban(uid, null, null); else perform public.admin_unban(uid); end if;
end $$;

-- ---------- Profil zurücksetzen ----------
create or replace function public.admin_reset_profile(uid uuid, what text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  if what = 'name'   then update profiles set name = 'Nutzer' where id = uid;
  elsif what = 'avatar' then update profiles set avatar = '🙂' where id = uid;
  elsif what = 'status' then update profiles set status = null where id = uid;
  elsif what = 'all'    then update profiles set name = 'Nutzer', avatar = '🙂', status = null, color = null where id = uid;
  else raise exception 'unbekannt'; end if;
  perform public._mod('reset_' || what, uid, null, null);
end $$;

-- ---------- Inhalte löschen ----------
create or replace function public.admin_delete_content(kind text, cid text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; f uuid; d text;
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  if kind = 'board' then
    delete from board_posts where id = cid::uuid returning user_id, family_id, left(body, 80) into u, f, d;
  elsif kind = 'note' then
    delete from recipe_notes where id = cid::uuid returning user_id, family_id, left(body, 80) into u, f, d;
  elsif kind = 'recipe' then
    delete from custom_recipes where id = cid::uuid returning created_by, family_id, name into u, f, d;
  elsif kind = 'wish' then
    delete from wishes where id = cid::uuid returning user_id, family_id, recipe_id into u, f, d;
  elsif kind = 'poll' then
    delete from polls where id = cid::uuid returning created_by, family_id, 'Abstimmung' into u, f, d;
  elsif kind = 'collection' then
    delete from recipe_collections where id = cid::uuid returning created_by, family_id, name into u, f, d;
  else raise exception 'unbekannt'; end if;
  perform public._mod('delete_' || kind, u, f, d);
end $$;

-- ---------- Mitglied entfernen / Familie löschen ----------
create or replace function public.admin_remove_member(fid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  delete from memberships where family_id = fid and user_id = uid;
  perform public._mod('remove_member', uid, fid, null);
end $$;

create or replace function public.admin_delete_family(fid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  select name into n from families where id = fid;
  perform public._mod('delete_family', null, null, n);
  delete from families where id = fid;
end $$;

create or replace function public.admin_new_code(fid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  loop
    c := upper(substr(md5(random()::text), 1, 6));
    exit when not exists (select 1 from families where code = c);
  end loop;
  update families set code = c where id = fid;
  perform public._mod('new_code', null, fid, null);
  return c;
end $$;

-- ---------- Listen für das Dashboard ----------
create or replace function public.admin_people() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
    select u.id, p.name, p.avatar, p.color, p.status, u.email::text as email, u.created_at, p.last_seen,
           (coalesce(p.banned, false) and (p.banned_until is null or p.banned_until > now())) as banned,
           p.banned_until, p.ban_reason,
           f.id as family_id, f.name as family, m.role,
           (select count(*)::int from push_subs s where s.user_id = u.id) as devices,
           (select count(*)::int from board_posts b where b.user_id = u.id)
         + (select count(*)::int from recipe_notes n where n.user_id = u.id)
         + (select count(*)::int from custom_recipes r where r.created_by = u.id) as posts,
           exists (select 1 from app_admins a where a.user_id = u.id) as is_admin
    from auth.users u
    left join profiles p on p.id = u.id
    left join memberships m on m.user_id = u.id and m.status = 'active'
    left join families f on f.id = m.family_id) x);
end $$;

create or replace function public.admin_person(uid uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return json_build_object(
    'board',   (select coalesce(json_agg(json_build_object('id', id, 'body', body, 'at', created_at) order by created_at desc), '[]') from board_posts where user_id = uid),
    'notes',   (select coalesce(json_agg(json_build_object('id', id, 'body', body, 'recipe', recipe_id, 'at', created_at) order by created_at desc), '[]') from recipe_notes where user_id = uid),
    'recipes', (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'emoji', emoji, 'at', created_at) order by created_at desc), '[]') from custom_recipes where created_by = uid),
    'wishes',  (select coalesce(json_agg(json_build_object('id', id, 'recipe', recipe_id, 'at', created_at) order by created_at desc), '[]') from wishes where user_id = uid),
    'cooked',  (select count(*) from cook_log where user_id = uid),
    'feedback',(select count(*) from feedback where user_id = uid),
    'log',     (select coalesce(json_agg(json_build_object('action', action, 'detail', detail, 'at', created_at) order by created_at desc), '[]') from (select * from mod_log where target_user = uid order by created_at desc limit 20) l)
  );
end $$;

create or replace function public.admin_family(fid uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return json_build_object(
    'members', (select coalesce(json_agg(json_build_object('id', m.user_id, 'name', p.name, 'avatar', p.avatar, 'role', m.role, 'status', m.status, 'last_seen', p.last_seen, 'banned', coalesce(p.banned, false)) order by m.status, m.created_at), '[]')
                from memberships m left join profiles p on p.id = m.user_id where m.family_id = fid),
    'board',   (select coalesce(json_agg(json_build_object('id', b.id, 'body', b.body, 'who', p.name, 'at', b.created_at) order by b.created_at desc), '[]') from board_posts b left join profiles p on p.id = b.user_id where b.family_id = fid),
    'notes',   (select coalesce(json_agg(json_build_object('id', n.id, 'body', n.body, 'who', p.name, 'recipe', n.recipe_id, 'at', n.created_at) order by n.created_at desc), '[]') from recipe_notes n left join profiles p on p.id = n.user_id where n.family_id = fid),
    'recipes', (select coalesce(json_agg(json_build_object('id', r.id, 'name', r.name, 'emoji', r.emoji, 'who', p.name, 'at', r.created_at) order by r.created_at desc), '[]') from custom_recipes r left join profiles p on p.id = r.created_by where r.family_id = fid),
    'cooked',  (select count(*) from cook_log where family_id = fid),
    'plan',    (select count(*) from meal_plan where family_id = fid),
    'shop',    (select count(*) from shopping_items where family_id = fid),
    'polls',   (select count(*) from polls where family_id = fid)
  );
end $$;

-- Aktivität der letzten 14 Tage für die Diagramme
create or replace function public.admin_activity() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return json_build_object(
    'cooked', (select coalesce(json_agg(json_build_object('day', d, 'n', n) order by d), '[]') from (select date_trunc('day', cooked_at at time zone 'Europe/Berlin')::date d, count(*) n from cook_log where cooked_at > now() - interval '14 days' group by 1) s),
    'posts',  (select coalesce(json_agg(json_build_object('day', d, 'n', n) order by d), '[]') from (select date_trunc('day', created_at at time zone 'Europe/Berlin')::date d, count(*) n from board_posts where created_at > now() - interval '14 days' group by 1) s),
    'push',   (select coalesce(json_agg(json_build_object('day', d, 'n', n) order by d), '[]') from (select date_trunc('day', created_at at time zone 'Europe/Berlin')::date d, sum(sent) n from push_log where created_at > now() - interval '14 days' group by 1) s),
    'top',    (select coalesce(json_agg(json_build_object('name', recipe_name, 'n', n) order by n desc), '[]') from (select recipe_name, count(*) n from cook_log where cooked_at > now() - interval '30 days' and recipe_name is not null group by 1 order by 2 desc limit 5) t),
    'modlog', (select coalesce(json_agg(json_build_object('action', l.action, 'detail', l.detail, 'at', l.created_at, 'who', p.name, 'fam', f.name) order by l.created_at desc), '[]')
               from (select * from mod_log order by created_at desc limit 40) l left join profiles p on p.id = l.target_user left join families f on f.id = l.target_family)
  );
end $$;

-- Neueste Beiträge aus allen Familien (zum Durchsehen in der Moderation)
create or replace function public.admin_recent_content() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'kein Zugriff'; end if;
  return (select coalesce(json_agg(x order by x.at desc), '[]') from (
    (select 'board' kind, b.id::text id, b.body, b.user_id uid, p.name who, p.avatar, f.name fam, b.created_at at from board_posts b left join profiles p on p.id = b.user_id left join families f on f.id = b.family_id order by b.created_at desc limit 40)
    union all
    (select 'note', n.id::text, n.body, n.user_id, p.name, p.avatar, f.name, n.created_at from recipe_notes n left join profiles p on p.id = n.user_id left join families f on f.id = n.family_id order by n.created_at desc limit 40)
    union all
    (select 'recipe', r.id::text, r.emoji || ' ' || r.name, r.created_by, p.name, p.avatar, f.name, r.created_at from custom_recipes r left join profiles p on p.id = r.created_by left join families f on f.id = r.family_id order by r.created_at desc limit 40)
  ) x);
end $$;
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
