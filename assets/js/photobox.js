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
    salju:   { name: "Salju",   css: "brightness(1.16) saturate(0.82) contrast(1.06) hue-rotate(8deg)" }
  };
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
    ["#selfPreview", "#selfVideo"].forEach(function (s) { var v = $(s); if (v) v.srcObject = localStream; });
    pvKick();
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
  function pressMark() { return "YS-" + PRESS; }
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
    if (tag) tag.textContent = "Kamu & Aku · sesi berdua · " + pressMark() + (nm && PRESS !== "004" ? " · " + nm : "");
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
      return cv ? { img: cv, w: cv.width, h: cv.height } : null;
    };
  }
  function compose(pairs) {
    var p = BK.plan(studio);
    var c = document.createElement("canvas"); c.width = p.W; c.height = p.H;
    BK.draw(c.getContext("2d"), p, studio, { src: pairSource(pairs), filter: lookCSS(), date: tsText(shotAt), press: pressMark() });
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
    if (cv) return { img: cv, w: cv.width, h: cv.height };
    var v = cell.who === "a" ? selfVideo() : (connected ? $("#remoteVideo") : null);
    if (v && v.videoWidth) return { img: v, w: v.videoWidth, h: v.videoHeight, flip: cell.who === "a" };
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
    if (pv.dirty || (moving && t - pv.last > 80)) { pvRender(); pv.last = t; pv.dirty = false; }
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
      g.drawImage(pv.img, 0, 0, bw, bh);
    } else {
      var k = bw / W0;
      g.setTransform(k, 0, 0, k, 0, 0);
      BK.draw(g, p, studio, {
        src: pv.mode === "result" ? pairSource(lastPairs) : liveSource,
        filter: lookCSS(), press: pressMark(),
        date: pv.mode === "result" ? tsText(shotAt) : nowText(),
        hot: shooting ? shotIdx : -1
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
    BK.draw(g, p, o, { thumb: true, press: pressMark(), date: "" });
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
    BK.LAYOUTS.forEach(function (L) {
      card(lays, L.id, L.name, L.note, "data-layout", function () { setStudio({ layout: L.id }); });
    });
    var FRAME_NOTE = { ladang: "YS-006", sisia: "YS-004", kafe: "YS-005", salju: "dingin, bersih", film: "roll film", putih: "galeri", none: "foto sampai tepi" };
    var frs = $("#st-frames");
    BK.FRAME_ORDER.forEach(function (id) {
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

    var lookRow = document.querySelector(".looks");
    if (lookRow) Object.keys(LOOKS).forEach(function (k) {
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
      r.disabled = none && key !== "ukuran";
      var out = $("#o-" + key);
      if (out) out.textContent = none && key !== "ukuran" ? "tanpa bingkai" : studio[key] + (key === "ukuran" ? "%" : " px");
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
          if (rx.size) {
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
      if (m.t === "shot") {
        rx = { size: m.size || 0, mime: m.mime || "image/jpeg", parts: [], got: 0 };
        setStatus("#session-status", "Menerima hasil foto…");
      }
      if (m.t === "shotdone" && rx) {
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
  var shareGen = 0;
  function shareShot(canvas) {
    if (!dc || dc.readyState !== "open" || !canvas.toBlob) return;
    var gen = ++shareGen;
    flat(canvas).toBlob(function (blob) {
      if (!blob || gen !== shareGen) return;
      blob.arrayBuffer().then(function (buf) {
        if (gen !== shareGen) return;
        sendDC({ t: "shot", size: buf.byteLength, mime: blob.type || "image/jpeg", gen: gen });
        var off = 0;
        (function pump() {
          if (!dc || dc.readyState !== "open" || gen !== shareGen) return;
          while (off < buf.byteLength) {
            // let the channel drain rather than burying it and losing the tail
            if (dc.bufferedAmount > 512 * 1024) { setTimeout(pump, 50); return; }
            try { dc.send(buf.slice(off, off + CHUNK)); } catch (e) { return; }
            off += CHUNK;
          }
          sendDC({ t: "shotdone", gen: gen });
        })();
      });
    }, "image/jpeg", 0.92);
  }
  var recT = 0;
  function recomposeSoon() {
    clearTimeout(recT);
    recT = setTimeout(function () {
      if (!lastPairs) return;
      fontsReady().then(function () {
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
          });
        }).then(function () {
          return (i < n - 1 ? wait(800) : Promise.resolve()).then(function () { return loop(i + 1); });
        });
      })(0);
    }).then(function () {
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
    if (lastPairs) lastCanvas = compose(lastPairs);
    uploadBlob(lastCanvas).then(function (blob) {
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
    preloadFonts();
    paintPress();
    applyLookToPreview();
    paintStudio();
    mountStudio("s-lobby");
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
      var href, name = "photobox-" + stamp();
      if (lastPairs) lastCanvas = compose(lastPairs);
      if (lastCanvas) { href = lastCanvas.toDataURL("image/png"); name += ".png"; }
      else if (lastBlob) { href = rxUrl; name += lastMime === "image/png" ? ".png" : ".jpg"; }
      else return;
      var a = document.createElement("a");
      a.download = name; a.href = href;
      document.body.appendChild(a); a.click(); a.remove();
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
        lastCanvas = compose(pairs); lastBlob = null;
        pv.mode = "result"; pvKick(); resultUI(false);
        return { w: lastCanvas.width, h: lastCanvas.height };
      }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
