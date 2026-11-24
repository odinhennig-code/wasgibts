// =====================================================================
// WAS GIBT'S? – Server-Funktion: Kühlschrank-Foto erkennen
// Läuft als Supabase Edge Function. Die KI-Schlüssel bleiben auf dem Server.
//
// Schlüssel (Secrets in Supabase):
//   GEMINI_API_KEY      – Google Gemini, kostenloser Bereich mit Tageslimit (Hauptweg)
//   OPENROUTER_API_KEY  – optional: kostenlose OpenRouter-Modelle als Ersatz
//   OPENROUTER_MODEL    – optional: anderes Ersatz-Modell
//
// Antwortet immer mit Status 200 und entweder { items: [...] } oder { error: "<code>" }.
//   error: "limit"   → Tageslimit aufgebraucht, App zeigt eine Pause-Meldung
//   error: "nokey"   → kein Schlüssel eingerichtet
//   error: "auth"    → nicht angemeldet
//   error: "failed"  → KI hat nicht geantwortet (detail enthält den Grund)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Nur angemeldete Nutzer dürfen die KI benutzen
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "auth" });

    const { image, mediaType, keys, mode, today, hints } = await req.json();
    const expiry = mode === "expiry";
    const bon = mode === "bon";
    if (!image || !Array.isArray(keys)) return json({ error: "failed", detail: "Bild fehlt" });
    if (image.length > 6_000_000) return json({ error: "failed", detail: "Bild zu groß" });

    // Aus früheren Korrekturen gelernt: was die KI hier schon mal falsch hatte.
    let gelernt = "";
    if (hints && typeof hints === "object") {
      const falsch = Array.isArray(hints.falsch) ? hints.falsch.slice(0, 12).map(String) : [];
      const uebersehen = Array.isArray(hints.uebersehen) ? hints.uebersehen.slice(0, 12).map(String) : [];
      if (falsch.length) gelernt += " In diesem Haushalt wurden folgende Schlüssel in der Vergangenheit fälschlich erkannt – sei dabei besonders streng und nimm sie nur bei eindeutiger Sicht auf: " + JSON.stringify(falsch) + ".";
      if (uebersehen.length) gelernt += " Folgende Schlüssel wurden in der Vergangenheit übersehen – achte besonders auf sie: " + JSON.stringify(uebersehen) + ".";
    }

    const bonPrompt =
      "Das Foto zeigt einen Kassenbon aus einem Supermarkt. Antworte auf Deutsch und NUR mit einem JSON-Objekt, ohne Text davor oder danach.\n" +
      "1) \"szene\": \"bon\" wenn wirklich ein Kassenbon, eine Rechnung oder ein Lieferschein zu sehen ist, sonst \"anderes\".\n" +
      "2) Bei \"anderes\": beschreibe in einem kurzen deutschen Satz, was tats\u00e4chlich zu sehen ist, und lass die Listen leer.\n" +
      "3) Lies die gekauften Artikel. Auf Bons stehen Abk\u00fcrzungen und Markennamen \u2013 \u00fcbersetze sie in das Lebensmittel " +
      "(z. B. \"H-MILCH 3,5%\" = Milch, \"SCHW NACKEN\" = Schweinefleisch, \"TOM.MARK\" = Tomatenmark, \"GOUDA JUNG\" = K\u00e4se).\n" +
      "4) Ordne jedem Artikel EINEN Schl\u00fcssel aus der Liste zu. Passt keiner, setze \"schluessel\" auf null.\n" +
      "5) Nicht-Lebensmittel (Pfand, T\u00fcte, Sp\u00fclmittel, Zahnpasta, Rabatt, Summe, MwSt) l\u00e4sst du ganz weg.\n" +
      "6) \"menge\": nur wenn auf dem Bon eine Menge steht (z. B. \"500 g\", \"1,5 l\", \"6 Stk\"). Einheit genau eine von " +
      "\"g\", \"ml\", \"St\u00fcck\", \"Pck.\" \u2013 Kilo und Liter rechnest du um. Sonst null.\n" +
      "Erlaubte Schl\u00fcssel: " + JSON.stringify(keys) + "\n" +
      "Form: {\"szene\":\"bon|anderes\",\"beschreibung\":\"\u2026\" oder null,\"laden\":\"Name des Marktes\" oder null," +
      "\"artikel\":[{\"text\":\"H-MILCH 3,5%\",\"schluessel\":\"milch\",\"menge\":{\"n\":1000,\"e\":\"ml\"} oder null}]}";

    const prompt = bon ? bonPrompt : expiry ?
      "Das Foto zeigt eine Lebensmittel-Verpackung, meistens mit Mindesthaltbarkeitsdatum (MHD, 'mindestens haltbar bis', 'zu verbrauchen bis', 'best before', EXP). " +
      "Heute ist " + String(today || new Date().toISOString().slice(0, 10)) + ". " +
      "1) Lies das Haltbarkeitsdatum. Formate wie 12.11.26, 12/11/2026, 12.11. oder nur Monat/Jahr (11/2026 = letzter Tag des Monats) sind möglich. Fehlt das Jahr, nimm das nächste passende Datum ab heute. " +
      "2) Erkenne das Produkt und ordne es EINEM Schlüssel aus dieser Liste zu, falls passend: " + JSON.stringify(keys) + ". " +
      "Antworte NUR mit JSON in genau dieser Form: {\"date\":\"JJJJ-MM-TT\" oder null, \"product\":\"schlüssel\" oder null, \"label\":\"kurzer Produktname auf Deutsch\" oder null, \"raw\":\"das Datum genau so, wie es auf der Packung steht\" oder null}"
      :
      "Du schaust auf ein Foto und sollst Lebensmittel erkennen. Antworte auf Deutsch und NUR mit einem JSON-Objekt, ohne Text davor oder danach.\n" +
      "1) Entscheide zuerst, was das Bild zeigt:\n" +
      "   \"kuehlschrank\" = ein Kühlschrank, ein Fach daraus oder ein Vorratsschrank\n" +
      "   \"lebensmittel\" = Lebensmittel, aber kein Kühlschrank (Tisch, Einkauf, Teller, Verpackungen)\n" +
      "   \"anderes\"      = irgendetwas anderes (Person, Zimmer, Bildschirm, Tier, Landschaft …)\n" +
      "2) Bei \"anderes\": beschreibe in einem kurzen deutschen Satz, was tatsächlich zu sehen ist, und lass die Listen leer.\n" +
      "3) \"sicher\": nur Schlüssel, die du wirklich eindeutig siehst.\n" +
      "4) \"unsicher\": alles, bei dem du dir nicht sicher bist – mit Ortsangabe im Bild (z. B. \"oben links\", \"mittleres Fach\", \"in der Tür\") " +
      "und was es sein könnte. Nenne dort, wenn möglich, auch den passenden Schlüssel. Lieber hier eintragen als raten.\n" +
      "Erlaubte Schlüssel: " + JSON.stringify(keys) + "\n" +
      "Form: {\"szene\":\"kuehlschrank|lebensmittel|anderes\",\"beschreibung\":\"…\" oder null," +
      "\"sicher\":[\"eier\",\"milch\"],\"unsicher\":[{\"wo\":\"oben links\",\"was\":\"könnte Joghurt oder Quark sein\",\"schluessel\":\"joghurt\" oder null}]}" +
      gelernt;
    const mime = mediaType || "image/jpeg";

    const gemini = Deno.env.get("GEMINI_API_KEY");
    const openrouter = Deno.env.get("OPENROUTER_API_KEY");
    if (!gemini && !openrouter) return json({ error: "nokey" });

    let limited = false, lastDetail = "";

    // 1) Gemini – mehrere Modelle der Reihe nach, falls eins nicht verfügbar ist
    if (gemini) {
      // Jedes Modell hat im kostenlosen Bereich ein EIGENES Tageslimit – deshalb bei 429 das nächste probieren
      const models = [Deno.env.get("GEMINI_MODEL"), "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.0-flash", "gemini-2.0-flash-lite"].filter(Boolean) as string[];
      for (const model of [...new Set(models)]) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": gemini },
          body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: image } }, { text: prompt }] }] }),
        });
        if (r.status === 429) { limited = true; lastDetail = `Gemini ${model}: Limit erreicht`; continue; }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { lastDetail = `Gemini ${model}: ${r.status} ${d?.error?.message ?? ""}`; continue; }
        const text = (d?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
        if (!text){ lastDetail = `Gemini ${model}: leere Antwort ${d?.promptFeedback?.blockReason ?? ""}`; continue; }
        return json(bon ? parseBon(text, keys) : expiry ? parseExpiry(text, keys) : { ...parse(text, keys), via: model });
      }
    }

    // 2) Ersatz: kostenloses OpenRouter-Modell
    if (openrouter) {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${openrouter}` },
        body: JSON.stringify({
          model: Deno.env.get("OPENROUTER_MODEL") ?? "google/gemma-3-27b-it:free",
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${image}` } },
          ] }],
        }),
      });
      if (r.status === 429) limited = true;
      const d = await r.json().catch(() => ({}));
      if (r.ok){ const t = d?.choices?.[0]?.message?.content ?? ""; return json(bon ? parseBon(t, keys) : expiry ? parseExpiry(t, keys) : { ...parse(t, keys), via: "openrouter" }); }
      lastDetail = `OpenRouter: ${r.status} ${d?.error?.message ?? ""}`;
    }

    return json({ error: limited ? "limit" : "failed", detail: lastDetail });
  } catch (e) {
    return json({ error: "failed", detail: String(e) });
  }
});

