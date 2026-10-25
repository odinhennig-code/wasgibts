# Was gibt's?

Ein Essen, das allen schmeckt, aus dem, was da ist.

Familien-App: Jeder hat einen eigenen Account, die Familie verbindet sich per QR-Code, alle können sich Essen wünschen, und die App schlägt Gerichte vor, die zu allen passen und mit dem Kühlschrank-Inhalt gehen.


## Dateien

| Datei | Wofür |
| --- | --- |
| `index.html` | Grundgerüst der App |
| `styles.css` | Aussehen, Animationen, iPhone-Simulator am Computer |
| `app.js` | Die ganze App-Logik |
| `data.js` | Zutaten und die 32 Familienrezepte |
| `config.js` | Verbindung zur Datenbank (2 Werte eintragen) |
| `sw.js`, `manifest.webmanifest`, `icon*` | Installierbar auf dem Handy, offline startbar |
| `supabase/schema.sql` | Datenbank mit Zugriffsregeln |
| `supabase/functions/scan-fridge/` | Server-Funktion für die Foto-Erkennung |


## Einrichtung (alles kostenlos)

### 1. Supabase (Datenbank und Accounts)
1. Auf supabase.com anmelden und ein neues Projekt anlegen (Region: Frankfurt).
2. **SQL Editor** öffnen, den Inhalt von `supabase/schema.sql` einfügen und auf **Run** klicken.
3. **Project Settings → API**: „Project URL" und „anon public key" in `config.js` eintragen.
4. **Authentication → URL Configuration**: Bei „Site URL" die spätere Adresse der App eintragen.

### 2. Foto-Erkennung
1. Unter aistudio.google.com einen kostenlosen Gemini-API-Schlüssel erstellen.
2. In Supabase unter **Edge Functions** eine Funktion `scan-fridge` anlegen und den Code aus `supabase/functions/scan-fridge/index.ts` einfügen.
3. Unter **Edge Functions → Secrets** den Schlüssel als `GEMINI_API_KEY` speichern.

### 3. Veröffentlichen
Den Ordner auf GitHub hochladen und bei Vercel, Netlify oder Cloudflare Pages als statische Seite verbinden. Es gibt keinen Build-Schritt: Die Dateien werden so ausgeliefert, wie sie sind.


## Neue Version veröffentlichen
In `sw.js` die Versionsnummer (`wasgibts-v1` → `wasgibts-v2`) erhöhen, damit installierte Apps das Update laden.


## Später
- Icons gegen Icons8-Icons austauschen (Lizenz: kostenlos nur mit sichtbarem Link zu icons8.com)
- Wochenplan und Einkaufsliste
- Premium mit Zahlungsanbieter
- Impressum und Datenschutzerklärung vor dem öffentlichen Start
