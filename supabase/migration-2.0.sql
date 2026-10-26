-- =====================================================================
-- WAS GIBT'S? – Version 2.0: Einkaufsliste und Wochenplan
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
-- =====================================================================

-- Gemeinsame Einkaufsliste der Familie
create table if not exists public.shopping_items (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  ing_key    text,                                   -- bekannte Zutat (z. B. 'milch') …
  label      text check (char_length(label) <= 60),  -- … oder freier Text (z. B. 'Spülmittel')
  added_by   uuid references auth.users(id) on delete set null,
  checked    boolean not null default false,
  created_at timestamptz not null default now(),
  check (ing_key is not null or label is not null)
);
create index if not exists shopping_family on public.shopping_items (family_id, checked);
alter table public.shopping_items enable row level security;
drop policy if exists "einkauf lesen" on public.shopping_items;
create policy "einkauf lesen"   on public.shopping_items for select using (public.is_member(family_id));
drop policy if exists "einkauf anlegen" on public.shopping_items;
create policy "einkauf anlegen" on public.shopping_items for insert with check (public.is_member(family_id) and added_by = auth.uid());
drop policy if exists "einkauf ändern" on public.shopping_items;
create policy "einkauf ändern"  on public.shopping_items for update using (public.is_member(family_id));
drop policy if exists "einkauf löschen" on public.shopping_items;
create policy "einkauf löschen" on public.shopping_items for delete using (public.is_member(family_id));

-- Wochenplan: ein Gericht pro Tag und Familie
create table if not exists public.meal_plan (
  family_id  uuid not null references public.families(id) on delete cascade,
  day        date not null,
  recipe_id  text not null,
  set_by     uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (family_id, day)
);
alter table public.meal_plan enable row level security;
drop policy if exists "plan lesen" on public.meal_plan;
create policy "plan lesen"   on public.meal_plan for select using (public.is_member(family_id));
drop policy if exists "plan anlegen" on public.meal_plan;
create policy "plan anlegen" on public.meal_plan for insert with check (public.is_member(family_id));
drop policy if exists "plan ändern" on public.meal_plan;
create policy "plan ändern"  on public.meal_plan for update using (public.is_member(family_id));
drop policy if exists "plan löschen" on public.meal_plan;
create policy "plan löschen" on public.meal_plan for delete using (public.is_member(family_id));

-- Live-Updates für beide Tabellen
do $$ begin alter publication supabase_realtime add table public.shopping_items; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.meal_plan;      exception when others then null; end $$;
select 'ok' as fertig;
