-- =====================================================================
-- WAS GIBT'S? – Version 2.3: Ausführliche Kochschritte und Food-Fotos (Pexels)
-- Einmal erzeugte Schritte und Fotos werden für alle gespeichert,
-- damit die KI nicht für jede Familie neu rechnen muss.
-- =====================================================================
create table if not exists public.recipe_cache (
  name        text primary key,          -- Rezeptname (fest eingebaute Rezepte)
  steps       jsonb,                     -- [{ text, minutes, heat }]
  steps_model text,
  photo       jsonb,                     -- { u, a, l, f, q } oder { none:true, q }
  updated_at  timestamptz not null default now()
);
alter table public.recipe_cache enable row level security;
drop policy if exists "rezept-cache lesen" on public.recipe_cache;
create policy "rezept-cache lesen" on public.recipe_cache for select using (auth.uid() is not null);
drop policy if exists "rezept-cache admin" on public.recipe_cache;
create policy "rezept-cache admin" on public.recipe_cache for delete using (public.is_app_admin());
-- Schreiben nur über die Server-Funktion (Service-Rolle)
select 'ok' as fertig;
