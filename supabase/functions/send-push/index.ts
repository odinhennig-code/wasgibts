// =====================================================================
// WAS GIBT'S? – Server-Funktion: Push-Nachrichten (Version 1.8)
// Läuft als Supabase Edge Function. „Verify JWT" ist aus, die Funktion
// prüft selbst: angemeldeter Nutzer, App-Admin oder Zeitplaner-Schlüssel.
//
// Aktionen (POST, JSON):
//   { action:"key" }                                  → öffentlicher Push-Schlüssel (angemeldete Nutzer)
//   { action:"event", type, ref?, label? }            → automatische Familien-Nachricht (angemeldete Nutzer)
//        type: wish | poll | join | accept
//   { action:"send"|"test", title, body, url?, target?, familyId?, userId?, sendAt? }  → nur App-Admin
//        target: all | active7 | inactive14 | family | user
//   { action:"cron" } + Header x-cron-secret          → fällige geplante Nachrichten senden
// =====================================================================
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...CORS, "Content-Type": "application/json" } });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const TABS = ["home", "fridge", "recipes", "family", "more"];
const safeUrl = (u: unknown) => { const t = String(u ?? ""); return TABS.includes(t) ? "./?tab=" + t : "./"; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    // ---- Zeitplaner (pg_cron) ----
    if (body.action === "cron") {
      const secret = await getSecret(db, "cron_secret");
      if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" });
      return json(await runQueue(db));
    }

    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "auth" });

    if (body.action === "key") return json({ publicKey: (await vapidKeys(db)).publicKey });
    if (body.action === "event") return json(await familyEvent(db, user.id, body));

    const { data: isAdmin } = await asUser.rpc("is_app_admin");
    if (!isAdmin) return json({ error: "forbidden" });

    const title = clean(body.title, 80), text = clean(body.body, 240), link = safeUrl(body.url);
    if (!title || !text) return json({ error: "empty" });

    if (body.action === "test") {
      const r = await sendToUsers(db, [user.id], { title, body: text, url: link });
      await log(db, title, text, "Test an mich", r, "test", link);
      return json(r);
    }

    const target = ["all", "active7", "inactive14", "family", "user"].includes(body.target) ? body.target : "all";
    if (target === "family" && !body.familyId) return json({ error: "empty" });
    if (target === "user" && !body.userId) return json({ error: "empty" });

    // Später senden?
    if (body.sendAt) {
      const when = new Date(body.sendAt);
      if (isNaN(+when) || +when < Date.now() - 60_000) return json({ error: "time" });
      const { error } = await db.from("push_scheduled").insert({
        title, body: text, url: link, target, family_id: body.familyId || null, user_id: body.userId || null, send_at: when.toISOString(),
      });
      return error ? json({ error: "failed", detail: error.message }) : json({ scheduled: true });
    }

    const { ids, label } = await resolveTarget(db, target, body.familyId, body.userId);
    const r = await sendToUsers(db, ids, { title, body: text, url: link });
    await log(db, title, text, label, r, "manuell", link);
    return json(r);
  } catch (e) {
    return json({ error: "failed", detail: String(e) });
  }
});

// ---------- Empfänger ----------
async function resolveTarget(db: SupabaseClient, target: string, familyId?: string, userId?: string) {
  if (target === "family") {
    const { data: mem } = await db.from("memberships").select("user_id").eq("family_id", familyId).eq("status", "active");
    const { data: fam } = await db.from("families").select("name").eq("id", familyId).maybeSingle();
    return { ids: (mem ?? []).map((m) => m.user_id), label: "Familie " + (fam?.name ?? "?") };
  }
  if (target === "user") {
    const { data: p } = await db.from("profiles").select("name").eq("id", userId).maybeSingle();
    return { ids: [userId!], label: "Person: " + (p?.name ?? "?") };
  }
  if (target === "active7" || target === "inactive14") {
    const since = new Date(Date.now() - (target === "active7" ? 7 : 14) * 864e5).toISOString();
    const { data: subs } = await db.from("push_subs").select("user_id");
    const all = [...new Set((subs ?? []).map((s) => s.user_id))];
    if (!all.length) return { ids: [], label: target === "active7" ? "Aktive (7 Tage)" : "Inaktive (14+ Tage)" };
    const { data: ps } = await db.from("profiles").select("id,last_seen").in("id", all);
    const ids = (ps ?? []).filter((p) => target === "active7" ? (p.last_seen && p.last_seen > since) : (!p.last_seen || p.last_seen < since)).map((p) => p.id);
    return { ids, label: target === "active7" ? "Aktive (7 Tage)" : "Inaktive (14+ Tage)" };
  }
  return { ids: null, label: "alle" };
}

// ---------- Senden ----------
async function sendToUsers(db: SupabaseClient, ids: string[] | null, msg: { title: string; body: string; url: string }) {
  if (ids && !ids.length) return { sent: 0, failed: 0, removed: 0 };
  let q = db.from("push_subs").select("endpoint,p256dh,auth,user_id");
  if (ids) q = q.in("user_id", ids);
  const { data: subs, error } = await q;
  if (error) throw error;
  const keys = await vapidKeys(db);
  webpush.setVapidDetails("mailto:noreply@users.noreply.github.com", keys.publicKey, keys.privateKey);
  const payload = JSON.stringify(msg);
  let sent = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "normal" });
      sent++;
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint); // Gerät hat Benachrichtigungen abgemeldet
    }
  }));
  if (dead.length) await db.from("push_subs").delete().in("endpoint", dead);
  return { sent, failed, removed: dead.length };
}
async function log(db: SupabaseClient, title: string, body: string, target: string, r: { sent: number; failed: number }, kind: string, url: string) {
  await db.from("push_log").insert({ title, body, target, sent: r.sent, failed: r.failed, kind, url });
}

