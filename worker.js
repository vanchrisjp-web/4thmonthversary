/**
 * Cloudflare Worker entry — serves the static site (via the ASSETS binding) and
 * the optional /api/content endpoint (Mode B). This exists because the project's
 * Git deploy runs `wrangler deploy` (Workers Static Assets), not `wrangler pages
 * deploy`. Everything still works from file:// and any plain static host — this
 * file is only used by Cloudflare.
 *
 * Mode A: no KV bound -> GET /api/content returns `null` (200), the client falls
 *         back to content.json. Nothing to configure.
 * Mode B: bind a KV namespace as CONTENT and set the EDIT_TOKEN secret. Then SAVE
 *         in /#edit publishes via PUT (auth checked here, server-side).
 */

const KEY = "content";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

async function handleContent(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (request.method === "GET") {
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

  if (request.method === "PUT") {
    const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!env.EDIT_TOKEN || token !== env.EDIT_TOKEN) {
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }
    if (!env.CONTENT) return new Response("KV not bound", { status: 500, headers: CORS });
    let body;
    try {
      body = await request.text();
      JSON.parse(body); // validate before storing
    } catch (e) {
      return new Response("Bad JSON", { status: 400, headers: CORS });
    }
    await env.CONTENT.put(KEY, body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405, headers: CORS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/content") return handleContent(request, env);
    return env.ASSETS.fetch(request);
  },
};
