// =====================================================================
// WAS GIBT'S? – Server-Funktion: Ausführliche Kochschritte und Food-Fotos
//
// { action:"steps", recipe:{ id, name, ingredients[], optional[], steps[], minutes } }
//    → { steps:[{ text, minutes, heat }] }  (KI schreibt 10–16 genaue Schritte)
// { action:"photo", recipe:{ id, name, ingredients[] } }
//    → { photo:{ u, a, l, f } } oder { photo:null, reason }
//
// Fest eingebaute Rezepte werden in recipe_cache für alle gespeichert.
// Eigene Familienrezepte (id beginnt mit "c_") werden nie gespeichert.
// Secrets: GEMINI_API_KEY (vorhanden), PEXELS_API_KEY (für Fotos, kostenlos bei pexels.com/api)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...CORS, "Content-Type": "application/json" } });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const list = (v: unknown, n: number, m: number) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => clean(x, m)).filter(Boolean);

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

    const body = await req.json().catch(() => ({}));
    const r = body.recipe || {};
    const rec = {
      id: clean(r.id, 60), name: clean(r.name, 80), minutes: Math.max(0, Math.min(600, Number(r.minutes) || 0)),
      ingredients: list(r.ingredients, 20, 40), optional: list(r.optional, 12, 40), steps: list(r.steps, 12, 300),
    };
    if (!rec.name) return json({ error: "empty" });
    const shared = !rec.id.startsWith("c_");

    if (body.action === "steps") {
      if (shared) {
        const { data } = await db.from("recipe_cache").select("steps").eq("name", rec.name).maybeSingle();
        if (data?.steps) return json({ steps: data.steps, cached: true });
      }
      const out = await makeSteps(rec);
      if (!out.steps) return json(out);
      if (shared) await db.from("recipe_cache").upsert({ name: rec.name, steps: out.steps, steps_model: out.model, updated_at: new Date().toISOString() }, { onConflict: "name" });
      return json({ steps: out.steps });
    }

    if (body.action === "photo") {
      if (shared) {
        const { data } = await db.from("recipe_cache").select("photo").eq("name", rec.name).maybeSingle();
        if (data?.photo) return json({ photo: data.photo.none ? null : data.photo, cached: true });
      }
      const pexels = Deno.env.get("PEXELS_API_KEY");
      if (!pexels) return json({ photo: null, reason: "nokey" });
      const out = await findPhoto(rec, pexels);
      if (out.reason === "limit" || out.reason === "failed") return json(out);   // nicht speichern, später nochmal
      if (shared) await db.from("recipe_cache").upsert({ name: rec.name, photo: out.photo ?? { none: true, q: out.q }, updated_at: new Date().toISOString() }, { onConflict: "name" });
      return json({ photo: out.photo });
    }
    return json({ error: "action" });
  } catch (e) {
    return json({ error: "failed", detail: String(e) });
  }
});

// ---------- KI (Gemini, mehrere Modelle wegen der Tageslimits) ----------
async function ask(prompt: string): Promise<{ text?: string; model?: string; error?: string }> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return { error: "nokey" };
  let limited = false;
  for (const model of ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.0-flash", "gemini-2.0-flash-lite"]) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.4 } }),
    });
    if (r.status === 429) { limited = true; continue; }
    if (!r.ok) continue;
    const d = await r.json().catch(() => ({}));
    const text = (d?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    if (text) return { text, model };
  }
  return { error: limited ? "limit" : "failed" };
}

