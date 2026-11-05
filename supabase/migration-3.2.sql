-- Version 3.2: Profil personalisieren (Profilfarbe, Status, Profilbild)
alter table public.profiles add column if not exists color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.profiles add column if not exists status text check (status is null or char_length(status) <= 60);
-- Profilbild liegt als kleines Bild (max. ca. 45 KB) im Feld avatar
alter table public.profiles drop constraint if exists profiles_avatar_len;
alter table public.profiles add constraint profiles_avatar_len check (char_length(avatar) <= 60000);
select 'fertig' as ok;
