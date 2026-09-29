/* =============================================================================
   photobox.js — a two-person WebRTC photobooth.
   One code per room; signaling relayed by the Worker (KV). Vanilla ICE, so the
   handshake is just offer -> answer. Media is peer-to-peer. Snapshots are
   composited on a canvas and downloaded — nothing is uploaded.
   What the strip looks like (layout, frame, caption) is bingkai.js; this file
   is the room, the cameras, the shutter, and the studio that drives it.
   ========================================================================== */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // ICE servers are fetched from the Worker (/api/photobox/turn), which mints
  // Cloudflare TURN credentials server-side. STUN-only until that resolves.
  var ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
  var relayCount = 0;
  /* NEVER FORBID THE DIRECT PATH.
     This used to set iceTransportPolicy:"relay" whenever real TURN credentials
     came back -- relay is the path that survives the worst networks, so the
     reasoning went, use it always. But "relay only" does not mean "prefer
     relay", it means every other candidate is discarded before it is even
     offered. One bad minute at the TURN server and ICE gathers ZERO candidates,
     the offer goes out empty, and both booths sit on "Menyambung..." forever
     with nothing to connect to -- measured: 0 candidates, connectionState never
     leaves "new". The same test with the policy left alone gathers host and
     srflx candidates and connects anyway.
     TURN is still in the list below, so a genuinely hostile network still gets
     its relay. It is now the last resort it was always meant to be, not the
     only one. (This is what Side B's video call has always done.) */
  function loadIce() {
    /* And a cap, because the whole join is chained behind this fetch: the guest
       posts "Menyambung ke room X..." and only then waits on it. No timeout
       here meant a slow credential endpoint hung the booth on that exact line
       with no way forward. Six seconds, then open on STUN. */
    return new Promise(function (resolve) {
      var settled = false;
      var done = function () { if (!settled) { settled = true; resolve(); } };
      var t = setTimeout(done, 6000);
      fetch("/api/photobox/turn", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.iceServers && j.iceServers.length) ICE = { iceServers: j.iceServers };
        })
        .catch(function () {})
        .then(function () { clearTimeout(t); done(); });
    });
  }

  var pc = null, localStream = null, role = null, myCode = null;
  var connected = false, shooting = false, lastCanvas = null;
  /* The composed strip, as a blob. The shooter also keeps lastCanvas (the PNG
     original) and the pictures it was made from (lastPairs), so the frame can
     still change after the shutter; the other one only ever has the blob. */
  var lastBlob = null, lastMime = "image/png", rxUrl = null, lastPairs = null, shotAt = null;
  var CHUNK = 16 * 1024;          // SCTP-safe message size
  var rx = null;                   // an incoming strip, mid-flight

  /* Looks. Each is a canvas/CSS filter string, so the SAME value drives the
     live preview and the baked frame -- what you pose for is what you keep.
     Canvas 2D `filter` is honoured by every current browser; where it is not,
     the frame simply bakes unfiltered rather than failing. */
  var LOOKS = {
    asli:    { name: "Asli",    css: "none" },
    hangat:  { name: "Hangat",  css: "sepia(0.18) saturate(1.28) contrast(1.05) brightness(1.05)" },
    dingin:  { name: "Dingin",  css: "saturate(1.12) hue-rotate(-12deg) brightness(1.07) contrast(1.06)" },
    mekar:   { name: "Mekar",   css: "saturate(1.18) brightness(1.13) contrast(0.94)" },
    retro:   { name: "Retro",   css: "sepia(0.5) contrast(1.12) saturate(1.2) brightness(1.02)" },
    malam:   { name: "Malam",   css: "grayscale(1) contrast(1.2) brightness(0.98)" },
    salju:   { name: "Salju",   css: "brightness(1.16) saturate(0.82) contrast(1.06) hue-rotate(8deg)" },
    // Kalung 26, her birthday: the romantic ones (for every pressing; the birthday shows them first)
    mawar:     { name: "Mawar",      css: "sepia(0.22) saturate(1.3) hue-rotate(-14deg) brightness(1.05) contrast(1.02)" },
    senja:     { name: "Senja",      css: "sepia(0.38) saturate(1.45) hue-rotate(-20deg) contrast(1.06) brightness(1.02)" },
    kenangan:  { name: "Kenangan",   css: "sepia(0.5) saturate(0.78) contrast(0.9) brightness(1.08)" },
    lembut:    { name: "Lembut",     css: "brightness(1.1) contrast(0.88) saturate(1.06)" },
    mimpi:     { name: "Mimpi",      css: "brightness(1.14) contrast(0.84) saturate(0.9) hue-rotate(-6deg)" },
    sinema:    { name: "Sinema",     css: "contrast(1.16) saturate(0.86) sepia(0.12) brightness(0.96)" },
    abuhangat: { name: "Abu hangat", css: "grayscale(1) sepia(0.28) contrast(1.08) brightness(1.04)" }
  };
  var LOOK_026 = ["asli", "mawar", "senja", "kenangan", "lembut", "mimpi", "sinema", "abuhangat", "hangat", "dingin", "mekar", "retro", "malam", "salju"];
  /* Everything about how the strip is laid out and framed -- layout, frame,
     caption, look, countdown -- is one object (bingkai.js), remembered per
     pressing on this device and mirrored to the other booth. */
  var BK = window.Bingkai;
  var PRESS = pressNo();
  var studio = loadStudio();
  function lookCSS() { var l = LOOKS[studio.look]; return (l && l.css) || "none"; }
  function applyLookToPreview() {
    var f = lookCSS();
    // includes the lobby preview, so you can pick a look before connecting
    ["#selfPreview", "#selfVideo", "#remoteVideo"].forEach(function (sel) {
      var v = $(sel); if (v) v.style.filter = f === "none" ? "" : f;
    });
  }
  /* How many shots the chosen layout needs. */
  function shotCount() { return BK.plan(studio).shots; }
  var dc = null, guestCounting = false; // data channel: sync the countdown to both sides

  // ------------------------------------------------------------ screens/status
  function show(id) {
    ["s-lobby", "s-wait", "s-session", "s-album"].forEach(function (s) {
      var el = $("#" + s); if (el) el.classList.toggle("on", s === id);
    });
    mountStudio(id);
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
    stopCandPolls();
    clearTimeout(connTimer); clearTimeout(healT); healT = null;
    if (dc) { try { dc.close(); } catch (e) {} dc = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    connected = false; remoteReady = false; candQueue = []; camTrx = null;
    role = null; // nothing left to heal once we are back in the lobby
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
  function postRaw(room, slot, body) {
    return fetch(api(room, slot), { method: "POST", headers: { "Content-Type": "application/json" }, body: body }).catch(function () {});
  }
  /* `ok` decides whether the description in the slot is the one we are waiting
     for. Both slots are single-valued and reused on every reconnect, so "is
     there one?" is the wrong question -- a rebuild that asks it re-applies the
     dead description it was trying to replace, or worse, answers offer #2 with
     the answer to offer #1 and rejects it as malformed. Every handshake carries
     a token (see `tok` below) and both sides match on that. */
  function poll(room, slot, timeoutMs, ok) {
    var t0 = Date.now();
    return (function loop() {
      return fetch(api(room, slot), { cache: "no-store" })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (o.r.status === 503 || o.j.error === "kv_not_set") throw new Error("kv");
          if (o.j && o.j.type && o.j.sdp && (!ok || ok(o.j))) return o.j;
          if (Date.now() - t0 > timeoutMs) throw new Error("timeout");
          return wait(1000).then(loop);
        });
    })();
  }
  /* A handshake's name. The host mints one per offer; the guest echoes it back
     on the answer. Extra keys on a session description are ignored by
     setRemoteDescription, so this rides along for free. */
  function tok() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function withTok(desc, t) { return { type: desc.type, sdp: desc.sdp, tok: t }; }

  // ------------------------------------------------------------ webrtc
  /* THE CAMERA IS OFTEN ALREADY SOMEONE ELSE'S.
     Asking for 1280x720 asks Windows to open the device in a specific mode. If
     Discord (or Zoom, or another tab, or a booth tab that was closed badly) is
     already holding it, that fails outright -- and Discord keeps the handle
     even with its video switched off in the UI, which is why turning it off
     there changes nothing. Come down the ladder instead: the loosest request
     can usually attach to whatever mode is already running. */
  var CAM_TRIES = [
    { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: "user" }, audio: false },
    { video: true, audio: false }
  ];
  /* And a clock on each attempt. A contested camera does not always reject --
     on Windows it can simply never answer, and the whole join is chained
     behind it, which is how the guest ends up parked on "Menyambung ke
     room X..." with no error and no way forward. */
  function gumOnce(c) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var t = setTimeout(function () {
        if (settled) return;
        settled = true; reject(new Error("camtimeout"));
      }, 9000);
      navigator.mediaDevices.getUserMedia(c).then(function (s) {
        clearTimeout(t);
        if (settled) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; } // arrived late
        settled = true; resolve(s);
      }, function (e) {
        clearTimeout(t);
        if (!settled) { settled = true; reject(e); }
      });
    });
  }
  function getMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return Promise.reject(new Error("nomedia"));
    var i = 0, last = null;
    return (function next() {
      if (i >= CAM_TRIES.length) return Promise.reject(last || new Error("nocam"));
      return gumOnce(CAM_TRIES[i++]).catch(function (e) { last = e; return next(); });
    })();
  }
  function haveCam() { return !!(localStream && localStream.getVideoTracks().length); }
  /* The answering side takes over the video lane the offer brought, rather
     than making one of its own that never gets associated. Must run before
     createAnswer, or the answer goes out recvonly and the camera stays home. */
  function adoptCamLane() {
    if (!pc) return;
    var t = pc.getTransceivers().filter(function (x) {
      return x.receiver && x.receiver.track && x.receiver.track.kind === "video";
    })[0];
    if (!t) return;
    camTrx = t;
    try { t.direction = "sendrecv"; } catch (e) {} // keep the lane open for a camera that frees up later
    var vt = localStream && localStream.getVideoTracks()[0];
    if (vt && t.sender) t.sender.replaceTrack(vt).catch(function () {});
  }
  function showSelf() {
    ["#selfPreview", "#selfVideo"].forEach(function (s) { var v = $(s); if (v) { v.srcObject = localStream; keepPlaying(v); } });
    pvKick();
  }
  /* KEEP THE MIRRORS RUNNING.
     A muted video started by the autoplay attribute is paused by Chrome while
     it is scrolled out of view, and resumes only when it comes back. The live
     preview, the cut-out and the shutter all read from these videos, so a
     mirror scrolled off the top of a phone froze the strip -- found as a black
     frame the segmenter rightly found nobody in. Playback started from script
     is not paused that way; and if one stops anyway, start it again. */
  function keepPlaying(v) {
    if (!v) return;
    v.removeAttribute("autoplay");
    if (!v._keep) {
      v._keep = true;
      v.addEventListener("pause", function () {
        if (!v.srcObject) return;
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      });
    }
    if (v.srcObject && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  }
  // both screens carry the same button; whichever one is up gets it
  function refreshCamUI() {
    var on = haveCam();
    ["#cam-retry", "#wait-cam"].forEach(function (s) { var b = $(s); if (b) b.hidden = on; });
  }
  var camMsg = "";
  // the note follows you across screens -- it was being written to the lobby
  // half a second before the lobby stopped being the screen you were on
  function camHint() { if (!haveCam() && camMsg) setStatus(statusEl(), camMsg, true); }
  function camNote(e) {
    var n = (e && (e.name || e.message)) || "";
    var t;
    if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError" || n === "camtimeout")
      t = "Kamera lagi dipakai aplikasi lain (Discord/Zoom/tab lain) — tutup kameranya di sana, terus pencet “Nyalakan kamera”. Sesinya tetap jalan kok.";
    else if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError")
      t = "Kamera belum diizinkan. Klik ikon kamera di address bar → izinkan → pencet “Nyalakan kamera”.";
    else if (n === "NotFoundError" || n === "DevicesNotFoundError" || n === "nocam" || n === "nomedia")
      t = "Nggak nemu kamera. Sesinya tetap jalan — kamu masih bisa lihat dia.";
    else
      t = "Kamera belum bisa dipakai. Sesinya tetap jalan — pencet “Nyalakan kamera” kalau sudah bebas.";
    camMsg = t;
    setStatus(statusEl(), t, true);
    watchForCamera();
  }
  /* A "kamera lagi dipakai" that is still up after you have closed the other
     app is worse than no message at all: it says the booth is broken when the
     booth is fine. While the note is showing, keep quietly asking, and take the
     camera the moment it comes free -- straight into the live call, no
     handshake, nothing to press. */
  var camWatch = null;
  function watchForCamera() {
    if (camWatch) return;
    camWatch = setInterval(function () {
      if (haveCam() || !role) { clearInterval(camWatch); camWatch = null; return; }
      getMedia().then(function (s) {
        var t = s.getVideoTracks()[0];
        if (!t) { s.getTracks().forEach(function (x) { x.stop(); }); return; }
        clearInterval(camWatch); camWatch = null;
        if (localStream) localStream.getTracks().forEach(function (x) { x.stop(); });
        localStream = s; camMsg = "";
        showSelf(); refreshCamUI(); applyLookToPreview();
        if (camTrx && camTrx.sender) camTrx.sender.replaceTrack(t).catch(function () {});
        setStatus(statusEl(), "Kamera nyala ✓");
      }).catch(function () {});
    }, 4000);
  }
  /* A reload used to leave the old page's camera handle open for a moment, and
     the new page would then be told -- correctly, and uselessly -- that the
     camera was busy. Hand it back on the way out. */
  window.addEventListener("pagehide", function () {
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
  });
  /* Pick the camera up mid-session, without a second handshake. The video lane
     is reserved as sendrecv at connect time (see newPC), so a track that turns
     up later just slides into the sender that is already there. */
  function retryCam() {
    setStatus(statusEl(), "Nyari kamera…");
    return getMedia().then(function (s) {
      var t = s.getVideoTracks()[0];
      if (!t) { s.getTracks().forEach(function (x) { x.stop(); }); throw new Error("nocam"); }
      if (localStream) localStream.getTracks().forEach(function (x) { x.stop(); });
      localStream = s; camMsg = "";
      showSelf(); refreshCamUI(); applyLookToPreview();
      if (camTrx && camTrx.sender) camTrx.sender.replaceTrack(t).catch(function () {});
      setStatus(statusEl(), "Kamera nyala ✓");
    }).catch(camNote);
  }
  function dropCam() {
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
    localStream = null;
    showSelf(); refreshCamUI();
  }
  var remoteReady = false, candQueue = [], candTimers = [], candPollStop = false, connTimer = null;
  var camTrx = null;

  function newPC(candSlot) {
    relayCount = 0;
    var p = new RTCPeerConnection({ iceServers: ICE.iceServers });
    /* A LANE FOR THE CAMERA WHETHER OR NOT WE HAVE ONE.
       addTrack needs a track, so a busy camera used to mean no video lane at
       all -- and the old code did not even get that far, it threw the whole
       join away. addTransceiver reserves a sendrecv lane with nothing in it,
       so the call still forms, HER picture still arrives, and a camera that
       frees up later drops straight into the sender that is already there.

       ONLY THE SIDE THAT WRITES THE OFFER CREATES IT. Chrome does not reliably
       adopt a transceiver the answering side made in advance -- measured, the
       guest finished with an orphan (mid null, camera attached, going nowhere)
       sitting beside the recvonly one the offer had created, and answered
       "recvonly" with its camera plainly running. The answerer takes over the
       lane the offer brings instead; see adoptCamLane. */
    camTrx = null;
    if (role === "host") {
      var vt = localStream ? (localStream.getVideoTracks()[0] || null) : null;
      camTrx = p.addTransceiver(vt || "video", {
        direction: "sendrecv",
        streams: [localStream || new MediaStream()]
      });
    }
    // data channel to broadcast the countdown so BOTH sides pose together
    if (role === "host") { dc = p.createDataChannel("pb"); setupDC(dc); }
    else { p.ondatachannel = function (e) { dc = e.channel; setupDC(dc); }; }
    p.ontrack = function (e) {
      var rv = $("#remoteVideo"); if (!rv) return;
      // a lane with no stream attached still carries a track; take either
      rv.srcObject = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      keepPlaying(rv);
      var pr = rv.play(); if (pr && pr.catch) pr.catch(function () {});
      applyLookToPreview();
      /* A reserved lane exists even when the other camera is busy, so "a track
         arrived" is not the same as "there is a picture". Say which. */
      var off = $("#remote-off");
      var mark = function () {
        if (!off) return;
        pvKick();
        if (rv.videoWidth > 0) { off.style.display = "none"; }
        else { off.style.display = ""; off.textContent = "kameranya lagi kepakai"; }
      };
      rv.addEventListener("loadedmetadata", mark);
      rv.addEventListener("resize", mark);
      mark(); setTimeout(mark, 2500);
    };
    // trickle: publish each local candidate the instant it's found (no gather
    // wait), stamped with the handshake it belongs to so the far side is never
    // handed candidates from a call that no longer exists
    var gen = genTok;
    p.onicecandidate = function (e) {
      if (e.candidate) {
        postRaw(myCode, candSlot, JSON.stringify({ tok: gen, c: e.candidate }));
        if (e.candidate.type === "relay") relayCount++;
      }
    };
    p.onconnectionstatechange = function () {
      if (p !== pc) return;                       // a torn-down connection has no say
      var st = p.connectionState;
      if (connected) setStatus("#session-status", "Status: " + st);
      if (st === "connected") { healN = 0; clearTimeout(healT); healT = null; markConnected(); }
      /* "disconnected" is usually a blip and comes back by itself; "failed" is
         terminal and never does. Give the first a few seconds of grace, and
         rebuild on the second rather than printing a sentence and stopping. */
      if (st === "disconnected") healLater(6000);
      if (st === "failed") healLater(400);
    };
    p.oniceconnectionstatechange = function () {
      if (p !== pc) return;
      var st = p.iceConnectionState;
      if (st === "connected" || st === "completed") markConnected();
    };
    return p;
  }
  function markConnected() {
    if (connected) return;
    connected = true;
    clearTimeout(connTimer); clearTimeout(healT); healT = null;
    enterSession();
    setTimeout(stopCandPolls, 4000); // grab trailing candidates, then stop
    // keep the link measurement warm so the first shot is as aligned as the tenth
    sampleLag();
    clearInterval(lagTimer);
    lagTimer = setInterval(sampleLag, 3000);
  }
  var lagTimer = null;
  // whichever panel is actually on screen -- not whichever one the role implies
  function statusEl() {
    var s = $("#s-session"); if (s && s.classList.contains("on")) return "#session-status";
    var w = $("#s-wait");    if (w && w.classList.contains("on")) return "#wait-status";
    return "#lobby-status";
  }
  function armConnectTimeout() {
    clearTimeout(connTimer);
    connTimer = setTimeout(function () {
      if (connected) return;
      if (relayCount > 0)
        setStatus(statusEl(), "Kandidat relay ada (" + relayCount + ") tapi belum nyambung — masih nyoba…", true);
      else
        setStatus(statusEl(), "Belum nyambung. Masih nyoba — kalau lama, refresh dua-duanya ya.", true);
    }, 20000);
  }

  /* SELF-HEAL.
     There was no recovery here at all: a connection that failed printed one
     sentence and the booth sat there. Rebuild inside the SAME room -- a fresh
     description into the same slot, which the other side notices because it
     compares against the one it already applied. Capped, so a network that is
     simply down cannot spin. */
  var healN = 0, healT = null, appliedTok = "", genTok = "";
  function healLater(ms) {
    if (healT || !role) return;
    healT = setTimeout(function () {
      healT = null;
      if (!pc || pc.connectionState === "connected") return;
      rebuild();
    }, ms);
  }
  function rebuild() {
    if (healN >= 4) {
      setStatus(statusEl(), "Sambungan nggak mau naik. Refresh dua-duanya ya.", true);
      return;
    }
    healN++;
    stopCandPolls();
    if (dc) { try { dc.close(); } catch (e) {} dc = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    connected = false; remoteReady = false; candQueue = []; candPollStop = false;
    setStatus(statusEl(), "Sambungan putus — nyoba nyambung lagi (" + healN + ")…");
    (role === "host" ? hostHandshake() : guestHandshake()).catch(function () { healLater(4000); });
  }
  function addRemoteCandidate(str) {
    var c; try { c = JSON.parse(str); } catch (e) { return; }
    if (remoteReady && pc) { try { pc.addIceCandidate(c); } catch (e) {} }
    else candQueue.push(c);
  }
  function flushCandidates() {
    remoteReady = true;
    candQueue.forEach(function (c) { if (pc) { try { pc.addIceCandidate(c); } catch (e) {} } });
    candQueue = [];
  }
  function startCandPoll(code, slot, gen) {
    var since = 0, t0 = Date.now();
    var q = gen ? "&tok=" + encodeURIComponent(gen) : "";
    (function loop() {
      /* This used to give up after 90 seconds while the host waited five
         minutes for an answer -- so a partner who took their time walking to
         the other machine arrived to a host that had stopped listening for
         their candidates. Match the wait; it stops on its own once connected. */
      if (candPollStop || Date.now() - t0 > 300000) return;
      fetch(api(code, slot) + "?since=" + since + q, { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.items) { j.items.forEach(addRemoteCandidate); since = j.n; } })
        .catch(function () {})
        .then(function () { if (!candPollStop) candTimers.push(setTimeout(loop, 900)); });
    })();
  }
  function stopCandPolls() { candPollStop = true; candTimers.forEach(clearTimeout); candTimers = []; }

  function rid() {
    var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", s = "";
    for (var i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  /* The camera is asked for once per visit, not once per attempt -- a reconnect
     must not put a permission prompt in front of someone mid-session.

     AND A BUSY CAMERA NEVER ENDS THE DATE. This used to reject, which threw the
     whole join away and dumped both of you back in the lobby with one sentence
     about permissions. Now it connects anyway: she still appears, and the
     camera can be picked up the moment whatever is holding it lets go. */
  function needMedia() {
    if (localStream) return Promise.resolve(localStream);
    return getMedia().then(function (s) {
      localStream = s; camMsg = ""; showSelf(); refreshCamUI(); applyLookToPreview(); return s;
    }, function (e) {
      localStream = new MediaStream(); // no tracks, but the lanes still line up
      showSelf(); refreshCamUI();
      camNote(e);
      return localStream;
    });
  }

  /* One handshake per side, callable again. `first` is the walk-in: it is what
     shows the waiting screen and keeps the guest's "is this room real?" check
     short. A rebuild passes nothing and re-runs the same steps in place. */
  function hostHandshake(first) {
    remoteReady = false; candQueue = []; candPollStop = false;
    var mine = tok();
    genTok = mine;
    return needMedia().then(function () {
      pc = newPC("ca"); // host publishes its candidates to "ca"
      return pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
        .then(function () { return post(myCode, "offer", withTok(pc.localDescription, mine)); }) // send offer immediately
        .then(function () {
          if (first) showWaiting(myCode);
          startCandPoll(myCode, "cb", mine); // pull guest candidates for THIS call
          armConnectTimeout();
          // only the answer to THIS offer -- an answer to the previous one
          // describes a connection that no longer exists. A tokenless answer is
          // a booth still running yesterday's script; take it rather than
          // leaving that person staring at a screen that never moves.
          return poll(myCode, "answer", 300000, function (a) { return !a.tok || a.tok === mine; });
        })
        .then(function (ans) {
          setStatus(statusEl(), "Tersambung, menyiapkan sesi");
          return pc.setRemoteDescription(ans).then(flushCandidates);
        })
        .then(armConnectTimeout);
    });
  }

  function guestHandshake(first) {
    remoteReady = false; candQueue = []; candPollStop = false;
    // any offer we have not already tried -- on a rebuild that means the new one
    return poll(myCode, "offer", first ? 20000 : 120000, function (o) { return o.tok !== appliedTok; })
      .then(function (offer) {
        return needMedia().then(function () {
          appliedTok = offer.tok || "";
          genTok = appliedTok;              // our candidates belong to HIS handshake
          pc = newPC("cb");                 // guest publishes its candidates to "cb"
          return pc.setRemoteDescription(offer).then(flushCandidates)
            .then(function () {
              adoptCamLane();                            // before createAnswer, or we answer recvonly
              startCandPoll(myCode, "ca", appliedTok);   // pull host candidates for THIS call
              return pc.createAnswer();
            })
            .then(function (a) { return pc.setLocalDescription(a); })
            .then(function () { return post(myCode, "answer", withTok(pc.localDescription, appliedTok)); })
            .then(function () {
              setStatus(statusEl(), "Tersambung, menyiapkan sesi…");
              armConnectTimeout(); // the guest never armed this, so it waited in silence
            });
        });
      });
  }

  function startHost() {
    role = "host"; myCode = rid(); healN = 0; appliedTok = "";
    setStatus("#lobby-status", "Menyiapkan…");
    loadIce().then(function () { return hostHandshake(true); }).catch(handleErr);
  }

  function startJoin(code) {
    if (!code) { setStatus("#lobby-status", "Masukkan kodenya dulu.", true); return; }
    role = "guest"; myCode = code; healN = 0; appliedTok = "";
    setStatus("#lobby-status", "Menyambung ke room " + code + "…");
    loadIce().then(function () { return guestHandshake(true); }).catch(handleErr);
  }

  function showWaiting(code) {
    show("s-wait");
    $("#wait-code").textContent = code;
    // keep the query (notably ?press=) so the guest's strip is stamped with
    // the same pressing the host walked in from
    var link = location.origin + location.pathname + location.search + "#" + code;
    $("#share-link").value = link;
    refreshCamUI(); camHint();
  }
  function enterSession() {
    show("s-session");
    showSelf();
    setStatus("#session-status", "Tersambung. Atur tata letak, bingkai, dan tulisannya, lalu ambil foto.");
    refreshCamUI(); camHint(); paintSync();
  }

  // ------------------------------------------------------------ capture
  function grabVideo(v, flip) {
    var w = (v && v.videoWidth) || 640, h = (v && v.videoHeight) || 480;
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d");
    if (flip) { g.translate(w, 0); g.scale(-1, 1); }
    try { g.drawImage(v, 0, 0, w, h); } catch (e) {}
    return c;
  }

  /* HOW FAR BEHIND HER PICTURE IS.

     Two separate lags, and the booth used to ignore both.

     1. The countdown was sent and started in the same breath, so she began
        counting one-way-latency later than the shooter. Bandung to Tokyo over
        a relay is 80-200 ms; her "1" was still on screen when the shutter had
        already gone.
     2. Worse, and invisible: the frame in #remoteVideo right now is not this
        moment. It left her camera, was encoded, crossed the ocean and sat in a
        jitter buffer -- typically 150-400 ms. So the strip paired HIS face at
        the shutter with HER face a third of a second earlier. That is the
        "not same, pretty late" in the reports, and no amount of countdown
        fixing would have touched it.

     Both are measurable from getStats, so measure them and schedule around
     them rather than hoping. */
  var _rttMs = 0, _lagMs = 0;
  function sampleLag() {
    if (!pc || pc.connectionState !== "connected" || !pc.getStats) return;
    pc.getStats().then(function (s) {
      var jbDelay = 0, jbCount = 0, rtt = -1;
      s.forEach(function (r) {
        if (r.type === "inbound-rtp" && r.kind === "video") {
          jbDelay = r.jitterBufferDelay || 0;
          jbCount = r.jitterBufferEmittedCount || 0;
        }
        if (r.type === "candidate-pair" && r.nominated && typeof r.currentRoundTripTime === "number") {
          rtt = r.currentRoundTripTime;
        }
      });
      if (rtt >= 0) _rttMs = Math.round(rtt * 1000);
      // seconds of buffering per emitted frame, which is exactly how stale the
      // picture on screen is before the network is even counted
      var buf = jbCount ? (jbDelay / jbCount) * 1000 : 0;
      _lagMs = Math.max(0, Math.min(600, Math.round(buf + _rttMs / 2)));
      window.__pb = { rttMs: _rttMs, lagMs: _lagMs };   // for QA, not for her
    }).catch(function () {});
  }

  function tsText(d) {
    d = d || new Date();
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) +
      "  ·  " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  // the live preview asks every frame; the words only change once a minute
  var clockMin = -1, clockTxt = "";
  function nowText() {
    var d = new Date(), m = Math.floor(d.getTime() / 60000);
    if (m !== clockMin) { clockMin = m; clockTxt = tsText(d); }
    return clockTxt;
  }

  // ------------------------------------------------------------ the pressing you walked in from
  /* The booth lives here on Side A, but later pressings link straight to it
     (?press=005). Whichever record you walked in from is the one stamped on
     the strip, so a photo taken from month five reads YS-005 -- not YS-004.
     Anything unexpected falls back to this booth's own pressing. From month
     six the pressing also picks the frame the booth starts in (bingkai.js
     defaults), and the studio remembers choices per pressing. */
  function pressNo() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("press") || ""; } catch (e) {}
    return /^[0-9]{1,3}$/.test(q) ? ("00" + q).slice(-3) : "004";
  }
  function pressMark() { return PRESS === "026" ? "Kalung 26" : "YS-" + PRESS; }
  /* THE WAY BACK.
     The booth lives on Side A, but by month five you mostly arrive from
     somewhere else -- and the door out said "Album" and led to Side A's front
     page, which is not the building you came from. A pressing that links here
     carries ?from= (where to put you down) and ?fromname= (what to call it),
     so the door is labelled with the room you actually left. Only same-scheme
     http(s) links are honoured, so the parameter cannot become a way to point
     this button anywhere unpleasant. */
  function fromUrl() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("from") || ""; } catch (e) {}
    if (!q) return "";
    try {
      var u = new URL(q, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href;
    } catch (e) { return ""; }
  }
  function fromName() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("fromname") || ""; } catch (e) {}
    q = String(q).replace(/[<>]/g, "").trim().slice(0, 28);
    return q || "sisi sebelumnya";
  }
  /* The song of the month you came from (?song=), so walking in from the field
     does not change the music under you. Only an mp3 on one of these pressings'
     own workers is played. */
  function songUrl() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("song") || ""; } catch (e) {}
    if (!q) return "";
    try {
      var u = new URL(q, location.href);
      if (u.protocol === "https:" && /(^|\.)vanchrisjp\.workers\.dev$/.test(u.hostname) && /\.mp3$/i.test(u.pathname)) return u.href;
    } catch (e) {}
    return "";
  }
  /* Say which pressing this strip will be stamped with, before it is taken --
     the number only appeared in six-point type in the footer of a photograph
     that had already been shot. */
  function paintPress() {
    var tag = document.querySelector("header.top .tag");
    var nm = BK.pressName(PRESS);
    if (tag) tag.textContent = "Kamu & Aku · sesi berdua · " + pressMark() + (nm && PRESS !== "004" && PRESS !== "026" ? " · " + nm : "");
    if (PRESS === "026") {
      // her birthday: its own name on the door, and its night red in the browser's bar
      var brand = document.querySelector(".brand");
      if (brand) {
        brand.textContent = "Photobox ";
        var em = document.createElement("em"); em.textContent = "berdua"; brand.appendChild(em);
      }
      if (tag) tag.textContent = "Kalung 26 · ulang tahunmu, sesi berdua";
      var meta26 = document.querySelector('meta[name="theme-color"]');
      if (meta26) meta26.setAttribute("content", "#1E0807");
      document.title = "Photobox berdua · Kalung 26";
    }
    if (PRESS === "006") {
      var hh = document.querySelector(".brand .hh");
      if (hh) hh.textContent = "✿";
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#15160F");
    }
    var back = document.getElementById("backlink");
    var home = fromUrl();
    if (back && home) { back.href = home; back.textContent = "← " + fromName(); }
  }

  // ------------------------------------------------------------ the strip (bingkai.js)
  /* Every picture of every shot, for bingkai's source callback. A layout that
     asks for more shots than were taken reuses them in turn rather than
     printing an empty box (the studio also locks those layouts after a shot). */
  function pairSource(pairs) {
    return function (cell) {
      if (!pairs || !pairs.length) return null;
      var pr = pairs[cell.shot % pairs.length], cv = pr && pr[cell.who];
      if (!cv) return null;
      var mask = wantsCut() && pr.masks ? pr.masks[cell.who + maskKey()] || null : null;
      return { img: cv, w: cv.width, h: cv.height, mask: mask };
    };
  }
  function compose(pairs) {
    var p = BK.plan(studio);
    var c = document.createElement("canvas"); c.width = p.W; c.height = p.H;
    BK.draw(c.getContext("2d"), p, studio, {
      src: pairSource(pairs), filter: lookCSS(), date: tsText(shotAt), press: pressMark(),
      layer: freshLayer, wall: wallPainter(1), scale: 1, role: role || "host"
    });
    c._clear = studio.frame === "none" && studio.layout === "polaroid";   // the only strip with see-through corners
    return c;
  }
  // JPEG has no transparency: a frameless polaroid is laid on paper first
  function flat(c) {
    if (!c._clear) return c;
    var f = document.createElement("canvas"); f.width = c.width; f.height = c.height;
    var g = f.getContext("2d"); g.fillStyle = "#F4F1EA"; g.fillRect(0, 0, f.width, f.height); g.drawImage(c, 0, 0);
    return f;
  }
  /* A canvas never waits for a web font: text drawn before the face arrives is
     set in the fallback, permanently. So the chosen face is loaded first. */
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var H = BK.HURUF[studio.huruf], F = BK.FRAMES[studio.frame];
    var list = [H.style + " " + H.weight + " 32px " + H.family, "400 14px " + F.mono];
    return Promise.race([
      Promise.all(list.map(function (f) { return document.fonts.load(f).catch(function () {}); })),
      wait(2500)
    ]);
  }
  function preloadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    var list = BK.HURUF_ORDER.map(function (id) { var H = BK.HURUF[id]; return H.style + " " + H.weight + " 32px " + H.family; });
    list.push("400 14px 'Space Mono'", "400 14px 'IBM Plex Mono'");
    Promise.all(list.map(function (f) { return document.fonts.load(f).catch(function () {}); }))
      .then(function () { pvKick(); thumbsSoon(); });
  }

  // ------------------------------------------------------------ the studio's settings
  function loadStudio() {
    var d = window.Bingkai.defaults(PRESS), saved = null;
    try { saved = JSON.parse(localStorage.getItem("pb-studio-" + PRESS) || "null"); } catch (e) {}
    if (saved && typeof saved === "object") {
      for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) d[k] = saved[k];
    }
    return window.Bingkai.norm(d);
  }
  function saveStudio() { try { localStorage.setItem("pb-studio-" + PRESS, JSON.stringify(studio)); } catch (e) {} }
  function withPatch(o, patch) {
    var r = {}, k;
    for (k in o) r[k] = o[k];
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) r[k] = patch[k];
    return r;
  }

  /* ONE SET OF CHOICES FOR TWO BOOTHS.
     Whatever either of you changes is sent across, so both previews show the
     strip that will print. Each set is stamped with when it was last touched
     and the newer one wins; with nothing touched on either side, the host's
     stands. (The old look/layout messages still go out too, for a booth tab
     that is running yesterday's script -- but once the other side has spoken
     in whole sets, its old messages are ignored, or the two would swap.) */
  var OLD_LAYOUTS = /^(side|stack|strip|strip4|grid)$/;
  var peerStudio = false, sendT = 0, saveT = 0, syncFlashT = 0;
  function setStudio(patch, remote) {
    var before = studio;
    var next = BK.norm(withPatch(studio, patch));
    next.at = remote ? (Number(patch.at) || before.at) : Date.now();
    studio = next;
    clearTimeout(saveT); saveT = setTimeout(saveStudio, 250);
    applyLookToPreview(); paintStudio(); pvKick(); thumbsSoon();
    if (wantsCut() && studio.potong === "otomatis") loadCut();
    if (lastPairs && pv.mode === "result") recomposeSoon();
    if (!remote) {
      if (pv.mode === "received" && dcOpen()) { pv.pending = true; pvKick(); }
      clearTimeout(sendT);
      sendT = setTimeout(function () { sendDC({ t: "studio", v: studio }); }, 120);
      if (before.look !== studio.look) sendDC({ t: "look", v: studio.look });
      if (before.layout !== studio.layout && OLD_LAYOUTS.test(studio.layout)) sendDC({ t: "layout", v: studio.layout });
    }
  }
  function takeStudio(v) {
    var o = BK.norm(v);
    if (o.at < studio.at || (o.at === studio.at && role === "host")) return;
    if (JSON.stringify(o) === JSON.stringify(studio)) return;
    setStudio(o, true);
    var s = $("#st-sync");
    if (s) {
      s.textContent = "Barusan diubah dari layar dia ✓";
      clearTimeout(syncFlashT); syncFlashT = setTimeout(paintSync, 2600);
    }
  }
  function dcOpen() { return !!(dc && dc.readyState === "open"); }
  function paintSync() {
    var s = $("#st-sync"); if (!s) return;
    s.textContent = dcOpen() ? "Diatur di sini, ikut ke layar dia." : "Tersimpan di perangkat ini, nanti ikut ke layar dia.";
  }

  // ------------------------------------------------------------ the green screen
  /* WHO IS YOU, AND WHAT IS THE ROOM.
     Two ways to cut a person out of a camera frame:
       otomatis  MediaPipe's selfie segmenter, vendored under assets/vendor
                 (no CDN at runtime) and run here on both cameras. No green
                 cloth needed. Loaded only once a wallpaper is chosen, so a
                 booth that never uses it never downloads it.
       hijau     a real green screen, keyed pixel by pixel (Latar.chroma).
     Masks are made for the live preview a few times a second, and again, at
     full quality, for every picture that is printed. If the cutter cannot run
     on this device the studio says so and the cameras are used as they are:
     nobody is ever left out of a strip. */
  var MP = "assets/vendor/mediapipe/";
  var CUT = { state: "idle", seg: null, ready: null, note: "", live: { a: null, b: null }, key: { a: null, b: null }, t: 0 };
  function wantsCut(o) { o = o || studio; return o.latar !== "asli" || o.layout === "bareng"; }
  function maskKey() { return studio.potong === "hijau" ? "k" + studio.peka : "s"; }
  function loadCut() {
    if (CUT.ready) return CUT.ready;
    CUT.state = "loading"; paintCut();
    var imp = null;
    try { imp = new Function("u", "return import(u)"); } catch (e) {}
    if (!imp) {
      CUT.state = "failed"; CUT.note = "no dynamic import"; paintCut();
      CUT.ready = Promise.resolve(null);
      return CUT.ready;
    }
    var abs = function (p) { return new URL(MP + p, location.href).href; };
    CUT.ready = imp(abs("vision_bundle.mjs")).then(function (vision) {
      return vision.FilesetResolver.forVisionTasks(abs("wasm")).then(function (files) {
        var make = function (delegate) {
          return vision.ImageSegmenter.createFromOptions(files, {
            baseOptions: { modelAssetPath: abs("selfie_segmenter.tflite"), delegate: delegate },
            runningMode: "IMAGE", outputCategoryMask: false, outputConfidenceMasks: true
          });
        };
        return make("GPU").catch(function () { return make("CPU"); });
      });
    }).then(function (seg) {
      CUT.seg = seg; CUT.state = "ready"; paintCut(); pvKick(); thumbsSoon();
      return seg;
    }).catch(function (e) {
      CUT.state = "failed"; CUT.note = (e && e.message) || String(e); paintCut();
      return null;
    });
    return CUT.ready;
  }
  // person confidence from the segmenter, as a mask canvas (reused when given)
  function segMask(source, into) {
    if (!CUT.seg) return null;
    var out = null;
    try {
      CUT.seg.segment(source, function (res) {
        var list = res && res.confidenceMasks;
        var m = list && list[list.length - 1];   // one channel, or the person channel after background
        if (!m) return;
        var w = m.width, h = m.height, c = into || document.createElement("canvas");
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        var g = c.getContext("2d"), img = g.createImageData(w, h);
        window.Latar.alpha(m.getAsFloat32Array(), img.data);
        g.putImageData(img, 0, 0);
        out = c;
      });
    } catch (e) { CUT.note = (e && e.message) || String(e); }
    return out;
  }
  // a real green screen: the frame, keyed (at most maxW wide)
  function keyMask(source, w, h, into, maxW) {
    if (!w || !h) return null;
    var mw = Math.max(1, Math.min(maxW || 480, w)), mh = Math.max(1, Math.round(mw * h / w));
    var c = into || document.createElement("canvas");
    if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh; }
    var g = c.getContext("2d", { willReadFrequently: true });
    g.clearRect(0, 0, mw, mh);
    try { g.drawImage(source, 0, 0, mw, mh); } catch (e) { return null; }
    var img = g.getImageData(0, 0, mw, mh);
    window.Latar.chroma(img.data, studio.peka);
    g.putImageData(img, 0, 0);
    return c;
  }
  function liveMasks(now) {
    if (!wantsCut() || now - CUT.t < 100) return;
    CUT.t = now;
    var hijau = studio.potong === "hijau";
    if (!hijau) loadCut();
    [["a", selfVideo()], ["b", connected ? $("#remoteVideo") : null]].forEach(function (x) {
      var v = x[1];
      if (!v || !v.videoWidth) return;
      if (hijau) CUT.key[x[0]] = keyMask(v, v.videoWidth, v.videoHeight, CUT.key[x[0]], 320);
      else if (CUT.seg) CUT.live[x[0]] = segMask(v, CUT.live[x[0]]) || CUT.live[x[0]];
    });
  }
  function liveMaskFor(who) {
    if (!wantsCut()) return null;
    return studio.potong === "hijau" ? CUT.key[who] : CUT.live[who];
  }
  /* The printed pictures get masks of their own, at full size, made once per
     way of cutting (a green-screen mask per sensitivity). */
  function ensureMasks(pairs) {
    if (!pairs || !wantsCut()) return Promise.resolve(false);
    var key = maskKey(), hijau = studio.potong === "hijau";
    var run = function () {
      pairs.forEach(function (pr) {
        pr.masks = pr.masks || {};
        ["a", "b"].forEach(function (w) {
          var cv = pr[w], slot = w + key;
          if (!cv || pr.masks[slot]) return;
          pr.masks[slot] = hijau ? keyMask(cv, cv.width, cv.height, null, 1280) : segMask(cv, null);
        });
      });
      return true;
    };
    if (hijau) return Promise.resolve(run());
    return Promise.race([loadCut(), wait(12000)]).then(run);
  }
  var maskJob = null;
  function kickMasks(pairs) {
    if (maskJob || !pairs) return;
    var key = maskKey();
    var done = pairs.every(function (pr) { return pr.masks && pr.masks["a" + key] && pr.masks["b" + key]; });
    if (done || (studio.potong !== "hijau" && CUT.state === "failed")) return;
    maskJob = ensureMasks(pairs).then(function () { maskJob = null; pvKick(); }, function () { maskJob = null; });
  }
  function paintCut() {
    var el = $("#st-cut-state"); if (!el) return;
    var t;
    if (!wantsCut()) t = "Asli: kamera apa adanya. Pilih latar, kalian dipotong dari kamera masing-masing dan berdiri di depannya.";
    else if (studio.potong === "hijau") t = "Layar hijau beneran: yang hijau di belakang kamu jadi latar. Naikkan kepekaan kalau masih ada sisa hijau.";
    else if (CUT.state === "ready") t = "Pemotong otomatis siap ✓ Nggak perlu kain hijau.";
    else if (CUT.state === "failed") t = "Pemotong otomatis nggak jalan di perangkat ini, jadi kameranya dipakai apa adanya. Pakai layar hijau beneran kalau ada.";
    else t = "Nyiapin pemotong otomatis… sekali aja, sekitar 12 MB.";
    if (el.textContent !== t) el.textContent = t;
    el.classList.toggle("err", CUT.state === "failed" && studio.potong !== "hijau" && wantsCut());
  }

  // ------------------------------------------------------------ wallpapers
  /* The wallpaper is drawn by latar.js at the size it is needed and kept, so
     the preview does not repaint a field of flowers twelve times a second.
     "Foto sendiri" is a picture from this device's gallery: downscaled, kept
     on the device, and sent to the other booth down the data channel so both
     previews stand in the same room. */
  var wallImg = null, wallBlob = null, wallKey = "", wallMine = false, wallCache = {}, wallCacheN = 0;
  function wallId() {
    var id = studio.latar;
    if (id === "asli") id = PRESS === "006" ? "ladang" : PRESS === "026" ? "malam26" : "studio";   // "Satu tempat" always needs a room
    if (id === "foto" && !(wallImg && studio.wallKey === wallKey)) id = "studio";
    return id;
  }
  function wallPainter(sc) {
    return function (g, x, y, w, h) {
      var id = wallId(), pw = Math.max(1, Math.round(w * sc)), ph = Math.max(1, Math.round(h * sc));
      var key = id + (id === "foto" ? wallKey : "") + "|" + pw + "x" + ph, c = wallCache[key];
      if (!c) {
        if (++wallCacheN > 40) { wallCache = {}; wallCacheN = 1; }
        c = document.createElement("canvas"); c.width = pw; c.height = ph;
        window.Latar.draw(c.getContext("2d"), id, 0, 0, pw, ph, wallImg);
        wallCache[key] = c;
      }
      g.drawImage(c, x, y, w, h);
    };
  }
  function freshLayer(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  // the preview and the cards reuse their layers frame after frame
  function layerPool() {
    var pool = [], i = 0;
    var take = function (w, h) {
      var c = pool[i] || (pool[i] = document.createElement("canvas"));
      i++;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      else {
        var g = c.getContext("2d");
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over";
        try { g.filter = "none"; } catch (e) {}
        g.clearRect(0, 0, w, h);
      }
      return c;
    };
    take.reset = function () { i = 0; };
    return take;
  }
  var pvLayers = layerPool(), thumbLayers = layerPool();
  function useWall(blob, key, mine) {
    wallBlob = blob; wallKey = key; wallMine = !!mine;
    var u = URL.createObjectURL(blob), im = new Image();
    im.onload = function () { wallImg = im; wallCache = {}; wallCacheN = 0; pvKick(); thumbsSoon(); paintWallCards(true); };
    im.src = u;
  }
  function pickWall(file) {
    if (!file || !/^image\//.test(file.type || "")) return;
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (blob) {
        if (!blob) return;
        var key = "w" + Date.now().toString(36);
        useWall(blob, key, true);
        setStudio({ latar: "foto", wallKey: key });
        sendWall();
        keepWall(blob, key);
      }, "image/jpeg", 0.86);
    };
    im.onerror = function () { URL.revokeObjectURL(url); setStatus(statusEl(), "Fotonya nggak kebaca. Coba foto lain.", true); };
    im.src = url;
  }
  function keepWall(blob, key) {
    try {
      var fr = new FileReader();
      fr.onload = function () { try { localStorage.setItem("pb-wall-" + PRESS, JSON.stringify({ key: key, data: fr.result })); } catch (e) {} };
      fr.readAsDataURL(blob);
    } catch (e) {}
  }
  function restoreWall() {
    try {
      var j = JSON.parse(localStorage.getItem("pb-wall-" + PRESS) || "null");
      if (!j || typeof j.data !== "string" || !/^[a-z0-9]{1,24}$/.test(j.key || "")) return;
      fetch(j.data).then(function (r) { return r.blob(); }).then(function (b) { useWall(b, j.key, true); }).catch(function () {});
    } catch (e) {}
  }
  function sendWall() {
    if (!wallBlob || !wallMine || !dcOpen()) return;
    var key = wallKey, blob = wallBlob;
    blob.arrayBuffer().then(function (buf) {
      sendBinary({ t: "wall", size: buf.byteLength, mime: blob.type || "image/jpeg", key: key }, buf, function () { return key === wallKey; });
    });
  }
  function paintWallCards(force) {
    document.querySelectorAll("#st-walls canvas").forEach(function (cv) {
      var id = cv.getAttribute("data-id");
      if (cv._drawn && !(force && id === "foto")) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = cv.clientWidth || 104, h = cv.clientHeight || 74;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      var g = cv.getContext("2d"), W = cv.width, H = cv.height;
      if (id === "asli") {
        g.fillStyle = "#2A2724"; g.fillRect(0, 0, W, H);
        g.strokeStyle = "#F2EDE3"; g.lineWidth = Math.max(1, H * 0.03);
        g.strokeRect(W * 0.3, H * 0.3, W * 0.4, H * 0.42);
        g.beginPath(); g.arc(W * 0.5, H * 0.51, H * 0.12, 0, Math.PI * 2); g.stroke();
      } else if (id === "foto" && !wallImg) {
        g.fillStyle = "#2A2724"; g.fillRect(0, 0, W, H);
        g.strokeStyle = "rgba(242,237,227,0.6)"; g.setLineDash([H * 0.06, H * 0.05]); g.lineWidth = Math.max(1, H * 0.025);
        g.strokeRect(W * 0.12, H * 0.14, W * 0.76, H * 0.72); g.setLineDash([]);
        g.fillStyle = "#F2EDE3"; g.fillRect(W * 0.5 - H * 0.02, H * 0.34, H * 0.04, H * 0.32); g.fillRect(W * 0.5 - H * 0.16, H * 0.48, H * 0.32, H * 0.04);
      } else window.Latar.draw(g, id, 0, 0, W, H, wallImg);
      cv._drawn = cv.clientWidth > 0;
    });
  }

  // ------------------------------------------------------------ the live preview
  /* The strip as it will print, redrawn from both cameras about twelve times a
     second -- the same bingkai.draw as the print, on a context scaled down to
     the screen. While shooting, pictures already taken hold still and the next
     shot is outlined; afterwards it is the result, which stays editable. */
  var pv = { mode: "live", img: null, raf: 0, idle: 0, last: 0, dirty: true, pending: false, boxW: 0 };
  var shootPairs = null, shotIdx = -1;
  /* The mirror on the screen that is showing. Both <video>s hold the same
     camera, but the one on a hidden screen reports its size and paints black. */
  function selfVideo() {
    var list = [$("#selfVideo"), $("#selfPreview")];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v && v.videoWidth && v.offsetParent !== null) return v;
    }
    return null;
  }
  function liveSource(cell) {
    var pr = shootPairs && shootPairs[cell.shot], cv = pr && pr[cell.who];
    if (cv) return { img: cv, w: cv.width, h: cv.height, mask: pr.masks && wantsCut() ? pr.masks[cell.who + maskKey()] || null : null };
    var v = cell.who === "a" ? selfVideo() : (connected ? $("#remoteVideo") : null);
    if (v && v.videoWidth) return { img: v, w: v.videoWidth, h: v.videoHeight, flip: cell.who === "a", mask: liveMaskFor(cell.who) };
    return null;
  }
  function studioShown() {
    var st = $("#studio");
    return !!(st && st.parentNode && st.parentNode.id !== "studio-home");
  }
  function pvKick() {
    pv.dirty = true;
    if (!pv.raf) pv.raf = requestAnimationFrame(pvFrame);
  }
  function pvFrame(t) {
    pv.raf = 0;
    if (!studioShown()) return;
    var rv = $("#remoteVideo");
    var moving = pv.mode === "live" && !!(selfVideo() || (connected && rv && rv.videoWidth));
    if (pv.dirty || (moving && t - pv.last > 80)) { if (moving) liveMasks(t); pvRender(); pv.last = t; pv.dirty = false; }
    if (moving) pv.raf = requestAnimationFrame(pvFrame);
    else if (pv.mode === "live" && !pv.idle) pv.idle = setTimeout(function () { pv.idle = 0; pvKick(); }, 1000);
  }
  function measureBox() {
    var box = $(".st-canvasbox"); if (!box) return;
    var cs = window.getComputedStyle(box);
    pv.boxW = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }
  function pvRender() {
    var cv = $("#pv"); if (!cv) return;
    if (!pv.boxW) measureBox();
    var received = pv.mode === "received" && pv.img;
    var p = received ? null : BK.plan(studio);
    var W0 = received ? pv.img.naturalWidth : p.W, H0 = received ? pv.img.naturalHeight : p.H;
    pv.W0 = W0;
    var availW = Math.max(120, pv.boxW || 320), availH = Math.max(240, Math.min(window.innerHeight * 0.7, 820));
    var s = Math.min(availW / W0, availH / H0), dpr = Math.min(2, window.devicePixelRatio || 1);
    var cssW = Math.max(1, Math.round(W0 * s)), cssH = Math.max(1, Math.round(H0 * s));
    var bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    if (cv.style.width !== cssW + "px" || cv.style.height !== cssH + "px") { cv.style.width = cssW + "px"; cv.style.height = cssH + "px"; }
    var g = cv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    if (received) {
      pv.hits = [];
      g.drawImage(pv.img, 0, 0, bw, bh);
    } else {
      var k = bw / W0;
      g.setTransform(k, 0, 0, k, 0, 0);
      pvLayers.reset();
      if (pv.mode === "result" && wantsCut() && lastPairs) kickMasks(lastPairs);
      BK.draw(g, p, studio, {
        src: pv.mode === "result" ? pairSource(lastPairs) : liveSource,
        filter: lookCSS(), press: pressMark(),
        date: pv.mode === "result" ? tsText(shotAt) : nowText(),
        hot: shooting ? shotIdx : -1,
        layer: pvLayers, wall: wallPainter(k), scale: k, role: role || "host", hits: (pv.hits = [])
      });
    }
    paintDims(p);
  }
  var dimTxt = null, stateTxt = null;
  function paintDims(p) {
    var dim = p ? p.W + " × " + p.H + " px · " + p.shots + " jepretan"
      : (pv.img ? pv.img.naturalWidth + " × " + pv.img.naturalHeight + " px" : "");
    var st, live = false;
    if (shooting) st = "Jepretan " + (shotIdx + 1) + " dari " + (p ? p.shots : "?");
    else if (pv.mode === "result") st = "Hasil · masih bisa diganti";
    else if (pv.mode === "received") st = pv.pending ? "Nunggu versi baru dari dia…" : "Hasil dari dia";
    else { st = "Pratinjau langsung"; live = true; }
    if (dim !== dimTxt) { dimTxt = dim; var d = $("#pv-dim"); if (d) d.textContent = dim; }
    if (st !== stateTxt) {
      stateTxt = st;
      var e = $("#pv-state");
      if (e) { e.textContent = st; e.className = live ? "live" : ""; }
    }
  }

  // ------------------------------------------------------------ the cards you choose from
  var thumbT = 0;
  function thumbsSoon() { clearTimeout(thumbT); thumbT = setTimeout(paintThumbs, 60); }
  function paintThumbs() {
    if (!studioShown()) return;
    paintWallCards(false);
    document.querySelectorAll("#st-layouts canvas").forEach(function (cv) {
      if (cv.offsetParent === null) return;
      thumb(cv, withPatch(studio, { layout: cv.getAttribute("data-id") }));
    });
    document.querySelectorAll("#st-frames canvas").forEach(function (cv) {
      if (cv.offsetParent === null) return;
      thumb(cv, BK.pakai(studio, cv.getAttribute("data-id")));
    });
  }
  function thumb(cv, o) {
    var p = BK.plan(o), dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = cv.clientWidth || 104, h = cv.clientHeight || 74;
    var bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    var g = cv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh);
    var s = Math.min(bw / p.W, bh / p.H) * 0.92;
    g.setTransform(s, 0, 0, s, (bw - p.W * s) / 2, (bh - p.H * s) / 2);
    thumbLayers.reset();
    BK.draw(g, p, o, { thumb: true, press: pressMark(), date: "", layer: thumbLayers, wall: wallPainter(s), scale: s, role: role || "host" });
  }

  function buildStudio() {
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function card(host, id, name, note, attr, onPick) {
      var b = el("button", "st-card"); b.type = "button"; b.setAttribute(attr, id); b.setAttribute("aria-pressed", "false");
      var cv = el("canvas"); cv.setAttribute("data-id", id); cv.setAttribute("aria-hidden", "true");
      b.appendChild(cv); b.appendChild(el("b", null, name));
      if (note) b.appendChild(el("i", null, note));
      b.addEventListener("click", onPick);
      host.appendChild(b);
    }
    var lays = $("#st-layouts");
    (BK.layoutOrder ? BK.layoutOrder(PRESS) : BK.LAYOUTS).forEach(function (L) {
      card(lays, L.id, L.name, L.note, "data-layout", function () {
        // standing together needs a room: an untouched "Asli" gets this pressing's wallpaper
        if (L.id === "bareng" && studio.latar === "asli") setStudio({ layout: L.id, latar: PRESS === "006" ? "ladang" : PRESS === "026" ? "malam26" : "studio" });
        else setStudio({ layout: L.id });
      });
    });
    var FRAME_NOTE = { ladang: "YS-006", sisia: "YS-004", kafe: "YS-005", salju: "dingin, bersih", film: "roll film", putih: "galeri", none: "foto sampai tepi",
      kalung26: "11.10.2026", mawar: "mawar & kelopak", surat: "Tokyo ke Bandung", langit: "bulan & bintang", pesta: "bendera & konfeti", hati: "hati di mana-mana" };
    var frs = $("#st-frames");
    (BK.frameOrder ? BK.frameOrder(PRESS) : BK.FRAME_ORDER).forEach(function (id) {
      card(frs, id, BK.FRAMES[id].name, FRAME_NOTE[id], "data-frame", function () { setStudio(BK.pakai(studio, id)); });
    });

    function chips(key, items) {
      var row = document.querySelector('.st-chips[data-key="' + key + '"]'); if (!row) return;
      items.forEach(function (it) {
        var b = el("button", "chip", it.name); b.type = "button";
        b.setAttribute("data-val", String(it.id)); b.setAttribute("aria-pressed", "false");
        if (it.font) { b.style.fontFamily = it.font.family; b.style.fontWeight = it.font.weight; b.style.fontStyle = it.font.style; }
        b.addEventListener("click", function () { var o = {}; o[key] = it.id; setStudio(o); });
        row.appendChild(b);
      });
    }
    chips("n", [1, 2, 3, 4].map(function (k) { return { id: k, name: k + " jepretan" }; }));
    chips("susun", BK.SUSUN);
    chips("rasio", BK.RASIO_ORDER.map(function (r) {
      return { id: r, name: r + ({ "4:3": " · lebar", "1:1": " · kotak", "3:4": " · tegak", "16:9": " · sinema" })[r] };
    }));
    chips("posisi", BK.POSISI);
    chips("huruf", BK.HURUF_ORDER.map(function (id) { return { id: id, name: BK.HURUF[id].name, font: BK.HURUF[id] }; }));
    chips("hitung", [3, 5, 10].map(function (k) { return { id: k, name: k + " detik" }; }));
    chips("potong", [{ id: "otomatis", name: "Otomatis" }, { id: "hijau", name: "Layar hijau beneran" }]);

    var walls = $("#st-walls"), file = $("#st-wall-file");
    if (walls) window.Latar.LIST.forEach(function (Lt) {
      card(walls, Lt.id, Lt.name, Lt.note, "data-wall", function () {
        if (Lt.id === "foto" && !(wallImg && wallKey)) { if (file) file.click(); return; }
        var patch = { latar: Lt.id };
        if (Lt.id === "foto") patch.wallKey = wallKey;
        setStudio(patch);
      });
    });
    if (file) file.addEventListener("change", function () { pickWall(file.files && file.files[0]); file.value = ""; });
    var change = $("#st-wall-change");
    if (change) change.addEventListener("click", function () { if (file) file.click(); });
    /* Sizes and who stands in front belong to the person: besarH is the host's,
       besarG the guest's. "Kamu" on this screen is whichever this booth is. */
    document.querySelectorAll("[data-person]").forEach(function (r) {
      r.addEventListener("input", function () {
        var guest = role === "guest", mine = r.getAttribute("data-person") === "kamu", o = {};
        o[mine === guest ? "besarG" : "besarH"] = Number(r.value);
        setStudio(o);
      });
    });
    var depan = $("#st-depan");
    if (depan) [["kamu", "Kamu di depan"], ["dia", "Dia di depan"]].forEach(function (x) {
      var b = el("button", "chip", x[1]); b.type = "button";
      b.setAttribute("data-depan", x[0]); b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { setStudio({ depan: (x[0] === "kamu") === (role === "guest") ? "G" : "H" }); });
      depan.appendChild(b);
    });

    /* DRAG YOURSELVES. With a wallpaper behind you, either of you can take hold
       of either person in the preview and move them. The drawing says where each
       person stands (bingkai's hits); a drag turns into geserH / geserG, a share
       of that person's picture, and rides with the rest of the studio to the
       other booth, where the newer set wins. On the guest's screen the sideways
       step is mirrored, as bingkai draws it. */
    var cvp = $("#pv");
    if (cvp) {
      var drag = null;
      var planAt = function (e) {
        var r = cvp.getBoundingClientRect();
        if (!r.width || !pv.W0) return null;
        var k = pv.W0 / r.width;
        return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
      };
      var personAt = function (pt) {
        var list = pv.hits || [];
        for (var i = list.length - 1; i >= 0; i--) {         // the one drawn last is in front
          // a person stands in the middle of their camera picture, not across all of it: the sky beside them is nobody
          var h = list[i], l = Math.max(h.x, h.bx + h.bw * 0.22), r = Math.min(h.x + h.w, h.bx + h.bw * 0.78);
          var t = Math.max(h.y, h.by + h.bh * 0.08), b = h.y + h.h;
          if (pt.x >= l && pt.x <= r && pt.y >= t && pt.y <= b) return h;
        }
        return null;
      };
      var canDrag = function () { return pv.mode !== "received" && wantsCut() && !shooting; };
      cvp.addEventListener("pointerdown", function (e) {
        if (!canDrag()) return;
        var pt = planAt(e), h = pt && personAt(pt);
        if (!h) return;
        var guestPerson = (h.who === "a") === (role === "guest");
        var kx = guestPerson ? "geserGX" : "geserHX", ky = guestPerson ? "geserGY" : "geserHY";
        drag = { id: e.pointerId, x: pt.x, y: pt.y, aw: h.aw, ah: h.ah, kx: kx, ky: ky, sx: studio[kx], sy: studio[ky] };
        try { cvp.setPointerCapture(e.pointerId); } catch (x) {}
        cvp.classList.add("is-dragging");
        e.preventDefault();
      });
      cvp.addEventListener("pointermove", function (e) {
        var pt = planAt(e);
        if (!pt) return;
        if (!drag) { cvp.style.cursor = canDrag() && personAt(pt) ? "grab" : ""; return; }
        if (e.pointerId !== drag.id) return;
        var mirror = role === "guest" ? -1 : 1, o = {};
        o[drag.kx] = Math.round(drag.sx + (pt.x - drag.x) / drag.aw * 100 * mirror);
        o[drag.ky] = Math.round(drag.sy + (pt.y - drag.y) / drag.ah * 100);
        if (o[drag.kx] !== studio[drag.kx] || o[drag.ky] !== studio[drag.ky]) setStudio(o);
      });
      var letGo = function (e) {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        drag = null;
        cvp.classList.remove("is-dragging");
      };
      cvp.addEventListener("pointerup", letGo);
      cvp.addEventListener("pointercancel", letGo);
      cvp.addEventListener("lostpointercapture", letGo);
    }
    var geserReset = $("#st-geser-reset");
    if (geserReset) geserReset.addEventListener("click", function () { setStudio({ geserHX: 0, geserHY: 0, geserGX: 0, geserGY: 0 }); });

    var lookRow = document.querySelector(".looks");
    if (lookRow) (PRESS === "026" ? LOOK_026.filter(function (k) { return LOOKS[k]; }) : Object.keys(LOOKS)).forEach(function (k) {
      var b = el("button", "chip", LOOKS[k].name); b.type = "button";
      b.setAttribute("data-look", k); b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { setStudio({ look: k }); });
      lookRow.appendChild(b);
    });

    document.querySelectorAll("#studio [data-flag]").forEach(function (b) {
      b.addEventListener("click", function () {
        var o = {}, f = b.getAttribute("data-flag"); o[f] = !studio[f]; setStudio(o);
      });
    });
    document.querySelectorAll(".st-range[data-key]").forEach(function (r) {
      r.addEventListener("input", function () { var o = {}; o[r.getAttribute("data-key")] = Number(r.value); setStudio(o); });
    });

    var sw = $("#st-warna");
    if (sw) {
      var own = el("button", "own", "Bawaan"); own.type = "button"; own.setAttribute("data-warna", "");
      sw.appendChild(own);
      BK.WARNA.forEach(function (hex) {
        var b = el("button"); b.type = "button"; b.setAttribute("data-warna", hex.toLowerCase());
        b.style.background = hex; b.setAttribute("aria-label", "Kertas " + hex);
        sw.appendChild(b);
      });
      var lab = el("label"); lab.title = "Warna sendiri";
      var pick = el("input"); pick.type = "color"; pick.id = "st-warna-own"; pick.setAttribute("aria-label", "Warna kertas sendiri");
      lab.appendChild(pick); sw.appendChild(lab);
      sw.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button[data-warna]") : null;
        if (b) setStudio({ warna: b.getAttribute("data-warna") });
      });
      pick.addEventListener("input", function () { setStudio({ warna: pick.value }); });
    }

    var tx = $("#st-teks");
    if (tx) tx.addEventListener("input", function () { setStudio({ teks: tx.value }); });
    var pr = $("#st-presets");
    if (pr) BK.presets(PRESS).forEach(function (s) {
      var b = el("button", "chip", s); b.type = "button"; b.style.textTransform = "none";
      b.setAttribute("data-teks", s); b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        setStudio({ teks: s, posisi: studio.posisi === "tanpa" ? "bawah" : studio.posisi });
      });
      pr.appendChild(b);
    });

    document.querySelectorAll(".st-tabs [data-tab]").forEach(function (t) {
      t.addEventListener("click", function () {
        document.querySelectorAll(".st-tabs [data-tab]").forEach(function (x) {
          x.setAttribute("aria-selected", x === t ? "true" : "false");
        });
        document.querySelectorAll(".st-pane").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== t.getAttribute("data-tab"); });
        thumbsSoon();
      });
    });
    var reset = $("#st-reset");
    if (reset) reset.addEventListener("click", function () { setStudio(BK.defaults(PRESS)); });
  }

  var UNIT = { tebal: " px", jarak: " px", sudut: " px", ukuran: "%", jarakOrang: "%", peka: "", tepi: "" };
  function paintStudio() {
    var none = studio.frame === "none";
    var taken = pv.mode === "result" && lastPairs ? lastPairs.length : 0;
    document.querySelectorAll("#st-layouts .st-card").forEach(function (b) {
      var id = b.getAttribute("data-layout");
      b.setAttribute("aria-pressed", id === studio.layout ? "true" : "false");
      var need = taken ? BK.plan(withPatch(studio, { layout: id })).shots : 0;
      var lock = shooting ? id !== studio.layout : (taken && need > taken);
      b.disabled = !!lock;
      b.title = lock && !shooting ? "Perlu " + need + " jepretan — ambil lagi dulu" : "";
    });
    document.querySelectorAll("#st-frames .st-card").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-frame") === studio.frame ? "true" : "false");
    });
    document.querySelectorAll(".st-chips[data-key]").forEach(function (row) {
      var key = row.getAttribute("data-key");
      row.querySelectorAll(".chip").forEach(function (b) {
        var val = b.getAttribute("data-val");
        b.setAttribute("aria-pressed", String(studio[key]) === val ? "true" : "false");
        if (key === "n") b.disabled = shooting || !!(taken && Number(val) > taken);
        if (key === "susun") b.disabled = shooting;
        if (key === "posisi" && val === "atas") b.disabled = studio.layout === "polaroid";
      });
    });
    document.querySelectorAll(".chip[data-look]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-look") === studio.look ? "true" : "false");
    });
    document.querySelectorAll("#studio [data-flag]").forEach(function (b) {
      var f = b.getAttribute("data-flag");
      b.setAttribute("aria-pressed", studio[f] ? "true" : "false");
      if (f === "hiasan") b.disabled = none || !BK.FRAMES[studio.frame].decor;
      if (f === "garis") b.disabled = none || studio.layout === "polaroid" || !BK.FRAMES[studio.frame].line;
    });
    document.querySelectorAll(".st-range[data-key]").forEach(function (r) {
      var key = r.getAttribute("data-key");
      if (document.activeElement !== r) r.value = studio[key];
      var frameOnly = /^(tebal|jarak|sudut)$/.test(key);
      r.disabled = none && frameOnly;
      var out = $("#o-" + key);
      if (out) out.textContent = none && frameOnly ? "tanpa bingkai" : studio[key] + (UNIT[key] || "");
    });
    var nn = $("#st-none-note"); if (nn) nn.hidden = !none;
    var ku = $("#st-kustom"); if (ku) ku.hidden = studio.layout !== "kustom";
    var tx = $("#st-teks");
    if (tx && document.activeElement !== tx) tx.value = studio.teks;
    var ot = $("#o-teks"); if (ot) ot.textContent = studio.teks.length + "/48";
    document.querySelectorAll("#st-presets [data-teks]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-teks") === studio.teks ? "true" : "false");
    });
    document.querySelectorAll("#st-warna [data-warna]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-warna") === studio.warna ? "true" : "false");
    });
    var pick = $("#st-warna-own");
    if (pick && document.activeElement !== pick) pick.value = studio.warna || BK.FRAMES[studio.frame].paper || "#ffffff";
    document.querySelectorAll("#st-walls [data-wall]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-wall") === studio.latar ? "true" : "false");
    });
    var hj = $("#st-hijau"); if (hj) hj.hidden = studio.potong !== "hijau";
    var br = $("#st-bareng"); if (br) br.hidden = studio.layout !== "bareng";
    var gs = $("#st-geser"); if (gs) gs.hidden = !wantsCut();
    var grs = $("#st-geser-reset"); if (grs) grs.disabled = !(studio.geserHX || studio.geserHY || studio.geserGX || studio.geserGY);
    var pvc = $("#pv"); if (pvc) pvc.style.touchAction = wantsCut() ? "none" : "";   // a finger on a person drags, not scrolls
    var chg = $("#st-wall-change"); if (chg) chg.hidden = studio.latar !== "foto";
    var guest = role === "guest";
    [["kamu", guest ? "besarG" : "besarH"], ["dia", guest ? "besarH" : "besarG"]].forEach(function (x) {
      var r = document.querySelector('[data-person="' + x[0] + '"]'); if (!r) return;
      if (document.activeElement !== r) r.value = studio[x[1]];
      var out = $("#o-besar-" + x[0]); if (out) out.textContent = studio[x[1]] + "%";
    });
    var kamuFront = (studio.depan === "G") === guest;
    document.querySelectorAll("#st-depan [data-depan]").forEach(function (b) {
      b.setAttribute("aria-pressed", (b.getAttribute("data-depan") === "kamu") === kamuFront ? "true" : "false");
    });
    paintCut();
    var note = $("#shoot-note");
    if (note) {
      var n = BK.plan(studio).shots;
      note.textContent = n + " jepretan · hitung mundur " + studio.hitung + " detik" + (n > 1 ? " tiap jepretan" : "");
    }
    paintSync();
  }

  // the studio is one element, carried to whichever screen is showing
  function mountStudio(screenId) {
    var st = $("#studio"), home = $("#studio-home");
    if (!st || !home) return;
    var name = { "s-lobby": "lobby", "s-wait": "wait", "s-session": "session" }[screenId] || "";
    var slot = name ? document.querySelector('.studio-slot[data-slot="' + name + '"]') : null;
    if (slot && slot.hidden) slot = null;
    var target = slot || home;
    if (st.parentNode !== target) target.appendChild(st);
    if (slot) { measureBox(); paintStudio(); thumbsSoon(); pvKick(); }
  }

  // ------------------------------------------------------------ countdown + the other booth
  function doCountdown(from) {
    var el = $("#count"), n = $("#count-n");
    el.classList.add("on");
    return (function step(k) {
      if (k < 1) { el.classList.remove("on"); return Promise.resolve(); }
      n.textContent = k; n.style.animation = "none"; void n.offsetWidth; n.style.animation = "";
      return wait(850).then(function () { return step(k - 1); });
    })(from);
  }
  // data channel: peer messages sync the countdown so both pose at the same time
  function setupDC(ch) {
    peerStudio = false;
    ch.onmessage = function (e) {
      // binary frames are strip chunks, not messages
      if (typeof e.data !== "string") {
        if (rx) {
          rx.parts.push(e.data);
          rx.got += e.data.byteLength || 0;
          if (rx.size && rx.kind === "shot") {
            setStatus("#session-status", "Menerima hasil foto… " +
              Math.min(100, Math.round((rx.got / rx.size) * 100)) + "%");
          }
        }
        return;
      }
      var m; try { m = JSON.parse(e.data); } catch (er) { return; }
      if (!m) return;
      if (m.t === "cd") guestCountdown(m.n || 3); // partner started a shot -- count down here too
      if (m.t === "studio" && m.v && typeof m.v === "object") { peerStudio = true; takeStudio(m.v); }
      // a booth on yesterday's script only speaks these two
      if (m.t === "look" && LOOKS[m.v] && !peerStudio) setStudio({ look: m.v }, true);
      if (m.t === "layout" && m.v && !peerStudio) setStudio({ layout: m.v }, true);
      if (m.t === "shot" || m.t === "wall") {
        rx = { kind: m.t, size: m.size || 0, mime: m.mime || "image/jpeg", parts: [], got: 0, key: String(m.key || "") };
        if (m.t === "shot") setStatus("#session-status", "Menerima hasil foto…");
      }
      if (m.t === "walldone" && rx && rx.kind === "wall") {
        if (/^[a-z0-9]{1,24}$/.test(rx.key)) useWall(new Blob(rx.parts, { type: rx.mime }), rx.key, false);
        rx = null;
      }
      if (m.t === "shotdone" && rx && rx.kind === "shot") {
        var blob = new Blob(rx.parts, { type: rx.mime });
        lastBlob = blob; lastMime = rx.mime; lastCanvas = null; lastPairs = null;
        if (rxUrl) URL.revokeObjectURL(rxUrl);
        rxUrl = URL.createObjectURL(blob);
        showReceived(rxUrl);
        setStatus("#session-status", "Hasil foto dari pasanganmu ✓");
        rx = null;
      }
    };
    ch.binaryType = "arraybuffer";
    /* Whoever opens the channel says what it already has chosen, so a frame
       picked before the other one arrived is not lost. The answering side's
       channel is often open before this handler exists, so check, not wait. */
    var hello = function () {
      sendDC({ t: "studio", v: studio });
      sendDC({ t: "look", v: studio.look });
      if (OLD_LAYOUTS.test(studio.layout)) sendDC({ t: "layout", v: studio.layout });
      sendWall();
      paintSync();
    };
    ch.onopen = hello;
    ch.onclose = paintSync;
    if (ch.readyState === "open") hello();
  }
  function sendDC(obj) { try { if (dc && dc.readyState === "open") dc.send(JSON.stringify(obj)); } catch (e) {} }

  /* Taking the photo together and then only ONE of you seeing it is the wrong
     ending. The shooter sends the finished strip straight down the same data
     channel the countdown already uses, so it lands on both screens.
     JPEG rather than the PNG original: a quarter of the bytes over a link
     that may be crossing an ocean, and indistinguishable at this size.
     The frame can change after the shot, so a strip can be sent again; each
     sending has a number, and one that is overtaken stops mid-stream rather
     than interleaving its chunks with the newer one. */
  /* One binary transfer at a time -- a strip and a wallpaper sent in the same
     second must not interleave their chunks, because a chunk does not say
     which picture it belongs to. A transfer that is overtaken (alive() turns
     false) stops mid-stream; the next header resets the other side. */
  var txQueue = Promise.resolve();
  function sendBinary(head, buf, alive) {
    txQueue = txQueue.then(function () {
      return new Promise(function (done) {
        if (!dcOpen() || !alive()) { done(); return; }
        sendDC(head);
        var off = 0;
        (function pump() {
          if (!dcOpen() || !alive()) { done(); return; }
          while (off < buf.byteLength) {
            // let the channel drain rather than burying it and losing the tail
            if (dc.bufferedAmount > 512 * 1024) { setTimeout(pump, 50); return; }
            try { dc.send(buf.slice(off, off + CHUNK)); } catch (e) { done(); return; }
            off += CHUNK;
          }
          sendDC({ t: head.t + "done", gen: head.gen, key: head.key });
          done();
        })();
      });
    });
  }
  var shareGen = 0;
  function shareShot(canvas) {
    if (!dcOpen() || !canvas.toBlob) return;
    var gen = ++shareGen;
    flat(canvas).toBlob(function (blob) {
      if (!blob || gen !== shareGen) return;
      blob.arrayBuffer().then(function (buf) {
        sendBinary({ t: "shot", size: buf.byteLength, mime: blob.type || "image/jpeg", gen: gen }, buf, function () { return gen === shareGen; });
      });
    }, "image/jpeg", 0.92);
  }
  var recT = 0;
  function recomposeSoon() {
    clearTimeout(recT);
    recT = setTimeout(function () {
      if (!lastPairs) return;
      fontsReady().then(function () { return ensureMasks(lastPairs); }).then(function () {
        if (!lastPairs) return;
        lastCanvas = compose(lastPairs); lastBlob = null; lastMime = "image/png";
        shareShot(lastCanvas);
      });
    }, 500);
  }

  function resultUI(shared) {
    var r = $("#result"); if (!r) return;
    r.classList.add("on");
    var tag = $("#result-tag");
    if (tag) tag.textContent = shared
      ? "Hasil · dari pasanganmu — ganti bingkai atau tulisannya, versi barunya dikirim ulang"
      : "Hasil — bingkai, tulisan, dan warnanya masih bisa diganti sebelum disimpan";
    var save = $("#save-album-btn");
    // only the one who pressed the shutter files it, so the album gets one copy
    if (save) { save.disabled = !!shared; save.title = shared ? "Yang motret yang nyimpen ke album" : ""; }
    paintStudio();
    var view = $(".st-view");
    if (view && view.scrollIntoView) view.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function showReceived(url) {
    var img = new Image();
    img.onload = function () { pv.img = img; pv.mode = "received"; pv.pending = false; pvKick(); };
    img.src = url;
    resultUI(true);
  }
  function guestCountdown(from) {
    if (guestCounting || shooting) return; // don't stack with our own capture
    guestCounting = true;
    doCountdown(from || 3).then(function () { guestCounting = false; });
  }

  function runSession() {
    if (shooting || !connected) return;
    // half a strip is not a keepsake -- say so instead of printing a black box
    if (!haveCam()) {
      setStatus("#session-status", "Kameramu belum nyala — pencet “Nyalakan kamera” dulu ya, biar fotonya nggak setengah kosong.", true);
      return;
    }
    shooting = true;
    $("#shoot-btn").disabled = true;
    $("#result").classList.remove("on");
    lastPairs = null; pv.mode = "live"; pv.img = null; pv.pending = false;
    var n = shotCount(), secs = studio.hitung;
    var pairs = [];
    shootPairs = pairs; shotIdx = 0; shotAt = new Date();
    paintStudio(); pvKick();
    fontsReady().then(function () {
      return (function loop(i) {
        if (i >= n) return Promise.resolve();
        shotIdx = i; pvKick();
        sampleLag();
        sendDC({ t: "cd", n: secs });            // she starts the moment this lands
        /* ...which is one-way-latency from now, so wait that long before
           starting ours. Both countdowns then run against the same wall clock
           and both of you hit "1" together. */
        var lead = Math.min(300, Math.round(_rttMs / 2));
        return wait(lead).then(function () { return doCountdown(secs); }).then(function () {
          /* THE SHUTTER, ALIGNED.
             Take our own frame at the instant of GO. Her frame of that same
             instant has not arrived yet -- it is still in flight and in the
             jitter buffer -- so wait exactly that long and take hers then.
             Both halves of the strip are then the same moment in the world,
             instead of hers being a third of a second stale. */
          var mine = grabVideo($("#selfVideo"), true);
          return wait(_lagMs).then(function () {
            pairs.push({ a: mine, b: grabVideo($("#remoteVideo"), false) });
            pvKick();
            ensureMasks(pairs).then(pvKick);
          });
        }).then(function () {
          return (i < n - 1 ? wait(800) : Promise.resolve()).then(function () { return loop(i + 1); });
        });
      })(0);
    }).then(function () { return ensureMasks(pairs); }).then(function () {
      lastPairs = pairs; shootPairs = null; shotIdx = -1;
      lastCanvas = compose(pairs);
      lastBlob = null; lastMime = "image/png";
      pv.mode = "result"; pvKick();
      shooting = false;
      resultUI(false);
      shareShot(lastCanvas);        // and onto the other screen
      setStatus("#session-status", "Jadi ✓ Bingkai dan tulisannya masih bisa diganti, lalu simpan.");
    }).catch(function () {
      shootPairs = null; shotIdx = -1;
      setStatus("#session-status", "Gagal mengambil foto. Coba lagi.", true);
    }).then(function () {
      shooting = false; $("#shoot-btn").disabled = false;
      paintStudio(); pvKick();
    });
  }

  function stamp() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // ------------------------------------------------------------ album (KV-backed)
  /* PNG, unless a tall strip of photographs would be too big for the album
     (the Worker takes 5 MB) -- then the same strip as a high-quality JPEG. */
  function uploadBlob(c) {
    return new Promise(function (resolve) {
      c.toBlob(function (png) {
        if (png && png.size <= 4.5 * 1024 * 1024) { resolve(png); return; }
        flat(c).toBlob(function (jpg) { resolve(jpg || png); }, "image/jpeg", 0.92);
      }, "image/png");
    });
  }
  function saveToAlbum() {
    if (!lastCanvas && !lastPairs) return;
    var b = $("#save-album-btn"); if (b) b.disabled = true;
    setStatus("#session-status", "Menyimpan ke album…");
    clearTimeout(recT);
    // always the frame that is on the screen right now
    ensureMasks(lastPairs).then(function () {
      if (lastPairs) lastCanvas = compose(lastPairs);
      return uploadBlob(lastCanvas);
    }).then(function (blob) {
      if (!blob) { if (b) b.disabled = false; return; }
      fetch("/api/album", { method: "POST", headers: { "Content-Type": blob.type || "image/png" }, body: blob })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (o.j && o.j.ok) setStatus("#session-status", "Tersimpan ke album ✓ — buka lewat 'Lihat album'.");
          else if (o.r.status === 503) setStatus("#session-status", "Album belum aktif (KV belum kebind).", true);
          else if (o.r.status === 413) setStatus("#session-status", "Fotonya kebesaran buat album. Coba tata letak yang lebih kecil.", true);
          else setStatus("#session-status", "Gagal menyimpan ke album.", true);
        })
        .catch(function () { setStatus("#session-status", "Gagal menyimpan ke album.", true); })
        .then(function () { if (b) b.disabled = false; });
    });
  }
  function showAlbum() { show("s-album"); loadAlbum(); }
  function loadAlbum() {
    var grid = $("#album-grid"); grid.innerHTML = "";
    setStatus("#album-status", "Memuat…");
    fetch("/api/album", { cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        if (o.r.status === 503) { setStatus("#album-status", "Album belum aktif (KV belum kebind).", true); return; }
        var items = (o.j && o.j.items) || [];
        if (!items.length) { setStatus("#album-status", "Belum ada foto. Ambil satu di sesi berdua ya."); return; }
        setStatus("#album-status", items.length + " foto");
        items.forEach(function (it) {
          var d = new Date(it.uploaded);
          var ts = (!it.uploaded || isNaN(d.getTime())) ? "" :
            d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) + " · " +
            d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
          var fig = document.createElement("figure");
          var img = document.createElement("img"); img.src = it.url; img.alt = "Foto photobox"; img.loading = "lazy";
          img.addEventListener("error", function () {
            // photo deleted but still listed (KV eventual consistency) — drop it seamlessly
            if (fig.parentNode) fig.parentNode.removeChild(fig);
            var left = grid.querySelectorAll("figure").length;
            setStatus("#album-status", left ? left + " foto" : "Belum ada foto. Ambil satu di sesi berdua ya.");
          });
          var cap = document.createElement("figcaption"); cap.textContent = ts;
          var dl = document.createElement("a"); dl.className = "dl"; dl.href = it.url;
          dl.setAttribute("download", "photobox-" + it.name + ".png"); dl.textContent = "Unduh";
          var del = document.createElement("button"); del.className = "del"; del.type = "button"; del.textContent = "Hapus";
          del.addEventListener("click", function () {
            if (!window.confirm("Hapus foto ini dari album? Nggak bisa dibatalkan.")) return;
            del.disabled = true; del.textContent = "Menghapus…";
            fetch("/api/album/" + encodeURIComponent(it.name), { method: "DELETE" })
              .then(function (r) { if (!r.ok) throw 0; return r; })
              .then(function () {
                if (fig.parentNode) fig.parentNode.removeChild(fig);
                var left = grid.querySelectorAll("figure").length;
                setStatus("#album-status", left ? left + " foto" : "Belum ada foto. Ambil satu di sesi berdua ya.");
              })
              .catch(function () {
                del.disabled = false; del.textContent = "Hapus";
                setStatus("#album-status", "Gagal menghapus. Coba lagi.", true);
              });
          });
          var actions = document.createElement("div"); actions.className = "card-actions";
          actions.appendChild(dl); actions.appendChild(del);
          fig.appendChild(img); fig.appendChild(cap); fig.appendChild(actions);
          grid.appendChild(fig);
        });
      })
      .catch(function () { setStatus("#album-status", "Gagal memuat album.", true); });
  }

  // ------------------------------------------------------------ music accompaniment
  function setupMusic() {
    var audio = document.getElementById("pb-song");
    var toggle = document.getElementById("music-toggle");
    if (!audio || !toggle) return;
    var unlocked = false;
    function refresh() {
      var silent = audio.paused || audio.muted;
      toggle.classList.toggle("off", silent);
      toggle.setAttribute("aria-label", silent ? "Putar musik" : "Jeda musik");
    }
    function unlock() {
      if (unlocked) return; unlocked = true;
      audio.muted = false;
      if (audio.paused) audio.play().catch(function () {});
      refresh();
    }
    if (PRESS === "026" && !songUrl()) { toggle.hidden = true; return; }
    fetch("/content.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (c) {
        audio.src = songUrl() || (c && c.song_url) || "audio/side-a.mp3";
        audio.loop = true;
        audio.muted = true;
        audio.play().catch(function () {});
        ["scroll", "keydown", "click", "touchstart"].forEach(function (ev) {
          window.addEventListener(ev, unlock, { once: true, passive: true });
        });
        audio.addEventListener("play", refresh);
        audio.addEventListener("pause", refresh);
        toggle.addEventListener("click", function () {
          if (!unlocked) { unlock(); return; }
          if (audio.paused) audio.play().catch(function () {}); else audio.pause();
        });
        refresh();
      });
  }

  // ------------------------------------------------------------ wire up
  function init() {
    setupMusic();
    buildStudio();
    restoreWall();
    preloadFonts();
    paintPress();
    applyLookToPreview();
    paintStudio();
    mountStudio("s-lobby");
    if (wantsCut() && studio.potong === "otomatis") loadCut();
    var resizeT = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { measureBox(); pvKick(); thumbsSoon(); }, 120);
    });

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

    $("#shoot-btn").addEventListener("click", runSession);
    $("#retake-btn").addEventListener("click", function () {
      $("#result").classList.remove("on");
      lastPairs = null; pv.mode = "live"; pv.img = null; pv.pending = false;
      paintStudio(); pvKick();
    });
    $("#download-btn").addEventListener("click", function () {
      // the shooter has the PNG original; the other one has the shared copy
      ensureMasks(lastPairs).then(function () {
        var href, name = "photobox-" + stamp();
        if (lastPairs) lastCanvas = compose(lastPairs);
        if (lastCanvas) { href = lastCanvas.toDataURL("image/png"); name += ".png"; }
        else if (lastBlob) { href = rxUrl; name += lastMime === "image/png" ? ".png" : ".jpg"; }
        else return;
        var a = document.createElement("a");
        a.download = name; a.href = href;
        document.body.appendChild(a); a.click(); a.remove();
      });
    });
    $("#save-album-btn").addEventListener("click", saveToAlbum);
    $("#open-album").addEventListener("click", showAlbum);

    // the lobby can set the strip up before there is a room at all
    var lsb = $("#lobby-studio-btn");
    if (lsb) lsb.addEventListener("click", function () {
      var slot = document.querySelector('.studio-slot[data-slot="lobby"]');
      if (!slot) return;
      slot.hidden = !slot.hidden;
      lsb.setAttribute("aria-expanded", slot.hidden ? "false" : "true");
      lsb.textContent = slot.hidden ? "✎ Atur bingkai dulu" : "✕ Tutup pengaturan bingkai";
      mountStudio("s-lobby");
      if (!slot.hidden && slot.scrollIntoView) slot.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    /* A ROOM YOU CAN WALK OUT OF.
       Making one was a one-way door: the only way back to the lobby was
       reloading the page. Cancelling also hands the camera back, which matters
       when the reason you are cancelling is that something else wants it. */
    ["#cam-retry", "#wait-cam"].forEach(function (s) {
      var b = $(s); if (b) b.addEventListener("click", function () { retryCam(); });
    });
    function leave(msg) {
      cleanup(); dropCam();
      $("#result").classList.remove("on");
      lastPairs = null; pv.mode = "live"; pv.img = null; pv.pending = false;
      show("s-lobby");
      setStatus("#lobby-status", msg);
    }
    $("#wait-back").addEventListener("click", function () {
      leave("Room dibatalkan. Bisa bikin lagi kapan aja.");
    });
    $("#session-back").addEventListener("click", function () {
      if (!window.confirm("Keluar dari sesi berdua? Foto yang belum disimpan bakal hilang.")) return;
      leave("Sesi selesai. Makasih ya.");
    });
    /* Mid-session, "back" means back to the booth you are standing in. With
       nothing running, it means back to where you came from -- which by month
       five is another pressing, not this one's front page. */
    $("#album-back").addEventListener("click", function () {
      if (connected) { show("s-session"); return; }
      var home = fromUrl();
      if (home) { location.href = home; return; }
      show("s-lobby");
    });
    (function () {
      var home = fromUrl();
      var b = $("#album-back");
      if (b && home) b.textContent = "← " + fromName();
    })();

    // shared invite link: /photobox#CODE -> prefill the join field
    var h = (location.hash || "").replace(/^#/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (h) {
      $("#join-code").value = h;
      setStatus("#lobby-status", "Kode terisi dari tautan. Tap Gabung buat mulai.");
      $("#join-btn").classList.add("solid");
    }

    // for QA, not for her: drive the studio and fake a finished shot without cameras
    window.__pbStudio = {
      get: function () { return studio; },
      set: function (o) { setStudio(o); },
      pv: pv,
      result: function (pairs) {
        lastPairs = pairs; shotAt = new Date();
        return ensureMasks(pairs).then(function () {
          lastCanvas = compose(pairs); lastBlob = null;
          pv.mode = "result"; pvKick(); resultUI(false);
          var key = maskKey();
          return { w: lastCanvas.width, h: lastCanvas.height, masked: !!(pairs[0].masks && pairs[0].masks["a" + key]) };
        });
      },
      cut: CUT,
      canvas: function () { return lastCanvas; }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
