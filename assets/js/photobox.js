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
  var connected = false, shooting = false, selectedLayout = "side", lastCanvas = null;
  var selectedFilter = "asli";
  /* The composed strip, as a blob. The shooter also keeps lastCanvas (the PNG
     original); the other one only ever has this. Either is enough to look at
     and to download. */
  var lastBlob = null, lastMime = "image/png", rxUrl = null;
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
  function lookCSS() { var l = LOOKS[selectedFilter]; return (l && l.css) || "none"; }
  function applyLookToPreview() {
    var f = lookCSS();
    // includes the lobby preview, so you can pick a look before connecting
    ["#selfPreview", "#selfVideo", "#remoteVideo"].forEach(function (sel) {
      var v = $(sel); if (v) v.style.filter = f === "none" ? "" : f;
    });
  }
  /* How many shots a layout needs. Strips take several; the rest take one. */
  function shotsFor(layout) {
    if (layout === "strip") return 3;
    if (layout === "strip4") return 4;
    if (layout === "grid") return 2;   // 2 pairs = a 2x2 of four pictures
    return 1;
  }
  var dc = null, guestCounting = false; // data channel: sync the countdown to both sides

  // ------------------------------------------------------------ screens/status
  function show(id) {
    ["s-lobby", "s-wait", "s-session", "s-album"].forEach(function (s) {
      var el = $("#" + s); if (el) el.classList.toggle("on", s === id);
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
    setStatus("#session-status", "Tersambung. Pilih tata letak lalu ambil foto.");
    refreshCamUI(); camHint();
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

  function mk(w, h) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d"); g.fillStyle = "#F2EDE3"; g.fillRect(0, 0, w, h);
    return c;
  }
  function drawCover(g, src, x, y, w, h) {
    var sw = src.width, sh = src.height; if (!sw || !sh) return;
    var s = Math.max(w / sw, h / sh), dw = sw * s, dh = sh * s;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    // the chosen look is baked here, so the print matches the preview
    try { g.filter = lookCSS(); } catch (e) {}
    g.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    try { g.filter = "none"; } catch (e) {}
    g.restore();
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
  /* The booth lives here on Side A, but later pressings link straight to it
     (?press=005). Whichever record you walked in from is the one stamped on
     the strip, so a photo taken from month five reads YS-005 -- not YS-004.
     Anything unexpected falls back to this booth's own pressing. */
  function pressMark() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("press") || ""; } catch (e) {}
    return /^[0-9]{1,3}$/.test(q) ? "YS-" + ("00" + q).slice(-3) : "YS-004";
  }
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
  /* Say which pressing this strip will be stamped with, before it is taken --
     the number only appeared in six-point type in the footer of a photograph
     that had already been shot. */
  function paintPress() {
    var tag = document.querySelector("header.top .tag");
    if (tag) tag.textContent = "Kamu & Aku · sesi berdua · " + pressMark();
    var back = document.getElementById("backlink");
    var home = fromUrl();
    if (back && home) { back.href = home; back.textContent = "← " + fromName(); }
  }
  function footerBand(g, W, H, FT, ts) {
    var y = H - FT / 2;
    g.strokeStyle = "rgba(18,16,14,0.25)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(16, H - FT); g.lineTo(W - 16, H - FT); g.stroke();
    g.textBaseline = "middle";
    g.fillStyle = "#12100E"; g.font = "400 14px 'Space Mono', monospace"; g.textAlign = "left"; g.fillText(ts, 18, y);
    g.fillStyle = "#9A958C"; g.font = "400 12px 'Space Mono', monospace"; g.textAlign = "right"; g.fillText(pressMark(), W - 18, y);
    heartLine(g, W / 2, y, "700 18px 'Space Mono', monospace");
  }
  // Cells are 4:3 to match the live preview (.feed is aspect-ratio 4/3, object-fit
  // cover) — so what you frame in the preview is exactly what the result keeps.
  var AR = 3 / 4; // cell height / width
  function compose(layout, pairs) {
    var P = 18, FT = 64, ts = tsText(), c, g;
    if (layout === "stack") {
      var Ws = 620, cwS = Ws - 2 * P, chS = Math.round(cwS * AR);
      var Hs = 3 * P + 2 * chS + FT;
      c = mk(Ws, Hs); g = c.getContext("2d");
      drawCover(g, pairs[0].a, P, P, cwS, chS);
      drawCover(g, pairs[0].b, P, 2 * P + chS, cwS, chS);
      footerBand(g, Ws, Hs, FT, ts); return c;
    }
    if (layout === "strip") {
      var W = 620, HEAD = 66, gap = 14, rows = pairs.length;
      var cw = (W - 2 * P - gap) / 2, rowH = Math.round(cw * AR);
      var H = HEAD + rows * rowH + (rows - 1) * gap + FT + P;
      c = mk(W, H); g = c.getContext("2d");
      heartLine(g, W / 2, HEAD / 2 + 4, "800 26px 'Archivo', sans-serif");
      for (var i = 0; i < rows; i++) {
        var yy = HEAD + i * (rowH + gap);
        drawCover(g, pairs[i].a, P, yy, cw, rowH);
        drawCover(g, pairs[i].b, P + cw + gap, yy, cw, rowH);
      }
      footerBand(g, W, H, FT, ts); return c;
    }
    if (layout === "strip4") {
      var W4 = 620, HEAD4 = 66, gap4 = 12, rows4 = pairs.length;
      var cw4 = (W4 - 2 * P - gap4) / 2, rowH4 = Math.round(cw4 * AR);
      var H4 = HEAD4 + rows4 * rowH4 + (rows4 - 1) * gap4 + FT + P;
      c = mk(W4, H4); g = c.getContext("2d");
      heartLine(g, W4 / 2, HEAD4 / 2 + 4, "800 26px 'Archivo', sans-serif");
      for (var j = 0; j < rows4; j++) {
        var y4 = HEAD4 + j * (rowH4 + gap4);
        drawCover(g, pairs[j].a, P, y4, cw4, rowH4);
        drawCover(g, pairs[j].b, P + cw4 + gap4, y4, cw4, rowH4);
      }
      footerBand(g, W4, H4, FT, ts); return c;
    }
    if (layout === "grid") {
      // two shots, four pictures, square-ish: a 2x2 contact sheet
      var Wg = 900, gapg = 16;
      var cwg = (Wg - 2 * P - gapg) / 2, chg = Math.round(cwg * AR);
      var Hg = 2 * P + 2 * chg + gapg + FT;
      c = mk(Wg, Hg); g = c.getContext("2d");
      drawCover(g, pairs[0].a, P, P, cwg, chg);
      drawCover(g, pairs[0].b, P + cwg + gapg, P, cwg, chg);
      var y2 = P + chg + gapg;
      drawCover(g, pairs[1].a, P, y2, cwg, chg);
      drawCover(g, pairs[1].b, P + cwg + gapg, y2, cwg, chg);
      footerBand(g, Wg, Hg, FT, ts); return c;
    }
    // side (default): two 4:3 cells
    var Wd = 1120, cwd = (Wd - 3 * P) / 2, cHd = Math.round(cwd * AR);
    var Hd = 2 * P + cHd + FT;
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
  // data channel: peer messages sync the countdown so both pose at the same time
  function setupDC(ch) {
    ch.onmessage = function (e) {
      // binary frames are strip chunks, not messages
      if (typeof e.data !== "string") {
        if (rx) {
          rx.parts.push(e.data);
          rx.got += e.data.byteLength || 0;
          if (rx.size) {
            setStatus("#session-status", "Menerima hasil foto\u2026 " +
              Math.min(100, Math.round((rx.got / rx.size) * 100)) + "%");
          }
        }
        return;
      }
      var m; try { m = JSON.parse(e.data); } catch (er) { return; }
      if (m && m.t === "cd") guestCountdown(m.n || 3); // partner started a shot -- count down here too
      // keep both booths on the same look and layout, so the guest's preview
      // shows exactly what the host is about to print
      if (m && m.t === "look" && LOOKS[m.v]) {
        selectedFilter = m.v; applyLookToPreview(); syncChips();
      }
      if (m && m.t === "layout" && m.v) { selectedLayout = m.v; syncChips(); }
      if (m && m.t === "shot") {
        rx = { size: m.size || 0, mime: m.mime || "image/jpeg", parts: [], got: 0 };
        setStatus("#session-status", "Menerima hasil foto\u2026");
      }
      if (m && m.t === "shotdone" && rx) {
        var blob = new Blob(rx.parts, { type: rx.mime });
        lastBlob = blob; lastMime = rx.mime; lastCanvas = null;
        if (rxUrl) URL.revokeObjectURL(rxUrl);
        rxUrl = URL.createObjectURL(blob);
        showResult(rxUrl, true);
        setStatus("#session-status", "Hasil foto dari pasanganmu \u2713");
        rx = null;
      }
    };
    ch.binaryType = "arraybuffer";
    // whoever opens the channel announces what they already have chosen, so a
    // look picked before the other one arrived is not silently lost
    ch.onopen = function () { sendDC({ t: "look", v: selectedFilter }); sendDC({ t: "layout", v: selectedLayout }); };
  }
  function sendDC(obj) { try { if (dc && dc.readyState === "open") dc.send(JSON.stringify(obj)); } catch (e) {} }

  /* Taking the photo together and then only ONE of you seeing it is the wrong
     ending. The shooter sends the finished strip straight down the same data
     channel the countdown already uses, so it lands on both screens.
     JPEG rather than the PNG original: a quarter of the bytes over a link
     that may be crossing an ocean, and indistinguishable at this size. */
  function shareShot(canvas) {
    if (!dc || dc.readyState !== "open" || !canvas.toBlob) return;
    canvas.toBlob(function (blob) {
      if (!blob) return;
      blob.arrayBuffer().then(function (buf) {
        sendDC({ t: "shot", size: buf.byteLength, mime: blob.type || "image/jpeg" });
        var off = 0;
        (function pump() {
          if (!dc || dc.readyState !== "open") return;
          while (off < buf.byteLength) {
            // let the channel drain rather than burying it and losing the tail
            if (dc.bufferedAmount > 512 * 1024) { setTimeout(pump, 50); return; }
            try { dc.send(buf.slice(off, off + CHUNK)); } catch (e) { return; }
            off += CHUNK;
          }
          sendDC({ t: "shotdone" });
        })();
      });
    }, "image/jpeg", 0.92);
  }

  function showResult(src, shared) {
    $("#result-img").src = src;
    $("#result").classList.add("on");
    var tag = $("#result .tag");
    if (tag) tag.textContent = shared ? "Hasil \u00b7 dari pasanganmu" : "Hasil";
    var save = $("#save-album-btn");
    // only the one who pressed the shutter files it, so the album gets one copy
    if (save) { save.disabled = !!shared; save.title = shared ? "Yang motret yang nyimpen ke album" : ""; }
    $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function syncChips() {
    document.querySelectorAll(".chip[data-look]").forEach(function (x) {
      x.setAttribute("aria-pressed", x.dataset.look === selectedFilter ? "true" : "false");
    });
    document.querySelectorAll(".chip[data-layout]").forEach(function (x) {
      x.setAttribute("aria-pressed", x.dataset.layout === selectedLayout ? "true" : "false");
    });
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
    var n = shotsFor(selectedLayout);
    var pairs = [];
    (function ready() {
      return (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(function () {}) : Promise.resolve();
    })().then(function () {
      return (function loop(i) {
        if (i >= n) return Promise.resolve();
        sampleLag();
        sendDC({ t: "cd", n: 3 });            // she starts the moment this lands
        /* ...which is one-way-latency from now, so wait that long before
           starting ours. Both countdowns then run against the same wall clock
           and both of you hit "1" together. */
        var lead = Math.min(300, Math.round(_rttMs / 2));
        return wait(lead).then(function () { return doCountdown(3); }).then(function () {
          /* THE SHUTTER, ALIGNED.
             Take our own frame at the instant of GO. Her frame of that same
             instant has not arrived yet -- it is still in flight and in the
             jitter buffer -- so wait exactly that long and take hers then.
             Both halves of the strip are then the same moment in the world,
             instead of hers being a third of a second stale. */
          var mine = grabVideo($("#selfVideo"), true);
          return wait(_lagMs).then(function () {
            pairs.push({ a: mine, b: grabVideo($("#remoteVideo"), false) });
          });
        }).then(function () {
          return (i < n - 1 ? wait(800) : Promise.resolve()).then(function () { return loop(i + 1); });
        });
      })(0);
    }).then(function () {
      lastCanvas = compose(selectedLayout, pairs);
      lastBlob = null; lastMime = "image/png";
      showResult(lastCanvas.toDataURL("image/png"), false);
      shareShot(lastCanvas);        // and onto the other screen
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

  // ------------------------------------------------------------ album (KV-backed)
  function saveToAlbum() {
    if (!lastCanvas) return;
    var b = $("#save-album-btn"); if (b) b.disabled = true;
    setStatus("#session-status", "Menyimpan ke album…");
    lastCanvas.toBlob(function (blob) {
      if (!blob) { if (b) b.disabled = false; return; }
      fetch("/api/album", { method: "POST", headers: { "Content-Type": "image/png" }, body: blob })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (o.j && o.j.ok) setStatus("#session-status", "Tersimpan ke album ✓ — buka lewat 'Lihat album'.");
          else if (o.r.status === 503) setStatus("#session-status", "Album belum aktif (KV belum kebind).", true);
          else setStatus("#session-status", "Gagal menyimpan ke album.", true);
        })
        .catch(function () { setStatus("#session-status", "Gagal menyimpan ke album.", true); })
        .then(function () { if (b) b.disabled = false; });
    }, "image/png");
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
        audio.src = (c && c.song_url) || "audio/side-a.mp3";
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

    // look chips
    var lookRow = document.querySelector(".looks");
    if (lookRow) {
      lookRow.innerHTML = Object.keys(LOOKS).map(function (k) {
        return '<button class="chip" data-look="' + k + '" aria-pressed="' +
          (k === selectedFilter ? "true" : "false") + '">' + LOOKS[k].name + "</button>";
      }).join("");
      lookRow.querySelectorAll(".chip[data-look]").forEach(function (b) {
        b.addEventListener("click", function () {
          selectedFilter = b.dataset.look;
          applyLookToPreview();
          syncChips();
          sendDC({ t: "look", v: selectedFilter });
        });
      });
    }
    document.querySelectorAll(".chip[data-layout]").forEach(function (b) {
      b.addEventListener("click", function () {
        selectedLayout = b.dataset.layout;
        sendDC({ t: "layout", v: selectedLayout });
        document.querySelectorAll(".chip[data-layout]").forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
      });
    });
    $("#shoot-btn").addEventListener("click", runSession);
    $("#retake-btn").addEventListener("click", function () { $("#result").classList.remove("on"); });
    $("#download-btn").addEventListener("click", function () {
      // the shooter has the PNG original; the other one has the shared copy
      var href, name = "photobox-" + stamp();
      if (lastCanvas) { href = lastCanvas.toDataURL("image/png"); name += ".png"; }
      else if (lastBlob) { href = rxUrl; name += lastMime === "image/png" ? ".png" : ".jpg"; }
      else return;
      var a = document.createElement("a");
      a.download = name; a.href = href;
      document.body.appendChild(a); a.click(); a.remove();
    });
    $("#save-album-btn").addEventListener("click", saveToAlbum);
    $("#open-album").addEventListener("click", showAlbum);

    /* A ROOM YOU CAN WALK OUT OF.
       Making one was a one-way door: the only way back to the lobby was
       reloading the page. Cancelling also hands the camera back, which matters
       when the reason you are cancelling is that something else wants it. */
    ["#cam-retry", "#wait-cam"].forEach(function (s) {
      var b = $(s); if (b) b.addEventListener("click", function () { retryCam(); });
    });
    function leave(msg) {
      cleanup(); dropCam();
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
    paintPress();

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
