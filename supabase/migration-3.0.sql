-- =====================================================================
-- WAS GIBT'S? – Version 3.0: Kochverlauf und Bewertungen
-- =====================================================================
create table if not exists public.cook_log (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  recipe_id   text not null,
  recipe_name text check (char_length(recipe_name) <= 80),
  cooked_at   timestamptz not null default now()
);
create index if not exists cook_log_family on public.cook_log (family_id, cooked_at desc);
alter table public.cook_log enable row level security;
drop policy if exists "kochverlauf lesen" on public.cook_log;
create policy "kochverlauf lesen" on public.cook_log for select using (public.is_member(family_id));
drop policy if exists "kochverlauf anlegen" on public.cook_log;
create policy "kochverlauf anlegen" on public.cook_log for insert with check (public.is_member(family_id) and user_id = auth.uid());
drop policy if exists "kochverlauf löschen" on public.cook_log;
create policy "kochverlauf löschen" on public.cook_log for delete using (user_id = auth.uid());

create table if not exists public.ratings (
  log_id     uuid not null references public.cook_log(id) on delete cascade,
  family_id  uuid not null references public.families(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  text not null,
  stars      int not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (log_id, user_id)
);
create index if not exists ratings_family on public.ratings (family_id);
alter table public.ratings enable row level security;
drop policy if exists "bewertung lesen" on public.ratings;
create policy "bewertung lesen" on public.ratings for select using (public.is_member(family_id));
drop policy if exists "bewertung anlegen" on public.ratings;
create policy "bewertung anlegen" on public.ratings for insert with check (public.is_member(family_id) and user_id = auth.uid());
drop policy if exists "bewertung ändern" on public.ratings;
create policy "bewertung ändern" on public.ratings for update using (user_id = auth.uid()) with check (public.is_member(family_id) and user_id = auth.uid());
drop policy if exists "bewertung löschen" on public.ratings;
create policy "bewertung löschen" on public.ratings for delete using (user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.cook_log; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.ratings;  exception when others then null; end $$;
select 'ok' as fertig;
