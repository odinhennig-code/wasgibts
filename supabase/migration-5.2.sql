-- =====================================================================
-- WAS GIBT'S? – Update 5.2
--
-- Einmal im Supabase-SQL-Editor ausführen. Gefahrlos mehrfach möglich.
--
-- Was dazukommt:
--   fridges.amounts – wie viel von einer Zutat da ist. Freiwillig:
--                     {"hackfleisch":{"n":500,"e":"g"},"eier":{"n":6,"e":"Stück"}}
--                     Wer nichts einträgt, hat weiter nur „da / nicht da".
--
-- Alles andere im Update 5.2 (Geschmack lernen, Vorrat abziehen,
-- Einkaufsliste, Kassenbon, Kühlschrank-Scan) braucht keine Änderung
-- an der Datenbank.
-- =====================================================================

alter table public.fridges
  add column if not exists amounts jsonb not null default '{}'::jsonb;
