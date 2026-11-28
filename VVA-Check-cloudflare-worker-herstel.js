/**
 * VVA Check - AI kentekenherkenning
 * Deploy as a Cloudflare Worker.
 * Add OPENAI_API_KEY as a Worker Secret; never put it in GitHub or index.html.
 */
const ALLOWED_ORIGINS = new Set([
  "https://vvacheck.nl",
  "https://www.vvacheck.nl"
]);
const MODEL = "gpt-5.5";

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://vvacheck.nl";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) }
  });
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/recognize" || request.method !== "POST") {
      return json({ error: "Gebruik POST /recognize." }, 404, origin);
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Deze website is niet toegestaan." }, 403, origin);
    }
    if (!env.OPENAI_API_KEY) {
      return json({ error: "De OpenAI API-sleutel ontbreekt als Cloudflare Secret OPENAI_API_KEY." }, 500, origin);
    }
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Ongeldige JSON-aanvraag." }, 400, origin); }

    const image = body && body.image;
    if (typeof image !== "string" ||
        !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)) {
      return json({ error: "Geen geldige uitsnede ontvangen. Gebruik JPEG, PNG of WEBP." }, 400, origin);
    }
    if (image.length > 4_000_000) {
      return json({ error: "De uitsnede is te groot. Maak een kleinere uitsnede." }, 413, origin);
    }

    const payload = {
      model: MODEL,
      store: false,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Lees uitsluitend de zichtbare Nederlandse kentekenplaat in deze afbeelding. Geef alleen de zes tekens van het kenteken terug, zonder streepjes, spaties of uitleg. Gebruik hoofdletters. Als niet alle zes tekens duidelijk leesbaar zijn, antwoord exact NONE. Raad nooit ontbrekende tekens."
          },
          { type: "input_image", image_url: image, detail: "high" }
        ]
      }]
    };

    let apiResponse;
    try {
      apiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch {
      return json({ error: "OpenAI is momenteel niet bereikbaar." }, 502, origin);
    }

    const data = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      return json({ error: data.error?.message || `OpenAI gaf HTTP ${apiResponse.status}.` }, 502, origin);
    }
    const text = (data.output || [])
      .filter(item => item.type === "message")
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text || "")
      .join("")
      .trim();

    const plate = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const validDutchPatterns = [
      /^[A-Z]{2}[0-9]{3}[A-Z]$/, /^[A-Z]{3}[0-9]{2}[A-Z]$/,
      /^[0-9]{2}[A-Z]{3}[0-9]$/, /^[0-9]{2}[A-Z]{2}[0-9]{2}$/,
      /^[A-Z]{2}[0-9]{2}[A-Z]{2}$/, /^[A-Z]{2}[A-Z]{2}[0-9]{2}$/,
      /^[0-9]{2}[0-9]{2}[A-Z]{2}$/, /^[0-9][A-Z]{3}[0-9]{2}$/ ,
      /^[A-Z][0-9]{2}[A-Z]{3}$/
    ];
    if (!validDutchPatterns.some(re => re.test(plate))) {
      return json({ plate: "", reason: "De AI kon geen volledig en geldig Nederlands kenteken betrouwbaar lezen." }, 200, origin);
    }
    return json({ plate }, 200, origin);
  }
};
