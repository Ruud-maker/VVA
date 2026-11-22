/**
 * VVA Check - Autotelex Worker voorbereidende basis
 * Nog niet actief: vereist Autotelex testtoegang en officiële request-specificatie.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://vvacheck.nl",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, {status:204, headers:corsHeaders});
    if (url.pathname !== "/api/valuation") return json({error:"Endpoint niet gevonden."},404);
    if (request.method !== "POST") return json({error:"Gebruik POST."},405);
    let body;
    try { body = await request.json(); } catch { return json({error:"Ongeldige JSON-aanvraag."},400); }
    const plate = String(body.plate || "").toUpperCase().replace(/[^A-Z0-9]/g,"");
    const mileage = Number(body.mileage);
    if (!/^[A-Z0-9]{6}$/.test(plate)) return json({error:"Ongeldig Nederlands kenteken."},400);
    if (!Number.isFinite(mileage) || mileage < 0) return json({error:"Ongeldige kilometerstand."},400);
    if (!env.AUTOTELEX_VENDOR_USERNAME || !env.AUTOTELEX_VENDOR_PASSWORD ||
        !env.AUTOTELEX_API_URL || !env.AUTOTELEX_API_MODE) {
      return json({error:"Autotelex is nog niet geconfigureerd. Testaccount, API-rechten en endpoint ontbreken.",code:"AUTOTELEX_NOT_CONFIGURED"},503);
    }
    // Geen API-aanroep gokken. De officiële VehicleParameters-specificatie en
    // test-WSDL zijn nodig om de SOAP/JSON payload correct op te bouwen.
    return json({error:"Testcredentials aanwezig, maar de Autotelex-adapter moet nog worden ingevuld op basis van de officiële testspecificatie.",code:"ADAPTER_PENDING"},501);
  }
};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:corsHeaders});}
