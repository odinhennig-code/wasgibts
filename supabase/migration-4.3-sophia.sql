-- =========================================================================
-- Was gibt's? – Version 4.3: Sophia-Modus
-- Einmal im Supabase SQL-Editor ausführen.
--
-- Im Dashboard kann man bei einer Person den Sophia-Modus einschalten.
-- Die Liste steht in app_settings (key 'sophia') – schreiben dürfen das
-- nur App-Admins (bestehende Regel „einstellungen admin").
-- Die App fragt nur „Bin ICH dabei?" ab und sieht die Liste selbst nie.
-- =========================================================================

insert into public.app_settings (key, value)
values ('sophia', '{"users": []}'::jsonb)
on conflict (key) do nothing;

create or replace function public.my_sophia()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value -> 'users') ? auth.uid()::text
       from public.app_settings
      where key = 'sophia'),
    false);
$$;

revoke all on function public.my_sophia() from public;
grant execute on function public.my_sophia() to authenticated;
