/* =============================================================================
   photobox.js — a two-person WebRTC photobooth.
   One code per room; signaling relayed by the Worker (KV). Vanilla ICE, so the
   handshake is just offer -> answer. Media is peer-to-peer. Snapshots are
   composited on a canvas and downloaded — nothing is uploaded.
   ========================================================================== */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // STUN for same-network; free TURN relays so it also connects across different
  // networks (e.g. Japan wifi <-> Indonesia mobile data).
  var ICE = { iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  ] };

  var pc = null, localStream = null, role = null, myCode = null;
  var connected = false, shooting = false, selectedLayout = "side", lastCanvas = null;

  // ------------------------------------------------------------ screens/status
  function show(id) {
    ["s-lobby", "s-wait", "s-session"].forEach(function (s) {
      $("#" + s).classList.toggle("on", s === id);
    });
  }
  function setStatus(where, msg, err) {
    var el = $(where); if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("err", !!err);
  }
  function handleErr(e) {
    var m = e && e.message, t;
    if (m === "kv") t = "Photobox belum diaktifkan (butuh KV). Minta diaktifkan dulu ya.";
    else if (m === "timeout") t = role === "guest"
      ? "Room nggak ketemu atau sudah kadaluarsa. Cek lagi kodenya."
      : "Pasangan belum bergabung. Coba bagikan ulang kodenya.";
    else if (e && (e.name === "NotAllowedError" || e.name === "NotFoundError" || e.name === "NotReadableError"))
      t = "Kamera nggak bisa diakses. Izinkan kamera di browser lalu coba lagi.";
    else t = "Ada kendala. Coba lagi ya.";
    show("s-lobby"); setStatus("#lobby-status", t, true);
    cleanup();
  }
  function cleanup() {
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    connected = false;
  }

  // ------------------------------------------------------------ signaling
  function api(room, slot) { return "/api/photobox/" + encodeURIComponent(room) + "/" + slot; }
  function post(room, slot, desc) {
    return fetch(api(room, slot), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(desc)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 503 || j.error === "kv_not_set") throw new Error("kv");
        if (!r.ok) throw new Error("post");
      });
    });
  }
  function poll(room, slot, timeoutMs) {
    var t0 = Date.now();
    return (function loop() {
      return fetch(api(room, slot), { cache: "no-store" })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (o.r.status === 503 || o.j.error === "kv_not_set") throw new Error("kv");
          if (o.j && o.j.type && o.j.sdp) return o.j;
          if (Date.now() - t0 > timeoutMs) throw new Error("timeout");
          return wait(1000).then(loop);
        });
    })();
  }

  // ------------------------------------------------------------ webrtc
  function getMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return Promise.reject(new Error("nomedia"));
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    });
  }
  function showSelf() {
    ["#selfPreview", "#selfVideo"].forEach(function (s) { var v = $(s); if (v) v.srcObject = localStream; });
  }
  function newPC() {
    var p = new RTCPeerConnection(ICE);
    localStream.getTracks().forEach(function (t) { p.addTrack(t, localStream); });
    p.ontrack = function (e) {
      var rv = $("#remoteVideo"); if (rv) rv.srcObject = e.streams[0];
      var off = $("#remote-off"); if (off) off.style.display = "none";
    };
    function markConnected() { if (!connected) { connected = true; enterSession(); } }
    p.onconnectionstatechange = function () {
      var st = p.connectionState;
      setStatus("#session-status", "Status: " + st);
      if (st === "connected") markConnected();
      if (st === "failed") setStatus("#session-status",
        "Gagal menyambung. Coba lagi — kalau tetap gagal, jaringan salah satu perlu relay lain.", true);
    };
    p.oniceconnectionstatechange = function () {
      var st = p.iceConnectionState;
      if (st === "connected" || st === "completed") markConnected();
    };
    return p;
  }
  function waitIce(p) {
    if (p.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(function (res) {
      var to = setTimeout(res, 5000);
      p.addEventListener("icegatheringstatechange", function h() {
        if (p.iceGatheringState === "complete") { clearTimeout(to); p.removeEventListener("icegatheringstatechange", h); res(); }
      });
    });
  }

  function rid() {
    var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", s = "";
    for (var i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  function startHost() {
    role = "host"; myCode = rid(); setStatus("#lobby-status", "");
    getMedia().then(function (stream) {
      localStream = stream; showSelf();
      pc = newPC();
      return pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
        .then(function () { return waitIce(pc); })
        .then(function () { return post(myCode, "offer", pc.localDescription); })
        .then(function () {
          showWaiting(myCode);
          return poll(myCode, "answer", 300000);
        })
        .then(function (ans) {
          setStatus("#wait-status", "Tersambung, menyiapkan sesi");
          return pc.setRemoteDescription(ans);
        });
    }).catch(handleErr);
  }

  function startJoin(code) {
    if (!code) { setStatus("#lobby-status", "Masukkan kodenya dulu.", true); return; }
    role = "guest"; myCode = code; setStatus("#lobby-status", "Menyambung ke room " + code + "…");
    poll(code, "offer", 20000).then(function (offer) {
      return getMedia().then(function (stream) {
        localStream = stream; showSelf();
        pc = newPC();
        return pc.setRemoteDescription(offer)
          .then(function () { return pc.createAnswer(); })
          .then(function (a) { return pc.setLocalDescription(a); })
          .then(function () { return waitIce(pc); })
          .then(function () { return post(code, "answer", pc.localDescription); })
          .then(function () { setStatus("#lobby-status", "Tersambung, menyiapkan sesi…"); });
      });
    }).catch(handleErr);
  }

  function showWaiting(code) {
    show("s-wait");
    $("#wait-code").textContent = code;
    var link = location.origin + location.pathname + "#" + code;
    $("#share-link").value = link;
  }
  function enterSession() {
    show("s-session");
    showSelf();
    setStatus("#session-status", "Tersambung. Pilih tata letak lalu ambil foto.");
  }

  // ------------------------------------------------------------ capture + compose
  function grabVideo(v, flip) {
    var w = (v && v.videoWidth) || 640, h = (v && v.videoHeight) || 480;
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d");
    if (flip) { g.translate(w, 0); g.scale(-1, 1); }
    try { g.drawImage(v, 0, 0, w, h); } catch (e) {}
    return c;
  }
  function grabPair() { return { a: grabVideo($("#selfVideo"), true), b: grabVideo($("#remoteVideo"), false) }; }

  function mk(w, h) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d"); g.fillStyle = "#F2EDE3"; g.fillRect(0, 0, w, h);
    return c;
  }
  function drawCover(g, src, x, y, w, h) {
    var sw = src.width, sh = src.height; if (!sw || !sh) return;
    var s = Math.max(w / sw, h / sh), dw = sw * s, dh = sh * s;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); g.restore();
    g.strokeStyle = "rgba(18,16,14,0.85)"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  function tsText() {
    var d = new Date();
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) +
      "  ·  " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  function heartLine(g, cx, y, font) {
    g.font = font; g.textBaseline = "middle";
    var L = "KAMU ", M = "♥", R = " AKU";
    var lw = g.measureText(L).width, mw = g.measureText(M).width, rw = g.measureText(R).width;
    var x = cx - (lw + mw + rw) / 2; g.textAlign = "left";
    g.fillStyle = "#12100E"; g.fillText(L, x, y); x += lw;
    g.fillStyle = "#FF4A7D"; g.fillText(M, x, y); x += mw;
    g.fillStyle = "#12100E"; g.fillText(R, x, y);
  }
  function footerBand(g, W, H, FT, ts) {
    var y = H - FT / 2;
    g.strokeStyle = "rgba(18,16,14,0.25)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(16, H - FT); g.lineTo(W - 16, H - FT); g.stroke();
    g.textBaseline = "middle";
    g.fillStyle = "#12100E"; g.font = "400 14px 'Space Mono', monospace"; g.textAlign = "left"; g.fillText(ts, 18, y);
    g.fillStyle = "#9A958C"; g.font = "400 12px 'Space Mono', monospace"; g.textAlign = "right"; g.fillText("YS-004", W - 18, y);
    heartLine(g, W / 2, y, "700 18px 'Space Mono', monospace");
  }
  function compose(layout, pairs) {
    var P = 18, FT = 64, ts = tsText(), c, g;
    if (layout === "stack") {
      var Ws = 620, Hs = 1140, cHs = (Hs - FT - 3 * P) / 2;
      c = mk(Ws, Hs); g = c.getContext("2d");
      drawCover(g, pairs[0].a, P, P, Ws - 2 * P, cHs);
      drawCover(g, pairs[0].b, P, 2 * P + cHs, Ws - 2 * P, cHs);
      footerBand(g, Ws, Hs, FT, ts); return c;
    }
    if (layout === "strip") {
      var W = 620, HEAD = 66, rowH = 300, gap = 14, rows = pairs.length;
      var H = HEAD + rows * rowH + (rows - 1) * gap + FT + P;
      c = mk(W, H); g = c.getContext("2d");
      heartLine(g, W / 2, HEAD / 2 + 4, "800 26px 'Archivo', sans-serif");
      var cw = (W - 2 * P - gap) / 2;
      for (var i = 0; i < rows; i++) {
        var yy = HEAD + i * (rowH + gap);
        drawCover(g, pairs[i].a, P, yy, cw, rowH);
        drawCover(g, pairs[i].b, P + cw + gap, yy, cw, rowH);
      }
      footerBand(g, W, H, FT, ts); return c;
    }
    // side (default)
    var Wd = 1120, Hd = 760, cHd = Hd - FT - 2 * P, cwd = (Wd - 3 * P) / 2;
    c = mk(Wd, Hd); g = c.getContext("2d");
    drawCover(g, pairs[0].a, P, P, cwd, cHd);
    drawCover(g, pairs[0].b, 2 * P + cwd, P, cwd, cHd);
    footerBand(g, Wd, Hd, FT, ts); return c;
  }

  function doCountdown(from) {
    var el = $("#count"), n = $("#count-n");
    el.classList.add("on");
    return (function step(k) {
      if (k < 1) { el.classList.remove("on"); return Promise.resolve(); }
      n.textContent = k; n.style.animation = "none"; void n.offsetWidth; n.style.animation = "";
      return wait(850).then(function () { return step(k - 1); });
    })(from);
  }

  function runSession() {
    if (shooting || !connected) return;
    shooting = true;
    $("#shoot-btn").disabled = true;
    $("#result").classList.remove("on");
    var n = selectedLayout === "strip" ? 3 : 1;
    var pairs = [];
    (function ready() {
      return (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(function () {}) : Promise.resolve();
    })().then(function () {
      return (function loop(i) {
        if (i >= n) return Promise.resolve();
        return doCountdown(3).then(function () {
          pairs.push(grabPair());
          return (i < n - 1 ? wait(800) : Promise.resolve()).then(function () { return loop(i + 1); });
        });
      })(0);
    }).then(function () {
      lastCanvas = compose(selectedLayout, pairs);
      $("#result-img").src = lastCanvas.toDataURL("image/png");
      $("#result").classList.add("on");
      $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function () {
      setStatus("#session-status", "Gagal mengambil foto. Coba lagi.", true);
    }).then(function () {
      shooting = false; $("#shoot-btn").disabled = false;
    });
  }

  function stamp() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // ------------------------------------------------------------ wire up
  function init() {
    $("#host-btn").addEventListener("click", startHost);
    $("#join-btn").addEventListener("click", function () {
      startJoin(($("#join-code").value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
    });
    $("#join-code").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#join-btn").click(); });

    $("#copy-link").addEventListener("click", function () {
      var v = $("#share-link").value;
      var done = function () { setStatus("#wait-status", "Tautan tersalin. Kirim ke pasangan kamu."); };
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(done).catch(function () { $("#share-link").select(); });
      else { $("#share-link").select(); try { document.execCommand("copy"); done(); } catch (e) {} }
    });

    document.querySelectorAll(".chip[data-layout]").forEach(function (b) {
      b.addEventListener("click", function () {
        selectedLayout = b.dataset.layout;
        document.querySelectorAll(".chip[data-layout]").forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
      });
    });
    $("#shoot-btn").addEventListener("click", runSession);
    $("#retake-btn").addEventListener("click", function () { $("#result").classList.remove("on"); });
    $("#download-btn").addEventListener("click", function () {
      if (!lastCanvas) return;
      var a = document.createElement("a");
      a.download = "photobox-" + stamp() + ".png";
      a.href = lastCanvas.toDataURL("image/png");
      document.body.appendChild(a); a.click(); a.remove();
    });

    // shared invite link: /photobox#CODE -> prefill the join field
    var h = (location.hash || "").replace(/^#/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (h) {
      $("#join-code").value = h;
      setStatus("#lobby-status", "Kode terisi dari tautan. Tap Gabung buat mulai.");
      $("#join-btn").classList.add("solid");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
