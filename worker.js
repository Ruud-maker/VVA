const CORS = {
  "Access-Control-Allow-Origin": "https://vvacheck.nl",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanPlate(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (
      origin &&
      origin !== "https://vvacheck.nl" &&
      origin !== "https://www.vvacheck.nl"
    ) {
      return reply({ error: "Origin niet toegestaan." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    const url = new URL(request.url);

    // AI-KENTEKENHERKENNING
    if (
      request.method === "POST" &&
      url.pathname === "/recognize"
    ) {
      if (!env.OPENAI_API_KEY) {
        return reply({
          error: "OpenAI API-sleutel ontbreekt in Cloudflare."
        }, 503);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return reply({ error: "Ongeldige aanvraag." }, 400);
      }

      const image = body.image;

      if (
        typeof image !== "string" ||
        !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)
      ) {
        return reply({
          error: "Ongeldige foto. Gebruik JPEG, PNG of WEBP."
        }, 400);
      }

      if (image.length > 16_000_000) {
        return reply({ error: "Foto is te groot." }, 413);
      }

      const instructions = `
Je bent een zeer nauwkeurige Nederlandse kentekenlezer.

Bekijk de volledige autofoto en zoek de kentekenplaat.
Lees uitsluitend de kentekenplaat van het duidelijkste
voertuig op de foto.

Negeer andere teksten, stickers en kentekens van
voertuigen op de achtergrond.

Geef het kenteken terug met zes letters en cijfers,
zonder spaties of streepjes.

Let extra op het verschil tussen:
O en 0
I en 1
B en 8
S en 5

Als je niet alle tekens betrouwbaar kunt lezen,
geef dan een leeg kenteken terug.

Antwoord uitsluitend met JSON:
{
  "plate": "XX813R",
  "confidence": "high",
  "reason": "Korte toelichting"
}

Gebruik high alleen als alle zes tekens duidelijk leesbaar zijn.
Gebruik medium of low bij twijfel.
`;

      let aiResponse;

      try {
        aiResponse = await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "gpt-6.1-terra",
              store: false,
              input: [{
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: instructions
                  },
                  {
                    type: "input_image",
                    image_url: image,
                    detail: "high"
                  }
                ]
              }]
            })
          }
        );
      } catch {
        return reply({
          error: "AI-dienst is tijdelijk niet bereikbaar."
        }, 502);
      }

      const result = await aiResponse.json().catch(() => ({}));

      if (!aiResponse.ok) {
        return reply({
          error: result.error?.message ||
            "AI-herkenning is mislukt."
        }, 502);
      }

      const output = (result.output || [])
        .flatMap(item => item.content || [])
        .filter(item => item.type === "output_text")
        .map(item => item.text)
        .join("\n");

      let parsed;

      try {
        const cleaned = output
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "");

        parsed = JSON.parse(cleaned);
      } catch {
        return reply({
          error: "AI-resultaat kon niet worden verwerkt."
        }, 502);
      }

      const plate = cleanPlate(parsed.plate);

      if (plate.length !== 6) {
        return reply({
          plate: "",
          confidence: "low",
          reason: parsed.reason || "Kenteken niet leesbaar."
        });
      }

      return reply({
        plate,
        confidence: parsed.confidence || "medium",
        reason: parsed.reason || ""
      });
    }

    // RDW-VOERTUIGGEGEVENS
    if (
      request.method === "GET" &&
      url.pathname === "/rdw"
    ) {
      const plate = cleanPlate(
        url.searchParams.get("plate")
      );

      if (plate.length !== 6) {
        return reply({ error: "Ongeldig kenteken." }, 400);
      }

      try {
        const rdwResponse = await fetch(
          "https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=" +
          encodeURIComponent(plate)
        );

        if (!rdwResponse.ok) {
          return reply({
            error: "RDW is tijdelijk niet bereikbaar."
          }, 502);
        }

        const rows = await rdwResponse.json();

        if (!rows.length) {
          return reply({ vehicle: null });
        }

        return reply({ vehicle: rows[0] });

      } catch {
        return reply({
          error: "RDW-opvraag mislukt."
        }, 502);
      }
    }

    return reply({ error: "Endpoint niet gevonden." }, 404);
  }
};
