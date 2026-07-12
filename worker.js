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

// --- Photobooth signaling (Mode B / KV) -------------------------------------
// A room is just two slots in KV — the host's offer and the guest's answer
// (vanilla ICE: each side gathers candidates into its SDP before posting, so
// the whole handshake is two writes + a little polling). Keys expire in 10 min.
async function handlePhotobox(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!env.CONTENT) return jsonRes({ error: "kv_not_set" }, 503);
  const parts = url.pathname.split("/").filter(Boolean); // api, photobox, <room>, <slot>
  const room = (parts[2] || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const slot = parts[3];
  if (!room || (slot !== "offer" && slot !== "answer")) return jsonRes({ error: "bad_request" }, 400);
  const key = "pb:" + room + ":" + (slot === "offer" ? "o" : "a");

  if (request.method === "POST" || request.method === "PUT") {
    const body = await request.text();
    if (body.length > 120000) return jsonRes({ error: "too_large" }, 413);
    await env.CONTENT.put(key, body, { expirationTtl: 600 });
    return jsonRes({ ok: true });
  }
  if (request.method === "GET") {
    const v = await env.CONTENT.get(key);
    if (!v) return jsonRes({ pending: true });
    return new Response(v, { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  return jsonRes({ error: "method" }, 405);
}

function jsonRes(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/content") return handleContent(request, env);
    if (url.pathname.startsWith("/api/photobox/")) return handlePhotobox(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
