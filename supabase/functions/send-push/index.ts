// =====================================================================
// WAS GIBT'S? – Server-Funktion: Push-Nachrichten
// Läuft als Supabase Edge Function.
//
// Aktionen (POST, JSON):
//   { action: "key" }                       → öffentlicher Push-Schlüssel (für jeden angemeldeten Nutzer)
//   { action: "test", title, body }         → nur an die eigenen Geräte (nur App-Admin)
//   { action: "send", title, body, url?, familyId? } → an alle bzw. eine Familie (nur App-Admin)
//
// Der Schlüssel (VAPID) wird beim ersten Aufruf automatisch erzeugt und in der
// geschützten Tabelle app_secrets gespeichert. Niemand muss ihn eintippen.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "auth" });

    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const keys = await vapidKeys(db);
    const body = await req.json().catch(() => ({}));

    if (body.action === "key") return json({ publicKey: keys.publicKey });

    const { data: isAdmin } = await asUser.rpc("is_app_admin");
    if (!isAdmin) return json({ error: "forbidden" });

    const title = String(body.title ?? "").trim().slice(0, 80);
    const text = String(body.body ?? "").trim().slice(0, 240);
    if (!title || !text) return json({ error: "empty" });

    // Empfänger bestimmen
    let q = db.from("push_subs").select("endpoint,p256dh,auth,user_id");
    let target = "alle";
    if (body.action === "test") { q = q.eq("user_id", user.id); target = "test"; }
    else if (body.familyId) {
      const { data: mem } = await db.from("memberships").select("user_id").eq("family_id", body.familyId).eq("status", "active");
      const ids = (mem ?? []).map((m) => m.user_id);
      if (!ids.length) return json({ sent: 0, failed: 0 });
      q = q.in("user_id", ids);
      const { data: fam } = await db.from("families").select("name").eq("id", body.familyId).single();
      target = "Familie " + (fam?.name ?? "?");
    }
    const { data: subs, error } = await q;
    if (error) return json({ error: "failed", detail: error.message });

    webpush.setVapidDetails("mailto:noreply@users.noreply.github.com", keys.publicKey, keys.privateKey);
    const payload = JSON.stringify({ title, body: text, url: body.url || "./" });

    let sent = 0, failed = 0;
    const dead: string[] = [];
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint); // Gerät abgemeldet
      }
    }));
    if (dead.length) await db.from("push_subs").delete().in("endpoint", dead);
    await db.from("push_log").insert({ title, body: text, target, sent, failed });
    return json({ sent, failed, removed: dead.length });
  } catch (e) {
    return json({ error: "failed", detail: String(e) });
  }
});

async function vapidKeys(db: ReturnType<typeof createClient>) {
  const { data } = await db.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private"]);
  const pub = data?.find((r) => r.name === "vapid_public")?.value;
  const priv = data?.find((r) => r.name === "vapid_private")?.value;
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const k = webpush.generateVAPIDKeys();
  await db.from("app_secrets").upsert([
    { name: "vapid_public", value: k.publicKey },
    { name: "vapid_private", value: k.privateKey },
  ], { onConflict: "name", ignoreDuplicates: true });
  // Falls gleichzeitig ein anderer Aufruf schneller war: gespeicherte Schlüssel nehmen
  const { data: again } = await db.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private"]);
  return {
    publicKey: again!.find((r) => r.name === "vapid_public")!.value,
    privateKey: again!.find((r) => r.name === "vapid_private")!.value,
  };
}