// ---------- Geplante Nachrichten ----------
async function runQueue(db: SupabaseClient) {
  const { data: due } = await db.from("push_scheduled").select("*").eq("status", "geplant").lte("send_at", new Date().toISOString()).limit(20);
  let done = 0;
  for (const p of due ?? []) {
    // zuerst als gesendet markieren, damit nichts doppelt rausgeht
    const { data: claimed } = await db.from("push_scheduled").update({ status: "gesendet" }).eq("id", p.id).eq("status", "geplant").select("id");
    if (!claimed?.length) continue;
    try {
      const { ids, label } = await resolveTarget(db, p.target, p.family_id, p.user_id);
      const r = await sendToUsers(db, ids, { title: p.title, body: p.body, url: p.url || "./" });
      await db.from("push_scheduled").update({ sent: r.sent, failed: r.failed }).eq("id", p.id);
      await log(db, p.title, p.body, label, r, "geplant", p.url || "./");
      done++;
    } catch (_) {
      await db.from("push_scheduled").update({ status: "fehler" }).eq("id", p.id);
    }
  }
  return { done };
}

// ---------- Automatische Familien-Nachrichten ----------
async function familyEvent(db: SupabaseClient, uid: string, b: { type?: string; ref?: string; label?: string }) {
  const type = String(b.type ?? ""), ref = clean(b.ref, 80);
  if (!["wish", "poll", "join", "accept"].includes(type)) return { skipped: "type" };
  const { data: set } = await db.from("app_settings").select("value").eq("key", "auto_push").maybeSingle();
  if (set && set.value && set.value[type] === false) return { skipped: "off" };

  // Spam-Schutz: gleiche Meldung höchstens alle 10 Minuten, höchstens 15 pro Stunde
  const tenMin = new Date(Date.now() - 10 * 6e4).toISOString(), hour = new Date(Date.now() - 36e5).toISOString();
  const { count: same } = await db.from("push_events").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("type", type).eq("ref", ref).gte("created_at", tenMin);
  const { count: many } = await db.from("push_events").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", hour);
  if ((same ?? 0) > 0 || (many ?? 0) >= 15) return { skipped: "limit" };
  await db.from("push_events").insert({ user_id: uid, type, ref });

  const { data: me } = await db.from("profiles").select("name,banned").eq("id", uid).maybeSingle();
  if (!me || me.banned) return { skipped: "user" };
  const { data: mine } = await db.from("memberships").select("family_id,status,role").eq("user_id", uid).limit(1).maybeSingle();
  if (!mine) return { skipped: "family" };
  const { data: fam } = await db.from("families").select("name").eq("id", mine.family_id).maybeSingle();
  const { data: mem } = await db.from("memberships").select("user_id,role,status").eq("family_id", mine.family_id);
  const others = (mem ?? []).filter((m) => m.status === "active" && m.user_id !== uid);

  let ids: string[] = [], msg = { title: "", body: "", url: "./" };
  if (type === "wish" && mine.status === "active") {
    const dish = await dishName(db, ref, mine.family_id, clean(b.label, 60));
    ids = others.map((m) => m.user_id);
    msg = { title: "🙋 Neuer Essenswunsch", body: `${me.name} wünscht sich ${dish}`, url: "./?tab=recipes" };
  } else if (type === "poll" && mine.status === "active") {
    ids = others.map((m) => m.user_id);
    msg = { title: "🗳️ Abstimmung gestartet", body: `${me.name} fragt: Was essen wir heute? Stimm jetzt ab.`, url: "./?tab=home" };
  } else if (type === "join" && mine.status === "pending") {
    ids = others.filter((m) => m.role === "admin").map((m) => m.user_id);
    msg = { title: "👋 Beitrittsanfrage", body: `${me.name} möchte der Familie ${fam?.name ?? ""} beitreten`, url: "./?tab=family" };
  } else if (type === "accept" && mine.status === "active" && mine.role === "admin") {
    const target = (mem ?? []).find((m) => m.user_id === ref && m.status === "active");
    if (target) ids = [ref];
    msg = { title: "🎉 Willkommen!", body: `Du bist jetzt in der Familie ${fam?.name ?? ""}`, url: "./?tab=home" };
  }
  if (!ids.length) return { sent: 0 };
  const r = await sendToUsers(db, ids, msg);
  if (r.sent || r.failed) await log(db, msg.title, msg.body, "Familie " + (fam?.name ?? "?"), r, "auto", msg.url);
  return r;
}
async function dishName(db: SupabaseClient, ref: string, familyId: string, label: string) {
  if (ref.startsWith("c_")) {
    const { data } = await db.from("custom_recipes").select("name").eq("id", ref.slice(2)).eq("family_id", familyId).maybeSingle();
    if (data?.name) return data.name;
  }
  return label || "ein Gericht";
}

// ---------- Schlüssel ----------
async function getSecret(db: SupabaseClient, name: string) {
  const { data } = await db.from("app_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value as string | undefined;
}
async function vapidKeys(db: SupabaseClient) {
  const { data } = await db.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private"]);
  const pub = data?.find((r) => r.name === "vapid_public")?.value;
  const priv = data?.find((r) => r.name === "vapid_private")?.value;
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const k = webpush.generateVAPIDKeys();
  await db.from("app_secrets").upsert([
    { name: "vapid_public", value: k.publicKey },
    { name: "vapid_private", value: k.privateKey },
  ], { onConflict: "name", ignoreDuplicates: true });
  const { data: again } = await db.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private"]);
  return {
    publicKey: again!.find((r) => r.name === "vapid_public")!.value,
    privateKey: again!.find((r) => r.name === "vapid_private")!.value,
  };
}
