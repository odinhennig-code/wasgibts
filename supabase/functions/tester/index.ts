// =====================================================================
// WAS GIBT'S? – Server-Funktion: Tester-Accounts (Version 6.0)
// Läuft als Supabase Edge Function. „Verify JWT" muss AUS sein, denn
// beim Einlösen eines Codes ist noch niemand angemeldet. Die Funktion
// prüft selbst, wer was darf.
//
// Aktionen (POST, JSON):
//   { action:"create", name, avatar?, note? }   → nur App-Admin
//        legt einen Account ohne E-Mail an und gibt den ersten Code zurück
//   { action:"login",  code }                   → offen, aber gebremst
//        löst einen 4-stelligen Code gegen eine Anmeldung ein
//
// Warum 4 Ziffern reichen: Der Code ist kein Passwort, sondern ein
// Einmal-Ticket. Er gilt 24 Stunden, wird beim ersten Einlösen
// verbraucht, und nach 5 Fehlversuchen ist für dieses Gerät 15 Minuten
// Schluss. Danach hält das Handy die Anmeldung selbst.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Zufälliger Schlüssel, mit dem der Server den Tester anmeldet. Sieht niemand. */
function newSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "").slice(0, 40) + "aA1!";
}

/** Grob die Gegenstelle, nur um Durchprobieren zu bremsen. */
function clientIp(req: Request): string {
  const f = req.headers.get("x-forwarded-for") || "";
  return (f.split(",")[0] || req.headers.get("cf-connecting-ip") || "?").trim().slice(0, 60);
}

const MAX_TRIES = 5;          // Fehlversuche je Gegenstelle …
const WINDOW_MIN = 15;        // … in diesem Zeitfenster

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    // =================================================================
    // Code einlösen
    // =================================================================
    if (body.action === "login") {
      const code = String(body.code ?? "").replace(/\D/g, "").slice(0, 4);
      const ip = clientIp(req);
      const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

      const { count } = await db.from("tester_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip).eq("ok", false).gte("at", since);
      if ((count ?? 0) >= MAX_TRIES)
        return json({ error: "zu_oft", message: "Zu viele Versuche. Probier es in 15 Minuten nochmal." }, 429);

      const fail = async (msg: string) => {
        await db.from("tester_attempts").insert({ ip, code, ok: false });
        return json({ error: "code", message: msg }, 400);
      };
      if (code.length !== 4) return await fail("Der Code besteht aus 4 Ziffern.");

      const { data: row } = await db.from("tester_codes")
        .select("id,user_id,expires_at")
        .eq("code", code).is("claimed_at", null).gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!row) return await fail("Dieser Code stimmt nicht oder ist abgelaufen.");

      const { data: t } = await db.from("testers").select("secret").eq("user_id", row.user_id).maybeSingle();
      const { data: prof } = await db.from("profiles")
        .select("name,avatar,banned,banned_until").eq("id", row.user_id).maybeSingle();
      if (prof?.banned && (!prof.banned_until || new Date(prof.banned_until) > new Date()))
        return await fail("Dieser Zugang ist gesperrt.");
      if (!t?.secret) return await fail("Zu diesem Code fehlt der Zugang. Melde dich beim Entwickler.");

      const { data: u } = await db.auth.admin.getUserById(row.user_id);
      const email = u?.user?.email;
      if (!email) return await fail("Zu diesem Code fehlt der Zugang. Melde dich beim Entwickler.");

      // Der Server meldet den Tester an und reicht die Sitzung durch.
      const asAnon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: sess, error: sErr } = await asAnon.auth.signInWithPassword({ email, password: t.secret });
      if (sErr || !sess?.session) return await fail("Anmeldung fehlgeschlagen. Melde dich beim Entwickler.");

      // Erst jetzt ist der Code verbraucht.
      await db.from("tester_codes").update({ claimed_at: new Date().toISOString() }).eq("id", row.id);
      await db.from("tester_attempts").insert({ ip, code, ok: true });

      return json({
        ok: true,
        name: prof?.name ?? "Tester",
        avatar: prof?.avatar ?? "🧑",
        access_token: sess.session.access_token,
        refresh_token: sess.session.refresh_token,
      });
    }

    // =================================================================
    // Account anlegen – nur App-Admin
    // =================================================================
    if (body.action === "create") {
      const auth = req.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ")) return json({ error: "forbidden" }, 401);
      const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
      const { data: me } = await asUser.auth.getUser();
      if (!me?.user) return json({ error: "forbidden" }, 401);
      const { data: isAdmin } = await db.from("app_admins").select("user_id").eq("user_id", me.user.id).maybeSingle();
      if (!isAdmin) return json({ error: "forbidden" }, 403);

      const name = clean(body.name, 30) || "Tester";
      const avatar = clean(body.avatar, 8) || "🧑";
      const note = clean(body.note, 120) || null;

      const secret = newSecret();
      const email = `tester.${crypto.randomUUID()}@wasgibts.pages.dev`;
      const { data: made, error: cErr } = await db.auth.admin.createUser({
        email, password: secret, email_confirm: true,
        user_metadata: { name, avatar, tester: true },
      });
      if (cErr || !made?.user) return json({ error: "create", message: cErr?.message ?? "Account konnte nicht angelegt werden" }, 400);
      const uid = made.user.id;

      // Profil gleich anlegen, damit Name und Bild sofort im Dashboard stehen.
      await db.from("profiles").upsert({ id: uid, name, avatar }, { onConflict: "id" });
      await db.from("testers").upsert({ user_id: uid, secret, note, created_by: me.user.id }, { onConflict: "user_id" });

      const { data: code, error: fErr } = await db.rpc("tester_free_code");
      if (fErr || !code) return json({ error: "code", message: "Kein freier Code" }, 400);
      const until = new Date(Date.now() + 24 * 3600_000).toISOString();
      await db.from("tester_codes").insert({ code, user_id: uid, created_by: me.user.id, expires_at: until });

      return json({ ok: true, userId: uid, name, avatar, code, until });
    }

    return json({ error: "unbekannte Aktion" }, 400);
  } catch (e) {
    return json({ error: "server", message: String((e as Error)?.message ?? e) }, 500);
  }
});
