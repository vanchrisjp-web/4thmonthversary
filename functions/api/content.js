/**
 * Cloudflare Pages Function — /api/content  (Mode B, optional)
 *
 * GET  -> returns the JSON stored in KV, or the literal `null` (HTTP 200) when
 *         there is no KV binding or no value yet. Returning 200-null instead of a
 *         404 keeps the browser console clean on a Mode A deploy; the client reads
 *         `null` as "nothing to merge, fall back to content.json".
 * PUT  -> validates `Authorization: Bearer <EDIT_TOKEN>` against the encrypted
 *         secret, then writes the body to KV. Never trust the client-side passcode
 *         for writes — the gate here is the server-side secret.
 *
 * Bindings (set in wrangler.toml / dashboard):
 *   env.CONTENT     KV namespace (optional)
 *   env.EDIT_TOKEN  secret string (required for PUT)
 */

const KEY = "content";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function onRequestGet({ env }) {
  const empty = new Response("null", {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (!env.CONTENT) return empty;
  const data = await env.CONTENT.get(KEY);
  if (!data) return empty;
  return new Response(data, {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestPut({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!env.EDIT_TOKEN || token !== env.EDIT_TOKEN) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }
  if (!env.CONTENT) return new Response("KV not bound", { status: 500, headers: CORS });

  let body;
  try {
    body = await request.text();
    JSON.parse(body); // validate it is JSON before storing
  } catch (e) {
    return new Response("Bad JSON", { status: 400, headers: CORS });
  }
  await env.CONTENT.put(KEY, body);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