/** Liest die Antwort der KI. Versteht das neue Objekt und das alte reine Array. */
function parse(text: string, keys: string[]) {
  const leer = { items: [] as string[], szene: "kuehlschrank", beschreibung: null as string | null, unsicher: [] as unknown[] };
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      const o = JSON.parse(obj[0]) as Record<string, unknown>;
      const szene = ["kuehlschrank", "lebensmittel", "anderes"].includes(String(o.szene)) ? String(o.szene) : "kuehlschrank";
      const items = Array.isArray(o.sicher) ? o.sicher.map(String).filter((k) => keys.includes(k)) : [];
      const unsicher = (Array.isArray(o.unsicher) ? o.unsicher : []).slice(0, 6).map((u) => {
        const x = (u ?? {}) as Record<string, unknown>;
        const s = typeof x.schluessel === "string" && keys.includes(x.schluessel) ? x.schluessel : null;
        return { wo: String(x.wo ?? "").slice(0, 40), was: String(x.was ?? "").slice(0, 90), schluessel: s };
      }).filter((u) => u.was);
      const beschreibung = typeof o.beschreibung === "string" && o.beschreibung.trim()
        ? o.beschreibung.trim().slice(0, 200) : null;
      return { items, szene, beschreibung, unsicher };
    } catch { /* fällt unten auf das Array zurück */ }
  }
  const arr = text.match(/\[[\s\S]*?\]/);
  if (!arr) return leer;
  try { return { ...leer, items: (JSON.parse(arr[0]) as unknown[]).map(String).filter((k) => keys.includes(k)) }; }
  catch { return leer; }
}

