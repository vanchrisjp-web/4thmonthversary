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
  "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
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
    /* ca / cb — trickled ICE candidates, kept PER HANDSHAKE.

       This was one append-only list per side, capped at 150 and never cleared.
       Every reconnect piled another dozen candidates onto it, all of them
       carrying the ufrag of an ICE generation that no longer exists, and the
       receiving browser quietly discards those. Once the cap was reached the
       room stopped accepting new ones altogether -- so the two sides could
       gather perfectly good relay candidates all evening and never be handed a
       single usable one. Reported from the far side as "kandidat relay ada (6)
       tapi belum nyambung", which is exactly what it looks like: TURN working,
       nothing to connect to. And it got worse with every retry, which is why it
       could work once and then never again in the same room.

       Each handshake has a token (see the offer/answer slots). A candidate is
       stored under the token it was gathered for; a POST bearing a new token
       starts that side's list over, and a GET only ever receives candidates
       from the generation it asked for. Stale ones cannot accumulate, cannot
       fill the cap, and cannot be handed to a connection that will reject
       them. */
    if (slot === "ca" || slot === "cb") {
      if (request.method === "POST" || request.method === "PUT") {
        const body = await request.text();
        if (body.length > 4000) return jsonRes({ ok: true, n: 0 });
        let msg = null;
        try { msg = JSON.parse(body); } catch (e) { msg = null; }
        const tok = (msg && typeof msg.tok === "string") ? msg.tok.slice(0, 40) : "";
        const cand = msg && msg.c ? JSON.stringify(msg.c) : body; // pre-token clients
        const box = (await st.get(slot)) || { tok: "", list: [] };
        if (box.tok !== tok) { box.tok = tok; box.list = []; }   // a new call, a clean slate
        if (box.list.length < 150) { box.list.push(cand); await st.put(slot, box); }
        return jsonRes({ ok: true, n: box.list.length });
      }
      if (request.method === "GET") {
        const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
        const want = url.searchParams.get("tok");
        const box = (await st.get(slot)) || { tok: "", list: [] };
        // asking for a generation this side has not started yet: nothing to give
        if (want != null && box.tok !== want) return jsonRes({ items: [], n: 0, gen: box.tok });
        return jsonRes({ items: box.list.slice(since), n: box.list.length, gen: box.tok });
      }
    }
    return jsonRes({ error: "bad_request" }, 400);
  }
}

// TURN credentials for the photobox. Uses Cloudflare Realtime TURN when the
// TURN_KEY_ID + TURN_TOKEN secrets are set (reliable, global); otherwise falls
// back to STUN + a best-effort free TURN (works same-network, flaky across NAT).
async function handleTurn(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  const google = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };
  if (env.TURN_KEY_ID && env.TURN_TOKEN) {
    try {
      const r = await fetch(
        "https://rtc.live.cloudflare.com/v1/turn/keys/" + env.TURN_KEY_ID + "/credentials/generate",
        {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.TURN_TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        if (d && d.iceServers) return jsonRes({ iceServers: [d.iceServers, google], turn: "cloudflare" });
      }
    } catch (e) {}
  }
  return jsonRes({
    iceServers: [
      google,
      { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
    ],
    turn: "fallback",
  });
}

// Photobox album, backed by the existing KV (CONTENT) so there's nothing extra to
// set up. POST saves a PNG under album:<ts>-<rand>, GET lists, GET /api/album/<name>
// serves one. Images are small composites (well under KV's 25MB value limit).
async function handleAlbum(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!env.CONTENT) return jsonRes({ error: "kv_not_set" }, 503);

  const m = url.pathname.match(/^\/api\/album\/(.+)$/);
  if (m && request.method === "GET") {
    const got = await env.CONTENT.getWithMetadata("album:" + m[1], "arrayBuffer");
    const buf = got && got.value;
    if (!buf) return new Response("Not found", { status: 404, headers: CORS });
    const h = new Headers(CORS);
    // serve what was actually stored -- shared strips arrive as JPEG
    h.set("Content-Type", (got.metadata && got.metadata.ct) || "image/png");
    h.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(buf, { headers: h });
  }
  if (m && request.method === "DELETE") {
    await env.CONTENT.delete("album:" + m[1]);
    return jsonRes({ ok: true, deleted: m[1] });
  }
  if (url.pathname === "/api/album" && (request.method === "POST" || request.method === "PUT")) {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 5 * 1024 * 1024) return jsonRes({ error: "too_large" }, 413);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const ct = request.headers.get("Content-Type") || "";
    const mime = /^image\/(png|jpeg|webp)$/.test(ct) ? ct : "image/png";
    await env.CONTENT.put("album:" + name, buf, { metadata: { ct: mime } });
    return jsonRes({ ok: true, name: name, url: "/api/album/" + name });
  }
  if (url.pathname === "/api/album" && request.method === "GET") {
    const list = await env.CONTENT.list({ prefix: "album:", limit: 500 });
    const items = (list.keys || [])
      .map(function (k) { const n = k.name.replace(/^album:/, ""); return { name: n, url: "/api/album/" + n, uploaded: parseInt(n.split("-")[0], 10) || 0 }; })
      .sort(function (a, b) { return b.uploaded - a.uploaded; });
    return jsonRes({ items: items });
  }
  return jsonRes({ error: "bad_request" }, 400);
}

// Media store for editor content (track photos + voice notes), backed by KV so
// the content JSON stays tiny (URLs, not base64). POST (auth) saves a blob under
// media:<name> with its content-type; GET serves it. Keeps localStorage + the
// KV content value small and loads fast for everyone.
function editAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return !!env.EDIT_TOKEN && token === env.EDIT_TOKEN;
}
async function handleMedia(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!env.CONTENT) return jsonRes({ error: "kv_not_set" }, 503);

  const m = url.pathname.match(/^\/api\/media\/(.+)$/);
  if (m && request.method === "GET") {
    const obj = await env.CONTENT.getWithMetadata("media:" + m[1], { type: "arrayBuffer" });
    if (!obj || !obj.value) return new Response("Not found", { status: 404, headers: CORS });
    const h = new Headers(CORS);
    h.set("Content-Type", (obj.metadata && obj.metadata.ct) || "application/octet-stream");
    h.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(obj.value, { headers: h });
  }
  if (m && request.method === "DELETE") {
    if (!editAuthorized(request, env)) return jsonRes({ error: "unauthorized" }, 401);
    await env.CONTENT.delete("media:" + m[1]);
    return jsonRes({ ok: true, deleted: m[1] });
  }
  if (url.pathname === "/api/media" && (request.method === "POST" || request.method === "PUT")) {
    if (!editAuthorized(request, env)) return jsonRes({ error: "unauthorized" }, 401);
    const ct = request.headers.get("Content-Type") || "application/octet-stream";
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) return jsonRes({ error: "too_large" }, 413);
    const kind = ct.indexOf("audio") === 0 ? "aud" : ct.indexOf("image") === 0 ? "img" : "bin";
    const name = kind + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await env.CONTENT.put("media:" + name, buf, { metadata: { ct: ct } });
    return jsonRes({ ok: true, name: name, url: "/api/media/" + name });
  }
  return jsonRes({ error: "bad_request" }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/content") return handleContent(request, env);
    if (url.pathname === "/api/photobox/turn") return handleTurn(request, env);
    if (url.pathname === "/api/album" || url.pathname.startsWith("/api/album/")) return handleAlbum(request, env, url);
    if (url.pathname === "/api/media" || url.pathname.startsWith("/api/media/")) return handleMedia(request, env, url);
    if (url.pathname.startsWith("/api/photobox/")) return handlePhotobox(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
