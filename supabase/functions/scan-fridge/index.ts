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

    const { image, mediaType, keys } = await req.json();
    if (!image || !Array.isArray(keys)) return json({ error: "failed", detail: "Bild fehlt" });
    if (image.length > 6_000_000) return json({ error: "failed", detail: "Bild zu groß" });

    const prompt =
      "Das Bild zeigt einen Kühlschrank, Vorräte oder Lebensmittel. Welche dieser Zutaten sind sichtbar? " +
      "Antworte NUR mit einem JSON-Array der passenden Schlüssel aus dieser Liste: " + JSON.stringify(keys) +
      '. Beispiel: ["eier","milch"]. Wenn nichts erkennbar ist: []';
    const mime = mediaType || "image/jpeg";

    const gemini = Deno.env.get("GEMINI_API_KEY");
    const openrouter = Deno.env.get("OPENROUTER_API_KEY");
    if (!gemini && !openrouter) return json({ error: "nokey" });

    let limited = false, lastDetail = "";

    // 1) Gemini – mehrere Modelle der Reihe nach, falls eins nicht verfügbar ist
    if (gemini) {
      const models = [Deno.env.get("GEMINI_MODEL"), "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"].filter(Boolean) as string[];
      for (const model of [...new Set(models)]) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": gemini },
          body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: image } }, { text: prompt }] }] }),
        });
        if (r.status === 429) { limited = true; lastDetail = "Gemini-Limit erreicht"; break; }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { lastDetail = `Gemini ${model}: ${r.status} ${d?.error?.message ?? ""}`; continue; }
        const text = (d?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
        return json({ items: parse(text, keys), via: model });
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
      if (r.ok) return json({ items: parse(d?.choices?.[0]?.message?.content ?? "", keys), via: "openrouter" });
      lastDetail = `OpenRouter: ${r.status} ${d?.error?.message ?? ""}`;
    }

    return json({ error: limited ? "limit" : "failed", detail: lastDetail });
  } catch (e) {
    return json({ error: "failed", detail: String(e) });
  }
});

function parse(text: string, keys: string[]): string[] {
  const m = text.match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try { return (JSON.parse(m[0]) as unknown[]).map(String).filter((k) => keys.includes(k)); } catch { return []; }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, "content-type": "application/json" } });
}