/** Liest den Kassenbon: Artikelzeilen mit Schl\u00fcssel und, wenn angegeben, Menge. */
const BON_EINHEITEN = ["g", "ml", "St\u00fcck", "Pck."];
function parseBon(text: string, keys: string[]) {
  const leer = { bon: { szene: "anderes", beschreibung: null as string | null, laden: null as string | null, artikel: [] as unknown[] } };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return leer;
  let o: Record<string, unknown>;
  try { o = JSON.parse(m[0]) as Record<string, unknown>; } catch { return leer; }
  const szene = String(o.szene) === "bon" ? "bon" : "anderes";
  const artikel = (Array.isArray(o.artikel) ? o.artikel : []).slice(0, 60).map((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    const s = typeof x.schluessel === "string" && keys.includes(x.schluessel) ? x.schluessel : null;
    const mg = (x.menge ?? null) as Record<string, unknown> | null;
    const n = mg && Number(mg.n);
    const e = mg && typeof mg.e === "string" && BON_EINHEITEN.includes(mg.e) ? mg.e : null;
    return { text: String(x.text ?? "").slice(0, 60), schluessel: s,
             menge: n && isFinite(n) && n > 0 && e ? { n: Math.round(n * 10) / 10, e } : null };
  }).filter((a) => a.text || a.schluessel);
  const beschreibung = typeof o.beschreibung === "string" && o.beschreibung.trim() ? o.beschreibung.trim().slice(0, 200) : null;
  const laden = typeof o.laden === "string" && o.laden.trim() ? o.laden.trim().slice(0, 40) : null;
  return { bon: { szene, beschreibung, laden, artikel: szene === "bon" ? artikel : [] } };
}

function parseExpiry(text: string, keys: string[]) {
  const m = text.match(/\{[\s\S]*\}/);
  let o: Record<string, unknown> = {};
  try { o = m ? JSON.parse(m[0]) : {}; } catch { o = {}; }
  const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !isNaN(Date.parse(o.date)) ? o.date : null;
  const product = typeof o.product === "string" && keys.includes(o.product) ? o.product : null;
  const label = typeof o.label === "string" ? o.label.slice(0, 40) : null;
  const raw = typeof o.raw === "string" ? o.raw.slice(0, 40) : null;
  return { expiry: { date, product, label, raw } };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, "content-type": "application/json" } });
}
