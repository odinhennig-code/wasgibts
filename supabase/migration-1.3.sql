-- =====================================================================
-- Version 1.3: Abstimmung, eigene Rezepte, Feedback, Ablaufdaten
-- =====================================================================

-- Ablaufdaten im Kühlschrank: { "milch": "2026-10-28", ... }
alter table public.fridges add column if not exists expiries jsonb not null default '{}'::jsonb;

-- Eigene Familienrezepte
create table if not exists public.custom_recipes (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  name        text not null check (char_length(name) between 1 and 60),
  emoji       text not null default '🍽️',
  minutes     int  not null default 30 check (minutes between 1 and 600),
  mood        text not null default 'normal' check (mood in ('gesund','normal','fast')),
  ingredients text[] not null default '{}',
  optional    text[] not null default '{}',
  traits      text[] not null default '{}',
  steps       text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- Abstimmungen "Was essen wir heute?"
create table if not exists public.polls (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  options     text[] not null,
  status      text not null default 'open' check (status in ('open','closed')),
  winner      text,
  created_at  timestamptz not null default now()
);
create table if not exists public.votes (
  poll_id     uuid not null references public.polls(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  recipe_id   text not null,
  created_at  timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- Feedback aus der App (lesbar im Supabase Table Editor)
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  kind        text not null check (kind in ('fehler','idee','lob')),
  message     text not null check (char_length(message) between 1 and 2000),
  app_version text,
  created_at  timestamptz not null default now()
);

alter table public.custom_recipes enable row level security;
alter table public.polls          enable row level security;
alter table public.votes          enable row level security;
alter table public.feedback       enable row level security;

drop policy if exists "rezepte lesen" on public.custom_recipes;
create policy "rezepte lesen"   on public.custom_recipes for select using (public.is_member(family_id));
drop policy if exists "rezepte anlegen" on public.custom_recipes;
create policy "rezepte anlegen" on public.custom_recipes for insert with check (created_by = auth.uid() and public.is_member(family_id));
drop policy if exists "rezepte ändern" on public.custom_recipes;
create policy "rezepte ändern"  on public.custom_recipes for update using (created_by = auth.uid() or public.is_admin(family_id));
drop policy if exists "rezepte löschen" on public.custom_recipes;
create policy "rezepte löschen" on public.custom_recipes for delete using (created_by = auth.uid() or public.is_admin(family_id));

drop policy if exists "abstimmung lesen" on public.polls;
create policy "abstimmung lesen"   on public.polls for select using (public.is_member(family_id));
drop policy if exists "abstimmung starten" on public.polls;
create policy "abstimmung starten" on public.polls for insert with check (created_by = auth.uid() and public.is_member(family_id));
drop policy if exists "abstimmung beenden" on public.polls;
create policy "abstimmung beenden" on public.polls for update using (created_by = auth.uid() or public.is_admin(family_id));

drop policy if exists "stimmen lesen" on public.votes;
create policy "stimmen lesen"   on public.votes for select using (public.is_member(family_id));
drop policy if exists "abstimmen" on public.votes;
create policy "abstimmen"       on public.votes for insert with check (user_id = auth.uid() and public.is_member(family_id));
drop policy if exists "stimme ändern" on public.votes;
create policy "stimme ändern"   on public.votes for update using (user_id = auth.uid());
drop policy if exists "stimme löschen" on public.votes;
create policy "stimme löschen"  on public.votes for delete using (user_id = auth.uid());

drop policy if exists "feedback senden" on public.feedback;
create policy "feedback senden" on public.feedback for insert with check (user_id = auth.uid());
drop policy if exists "eigenes feedback lesen" on public.feedback;
create policy "eigenes feedback lesen" on public.feedback for select using (user_id = auth.uid());

do $$ begin
  begin alter publication supabase_realtime add table public.custom_recipes; exception when others then null; end;
  begin alter publication supabase_realtime add table public.polls;          exception when others then null; end;
  begin alter publication supabase_realtime add table public.votes;          exception when others then null; end;
end $$;
