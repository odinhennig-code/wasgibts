-- =====================================================================
-- WAS GIBT'S? – Datenbank (Supabase / PostgreSQL)
-- Im Supabase-Dashboard unter "SQL Editor" komplett einfügen und ausführen.
-- =====================================================================

-- ---------- Tabellen ----------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  avatar      text not null default '🧑',
  veg         boolean not null default false,
  dislikes    text[] not null default '{}',
  allergies   text[] not null default '{}',
  favs        text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  code        text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('admin','member')),
  status      text not null default 'pending' check (status in ('pending','active')),
  created_at  timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.wishes (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  recipe_id   text not null,
  created_at  timestamptz not null default now(),
  unique (family_id, user_id, recipe_id)
);

create table if not exists public.fridges (
  family_id   uuid primary key references public.families(id) on delete cascade,
  items       text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

-- ---------- Hilfsfunktionen (prüfen Mitgliedschaft ohne Rekursion) ----------

create or replace function public.is_member(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where family_id = fam and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where family_id = fam and user_id = auth.uid() and status = 'active' and role = 'admin');
$$;

-- Darf ich dieses Profil sehen? (gleiche Familie, oder Beitrittsanfrage an meine Familie)
create or replace function public.can_see_profile(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pid = auth.uid() or exists (
    select 1 from memberships mine join memberships other on other.family_id = mine.family_id
    where mine.user_id = auth.uid() and mine.status = 'active' and other.user_id = pid
  );
$$;

-- Familie gründen: legt Familie, Admin-Mitgliedschaft und leeren Kühlschrank an
create or replace function public.create_family(fam_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid; new_code text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  loop
    new_code := 'WG-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from families where code = new_code);
  end loop;
  insert into families (name, code, created_by) values (fam_name, new_code, auth.uid()) returning id into new_id;
  insert into memberships (family_id, user_id, role, status) values (new_id, auth.uid(), 'admin', 'active');
  insert into fridges (family_id) values (new_id);
  return new_id;
end; $$;

-- Familie beitreten: stellt eine Anfrage, die ein Admin annehmen muss
create or replace function public.request_join(join_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select id into fam from families where code = upper(trim(join_code));
  if fam is null then raise exception 'Code nicht gefunden'; end if;
  insert into memberships (family_id, user_id, role, status) values (fam, auth.uid(), 'member', 'pending')
  on conflict (family_id, user_id) do nothing;
  return fam;
end; $$;

-- ---------- Zugriffsregeln (Row Level Security) ----------

alter table public.profiles    enable row level security;
alter table public.families    enable row level security;
alter table public.memberships enable row level security;
alter table public.wishes      enable row level security;
alter table public.fridges     enable row level security;

drop policy if exists "profile lesen" on public.profiles;
create policy "profile lesen"   on public.profiles for select using (public.can_see_profile(id));
drop policy if exists "profil anlegen" on public.profiles;
create policy "profil anlegen"  on public.profiles for insert with check (id = auth.uid());
drop policy if exists "profil ändern" on public.profiles;
create policy "profil ändern"   on public.profiles for update using (id = auth.uid());

drop policy if exists "familie lesen" on public.families;
create policy "familie lesen" on public.families for select using (
  exists (select 1 from public.memberships m where m.family_id = id and m.user_id = auth.uid()));
drop policy if exists "familie umbenennen" on public.families;
create policy "familie umbenennen" on public.families for update using (public.is_admin(id));

drop policy if exists "mitglieder lesen" on public.memberships;
create policy "mitglieder lesen" on public.memberships for select using (user_id = auth.uid() or public.is_member(family_id));
drop policy if exists "anfragen annehmen" on public.memberships;
create policy "anfragen annehmen" on public.memberships for update using (public.is_admin(family_id));
drop policy if exists "austreten oder ablehnen" on public.memberships;
create policy "austreten oder ablehnen" on public.memberships for delete using (user_id = auth.uid() or public.is_admin(family_id));

drop policy if exists "wünsche lesen" on public.wishes;
create policy "wünsche lesen"    on public.wishes for select using (public.is_member(family_id));
drop policy if exists "wünsche anlegen" on public.wishes;
create policy "wünsche anlegen"  on public.wishes for insert with check (user_id = auth.uid() and public.is_member(family_id));
drop policy if exists "wünsche löschen" on public.wishes;
create policy "wünsche löschen"  on public.wishes for delete using (public.is_member(family_id));

drop policy if exists "kühlschrank lesen" on public.fridges;
create policy "kühlschrank lesen"   on public.fridges for select using (public.is_member(family_id));
drop policy if exists "kühlschrank ändern" on public.fridges;
create policy "kühlschrank ändern"  on public.fridges for update using (public.is_member(family_id));

-- ---------- Live-Updates (Realtime) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.memberships; exception when others then null; end;
  begin alter publication supabase_realtime add table public.wishes;      exception when others then null; end;
  begin alter publication supabase_realtime add table public.fridges;     exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles;    exception when others then null; end;
end $$;

-- ---------- Version 1.2: Wählerische Esser ----------
alter table public.profiles add column if not exists picky boolean not null default false;
alter table public.profiles add column if not exists likes text[] not null default '{}';