// ---------- Ausführliche Kochschritte ----------
async function makeSteps(rec: { name: string; minutes: number; ingredients: string[]; optional: string[]; steps: string[] }) {
  const prompt =
    `Du bist ein geduldiger Koch und erklärst einem Anfänger ein Rezept Schritt für Schritt auf Deutsch (Du-Form).\n` +
    `Rezept: "${rec.name}" für 4 Personen, insgesamt etwa ${rec.minutes || 30} Minuten.\n` +
    `Hauptzutaten: ${rec.ingredients.join(", ")}.\n` +
    (rec.optional.length ? `Optional: ${rec.optional.join(", ")}.\n` : "") +
    `Grobe Anleitung: ${rec.steps.join(" | ")}\n` +
    `Salz, Pfeffer, Öl, Zucker und Gewürze sind vorhanden.\n\n` +
    `Schreibe 10 bis 16 Schritte. Regeln:\n` +
    `- Schritt 1: Zutaten bereitstellen – nenne, was aus dem Kühlschrank und was aus dem Vorrat kommt.\n` +
    `- Schritt 2: Frische Zutaten kurz prüfen (Haltbarkeitsdatum, Geruch, Aussehen) – nur die, bei denen es sinnvoll ist.\n` +
    `- Danach Vorbereitung: waschen, schälen, schneiden mit Größenangabe (z. B. „in 1 cm große Würfel").\n` +
    `- Gib passende Mengen für 4 Personen an (z. B. „400 g Nudeln", „1 EL Öl").\n` +
    `- Beim Herd immer die Stufe nennen, als Wort UND Zahl auf einer Skala von 1–9 (z. B. „mittlere bis hohe Hitze, Stufe 6–7"). Beim Ofen Temperatur und Ober-/Unterhitze oder Umluft.\n` +
    `- Nenne Garzeiten und woran man erkennt, dass etwas fertig ist (z. B. „goldbraun", „innen nicht mehr rosa").\n` +
    `- Lange Wartezeiten sinnvoll nutzen (z. B. „Während die Nudeln kochen, …").\n` +
    `- Am Ende: abschmecken, Herd/Ofen ausschalten, anrichten.\n` +
    `- Jeder Schritt ist EINE Handlung, höchstens 2 kurze Sätze.\n\n` +
    `Antworte NUR als JSON-Array: [{"text":"…","minutes":Zahl oder null,"heat":"kurze Hitzeangabe wie 'Stufe 7 von 9' oder '200 °C Ober-/Unterhitze'" oder null}]`;
  const res = await ask(prompt);
  if (!res.text) return { error: res.error };
  let arr: unknown[] = [];
  try { const m = res.text.match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; } catch { arr = []; }
  const steps = arr.slice(0, 20).map((s) => {
    const o = (s || {}) as Record<string, unknown>;
    const min = Number(o.minutes);
    return { text: clean(o.text, 300), minutes: min > 0 && min <= 240 ? Math.round(min) : null, heat: o.heat ? clean(o.heat, 40) : null };
  }).filter((s) => s.text.length > 3);
  if (steps.length < 5) return { error: "failed" };
  return { steps, model: res.model };
}

// ---------- Food-Foto über Pexels ----------
async function findPhoto(rec: { name: string; ingredients: string[] }, key: string) {
  // 1) KI macht aus dem deutschen Gericht einen genauen englischen Suchbegriff + Merkmale fürs Prüfen
  const res = await ask(
    `Gericht: "${rec.name}" (Zutaten: ${rec.ingredients.join(", ")}).\n` +
    `Gib einen kurzen englischen Suchbegriff für ein Food-Foto genau dieses fertigen Gerichts (z. B. "scrambled eggs with ham"), ` +
    `außerdem 2–4 englische Wörter, die auf dem Foto zu sehen sein MÜSSEN, und 2–4 Wörter, die NICHT passen würden.\n` +
    `Antworte NUR als JSON: {"query":"…","must":["…"],"avoid":["…"]}`);
  if (!res.text) return { photo: null, reason: res.error };
  let q = { query: "", must: [] as string[], avoid: [] as string[] };
  try { const m = res.text.match(/\{[\s\S]*\}/); q = { ...q, ...(m ? JSON.parse(m[0]) : {}) }; } catch { /* leer */ }
  const query = clean(q.query, 80);
  if (!query) return { photo: null, reason: "failed" };

  // 2) Pexels durchsuchen und das Foto nehmen, dessen Beschreibung am besten passt
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`, { headers: { Authorization: key } });
  if (r.status === 429) return { photo: null, reason: "limit" };
  if (!r.ok) return { photo: null, reason: "failed" };
  const d = await r.json().catch(() => ({}));
  const photos = (d.photos ?? []) as { url: string; alt?: string; photographer?: string; src: { large: string; medium: string } }[];
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["with", "and", "the"].includes(w));
  const must = (q.must || []).map((w) => String(w).toLowerCase());
  const avoid = (q.avoid || []).map((w) => String(w).toLowerCase());
  const scored = photos.map((p, i) => {
    const alt = (p.alt || "").toLowerCase();
    let s = 0;
    words.forEach((w) => { if (alt.includes(w)) s += 2; });
    must.forEach((w) => { if (alt.includes(w)) s += 3; });
    avoid.forEach((w) => { if (alt.includes(w)) s -= 6; });
    if (/\b(person|woman|man|hand|hands|people|cook|chef)\b/.test(alt)) s -= 2;   // lieber das Essen als Menschen
    return { p, s: s - i * 0.15 };
  }).sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best || best.s < 2) return { photo: null, reason: "nomatch", q: query };
  return { photo: { u: best.p.src.medium, big: best.p.src.large, a: clean(best.p.photographer, 60) || "Pexels", l: "Pexels", f: best.p.url, q: query }, q: query };
}
