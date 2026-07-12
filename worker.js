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

// --- Photobooth signaling via a Durable Object -----------------------------
// One room = one DO instance. DO storage is strongly consistent and instant, so
// the offer/answer handshake is NOT delayed by KV's 60s read cache (which made
// the host wait up to a minute for the guest's answer). Vanilla ICE: each side
// gathers candidates into its SDP before posting.
async function handlePhotobox(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!env.PHOTOROOM) return jsonRes({ error: "kv_not_set" }, 503); // client treats as "not enabled"
  const parts = url.pathname.split("/").filter(Boolean); // api, photobox, <room>, <slot>
  const room = (parts[2] || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const slot = parts[3];
  if (!room || !/^(offer|answer|ca|cb)$/.test(slot || "")) return jsonRes({ error: "bad_request" }, 400);
  const id = env.PHOTOROOM.idFromName(room);
  return env.PHOTOROOM.get(id).fetch(request);
}

function jsonRes(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// The room: holds the offer + answer, strongly consistent, instant reads.
export class PhotoRoom {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const slot = parts[parts.length - 1]; // offer | answer | ca | cb
    const st = this.state.storage;

    // offer / answer — one value each
    if (slot === "offer" || slot === "answer") {
      if (request.method === "POST" || request.method === "PUT") {
        const body = await request.text();
        if (body.length > 120000) return jsonRes({ error: "too_large" }, 413);
        await st.put(slot, body);
        return jsonRes({ ok: true });
      }
      if (request.method === "GET") {
        const v = await st.get(slot);
        if (!v) return jsonRes({ pending: true });
        return new Response(v, { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
    }
    // ca / cb — trickle ICE candidate lists (append-only; read new ones since an index)
    if (slot === "ca" || slot === "cb") {
      if (request.method === "POST" || request.method === "PUT") {
        const body = await request.text();
        const arr = (await st.get(slot)) || [];
        if (arr.length < 150 && body.length < 4000) { arr.push(body); await st.put(slot, arr); }
        return jsonRes({ ok: true, n: arr.length });
      }
      if (request.method === "GET") {
        const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
        const arr = (await st.get(slot)) || [];
        return jsonRes({ items: arr.slice(since), n: arr.length });
      }
    }
    return jsonRes({ error: "bad_request" }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/content") return handleContent(request, env);
    if (url.pathname.startsWith("/api/photobox/")) return handlePhotobox(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
