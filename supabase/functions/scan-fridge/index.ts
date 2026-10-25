// =====================================================================
// WAS GIBT'S? – Server-Funktion: Kühlschrank-Foto erkennen
// Läuft als Supabase Edge Function. Der KI-Schlüssel bleibt auf dem Server.
//
// Schlüssel setzen (einer reicht):
//   GEMINI_API_KEY     – Google Gemini (hat einen kostenlosen Einstieg)
//   ANTHROPIC_API_KEY  – Claude (kostenpflichtig, sehr zuverlässig)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Nur angemeldete Nutzer dürfen die (kostenpflichtige) KI benutzen
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Nicht angemeldet" }, 401);

    const { image, mediaType, keys } = await req.json();
    if (!image || !Array.isArray(keys)) return json({ error: "Bild fehlt" }, 400);
    if (image.length > 6_000_000) return json({ error: "Bild zu groß" }, 413);

    const prompt =
      "Das Bild zeigt einen Kühlschrank oder Vorräte. Welche dieser Zutaten sind sichtbar? " +
      "Antworte NUR mit einem JSON-Array der passenden Schlüssel aus dieser Liste: " + JSON.stringify(keys) +
      '. Beispiel: ["eier","milch"]. Wenn nichts erkennbar ist: []';

    let text = "";
    const gemini = Deno.env.get("GEMINI_API_KEY");
    const claude = Deno.env.get("ANTHROPIC_API_KEY");

    if (claude) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": claude, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5",
          max_tokens: 400,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: prompt },
          ] }],
        }),
      });
      const d = await r.json();
      text = d?.content?.[0]?.text ?? "";
    } else if (gemini) {
      const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemini}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [
          { inline_data: { mime_type: mediaType || "image/jpeg", data: image } },
          { text: prompt },
        ] }] }),
      });
      const d = await r.json();
      text = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else {
      return json({ error: "Kein KI-Schlüssel eingerichtet" }, 503);
    }

    const match = text.match(/\[[\s\S]*\]/);
    const found: string[] = match ? JSON.parse(match[0]) : [];
    return json({ items: found.filter((k) => keys.includes(k)) });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}
