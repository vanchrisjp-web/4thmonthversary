/* =============================================================================
   Side A — app.js
   Reader (record) + editor (mixing desk). Vanilla, no deps, runs from file://.
   Load order: DEFAULTS -> content.json -> KV(/api/content) -> localStorage.
   ========================================================================== */
(function () {
  "use strict";

  // --------------------------------------------------------------- helpers
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var prefersReduced = function () {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  };
  var LS_CONTENT = "sideA:content";
  var LS_TOKEN = "sideA:token";

  function deepMerge(base, over) {
    if (Array.isArray(over)) return over.slice();
    if (over && typeof over === "object") {
      var out = {};
      var k;
      for (k in base) out[k] = base[k];
      for (k in over) {
        if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) &&
            base[k] && typeof base[k] === "object") {
          out[k] = deepMerge(base[k], over[k]);
        } else { out[k] = over[k]; }
      }
      return out;
    }
    return over === undefined ? base : over;
  }

  // --------------------------------------------------------------- dates
  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) { var d = new Date(s); return isNaN(d) ? null : d; }
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function elapsed(start, now) {
    var y = now.getFullYear() - start.getFullYear();
    var m = now.getMonth() - start.getMonth();
    var d = now.getDate() - start.getDate();
    if (d < 0) { m--; d += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return { months: y * 12 + m, days: d };
  }
  function nextAnniversary(start, from) {
    var day = start.getDate();
    function make(y, m) {
      var dim = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(day, dim));
    }
    var y = from.getFullYear(), m = from.getMonth();
    var cand = make(y, m);
    if (cand <= from) { m++; if (m > 11) { m = 0; y++; } cand = make(y, m); }
    return cand;
  }
  var ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  function fmtDateID(s) {
    var d = parseDate(s); if (!d) return "";
    return d.getDate() + " " + ID_MONTHS[d.getMonth()] + " " + d.getFullYear();
  }
  function trackDur(t) {
    var s = (t.title || "") + "|" + t.n, h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var total = 150 + (h % 170);
    return pad(Math.floor(total / 60)) + ":" + pad(total % 60);
  }

  // --------------------------------------------------------------- record svg
  function buildRecord(months, catalog, label) {
    var rings = Math.max(1, months | 0);
    catalog = catalog || "YS-004";
    var lbl = String(label || "Yukisnow").split(/\s+/)[0].toUpperCase();
    var s = [];
    s.push("<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg' role='img' aria-label='Piringan hitam'>");
    s.push("<defs><radialGradient id='rsheen' cx='38%' cy='32%' r='75%'>" +
      "<stop offset='0%' stop-color='#26221d'/><stop offset='60%' stop-color='#111'/>" +
      "<stop offset='100%' stop-color='#050505'/></radialGradient></defs>");
    s.push("<circle cx='100' cy='100' r='98' fill='url(#rsheen)'/>");
    // fine grooves
    for (var r = 93; r >= 48; r -= 2.1) {
      s.push("<circle cx='100' cy='100' r='" + r.toFixed(1) + "' fill='none' stroke='rgba(242,237,227,0.05)' stroke-width='0.5'/>");
    }
    // month rings (one per month together), tinted, spread through the groove band
    for (var i = 0; i < rings; i++) {
      var rr = 90 - (i * (42 / Math.max(rings, 6)));
      if (rr < 50) break;
      var col = i % 2 ? "#1C4FD8" : "#FF4A7D";
      s.push("<circle cx='100' cy='100' r='" + rr.toFixed(1) + "' fill='none' stroke='" + col + "' stroke-opacity='0.42' stroke-width='0.9'/>");
    }
    // rotation-visible gloss streak so the spin actually reads (record is otherwise symmetric)
    s.push("<rect x='98.4' y='7' width='3.2' height='40' rx='1.6' fill='#F2EDE3' opacity='0.09'/>");
    // label
    s.push("<circle cx='100' cy='100' r='44' fill='#F2EDE3'/>");
    s.push("<circle cx='100' cy='100' r='44' fill='none' stroke='#12100E' stroke-opacity='0.15' stroke-width='0.6'/>");
    s.push("<text x='100' y='90' text-anchor='middle' font-family='Space Mono, monospace' font-size='9' letter-spacing='1.5' fill='#12100E'>SIDE A</text>");
    s.push("<text x='100' y='104' text-anchor='middle' font-family='Archivo, sans-serif' font-weight='800' font-size='15' fill='#FF4A7D'>" + esc(catalog) + "</text>");
    s.push("<text x='100' y='118' text-anchor='middle' font-family='Space Mono, monospace' font-size='6.5' letter-spacing='1' fill='#9A958C'>" + esc(lbl) + "</text>");
    // registration dot on the label — orbits the center as it spins
    s.push("<circle cx='100' cy='63' r='2.6' fill='#FF4A7D'/>");
    // spindle
    s.push("<circle cx='100' cy='100' r='3.2' fill='#0c0b09'/>");
    s.push("</svg>");
    return s.join("");
  }

  // --------------------------------------------------------------- state
  var content = null;
  var startDate = null;
  var audioEl = $("#song");
  var isPlaying = false;
  var openTrack = null; // n of open track

  // --------------------------------------------------------------- load
  function loadContent() {
    var base = window.SIDE_A_DEFAULTS || {};
    var merged = base;
    return fetchJSON("content.json")
      .then(function (json) { if (json) merged = deepMerge(merged, json); })
      .then(function () { return fetchJSON("/api/content"); })
      .then(function (kv) { if (kv) merged = deepMerge(merged, kv); })
      .catch(function () {})
      .then(function () {
        try {
          var ls = localStorage.getItem(LS_CONTENT);
          if (ls) merged = deepMerge(merged, JSON.parse(ls));
        } catch (e) {}
        return merged;
      });
  }
  function fetchJSON(url) {
    if (!window.fetch) return Promise.resolve(null);
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // --------------------------------------------------------------- render reader
  function render() {
    startDate = parseDate(content.start_date) || new Date();
    var months = elapsed(startDate, new Date()).months;

    // hero
    $("#hero-label").textContent = content.label || "Yukisnow Corp.";
    $("#hero-cat").textContent = "Cat. no. " + (content.catalog_no || "YS-004");
    $("#liner-cat").textContent = content.catalog_no || "YS-004";
    var artist = $("#hero-artist");
    artist.innerHTML = esc((content.artist_a || "").toUpperCase()) +
      " <span class='x' aria-label='dan'>♥</span> " + esc((content.artist_b || "").toUpperCase());
    $("#hero-title").textContent = content.album_title || "";
    document.title = (content.album_title || "Side A") + " — " + (content.catalog_no || "YS-004");

    // records
    var svg = buildRecord(months, content.catalog_no, content.label);
    $("#hero-record").innerHTML = svg;
    $("#mini-record").innerHTML = svg;

    renderTracklist();
    renderLiner();
    renderCredits();
    renderGallery();
    renderBack();

    $("#footer").textContent = content.footer || "";
    updateRuntime(true);
    setupReveals();
  }

  // ---- tracklist (+ hidden track 17) ----
  function renderTracklist() {
    var list = $("#tracklist");
    list.innerHTML = "";
    var tracks = (content.tracks || []).slice().sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
    $("#track-count").textContent = tracks.length + " track · side a";

    tracks.forEach(function (t) { list.appendChild(trackEl(t)); });

    // hidden track 17 (or next number)
    var hn = tracks.length + 1;
    list.appendChild(hiddenTrackEl(hn));
  }

  function trackEl(t) {
    var wrap = document.createElement("div");
    wrap.className = "track";
    wrap.setAttribute("role", "listitem");
    wrap.dataset.n = t.n;
    var hasAudio = !!t.commentary;

    var row = document.createElement("button");
    row.className = "track__row";
    row.type = "button";
    row.setAttribute("aria-expanded", "false");
    row.innerHTML =
      "<span class='track__n'>" + pad(t.n) + "</span>" +
      "<span class='track__play' aria-hidden='true'>⏵</span>" +
      "<span class='track__title'>" + esc(t.title || "Tanpa judul") +
        (hasAudio ? " <span class='track__has-audio' title='Ada catatan suara'>●</span>" : "") +
        "<span class='leader' aria-hidden='true'></span></span>" +
      "<span class='track__dur'>" + trackDur(t) + "</span>";
    row.addEventListener("click", function () { toggleTrack(t.n); });

    var panel = document.createElement("div");
    panel.className = "track__panel";
    var inner = document.createElement("div");
    inner.appendChild(spreadEl(t, hasAudio));
    panel.appendChild(inner);

    wrap.appendChild(row);
    wrap.appendChild(panel);
    return wrap;
  }

  function spreadEl(t, hasAudio) {
    var d = document.createElement("div");
    d.className = "spread";
    var photo = t.photo
      ? "<div class='spread__photo'><img src='" + esc(t.photo) + "' alt='Foto kenangan: " + esc(t.title) + "' loading='lazy'></div>"
      : "<div class='spread__photo spread__photo--empty'><span class='mono'>Belum ada foto</span></div>";
    var commentary = hasAudio
      ? "<div class='commentary' data-src='" + esc(t.commentary) + "'>" +
          "<button class='commentary__btn' type='button' aria-label='Putar catatan suara'>⏵</button>" +
          "<span class='commentary__wave' aria-hidden='true'></span>" +
          "<span class='commentary__meta'><span class='commentary__label'>Komentar</span> " +
          "<span class='commentary__time'>0:00</span></span>" +
        "</div>"
      : "";
    d.innerHTML =
      photo +
      "<div class='spread__meta'>" +
        "<span class='mono spread__date'>" + esc(fmtDateID(t.date) || "—") + "</span>" +
        "<p class='spread__story'>" + esc(t.story || "") + "</p>" +
        commentary +
      "</div>";
    if (hasAudio) wireCommentary($(".commentary", d));
    return d;
  }

  function wireCommentary(node) {
    var wave = $(".commentary__wave", node);
    var bars = [], N = 28;
    for (var i = 0; i < N; i++) {
      var bar = document.createElement("i");
      bar.style.setProperty("--h", (25 + ((i * 37) % 70)) + "%");
      wave.appendChild(bar); bars.push(bar);
    }
    var btn = $(".commentary__btn", node);
    var timeEl = $(".commentary__time", node);
    var au = new Audio(node.dataset.src);
    var dur = 0, ducked = false;
    function showTime() { timeEl.textContent = fmtClock(au.currentTime) + " / " + fmtClock(dur || au.duration || 0); }
    function paint() {
      var frac = dur ? au.currentTime / dur : 0, active = Math.round(frac * N);
      for (var i = 0; i < N; i++) bars[i].classList.toggle("on", i < active);
    }
    au.addEventListener("loadedmetadata", function () {
      if (isFinite(au.duration) && au.duration > 0) { dur = au.duration; showTime(); return; }
      // recorded webm/opus reports duration=Infinity — force the browser to compute it
      var fix = function () {
        if (isFinite(au.duration)) {
          dur = au.duration;
          au.removeEventListener("durationchange", fix);
          try { au.currentTime = 0; } catch (e) {}
          showTime();
        }
      };
      au.addEventListener("durationchange", fix);
      try { au.currentTime = 1e101; } catch (e) {}
    });
    au.addEventListener("timeupdate", function () { showTime(); paint(); });
    function reset() {
      node.classList.remove("playing"); btn.textContent = "⏵";
      if (ducked) { audioEl.volume = 1; ducked = false; } // restore the BGM
    }
    au.addEventListener("play", function () {
      node.classList.add("playing"); btn.textContent = "⏸";
      if (!audioEl.paused) { audioEl.volume = 0.18; ducked = true; } // duck the BGM to a background level
    });
    au.addEventListener("pause", reset);
    au.addEventListener("ended", function () { reset(); au.currentTime = 0; paint(); });
    btn.addEventListener("click", function () { if (au.paused) au.play().catch(function () {}); else au.pause(); });
    showTime();
  }
  function fmtClock(sec) { sec = (isFinite(sec) && sec > 0) ? Math.floor(sec) : 0; return Math.floor(sec / 60) + ":" + pad(sec % 60); }

  function hiddenTrackEl(n) {
    var ht = content.hidden_track || {};
    var unlock = parseDate(ht.unlock_date);
    var unlocked = unlock && new Date() >= unlock;
    var wrap = document.createElement("div");
    wrap.className = "track";
    wrap.id = "hidden-track";
    wrap.dataset.n = n;

    var row = document.createElement("button");
    row.className = "track__row";
    row.type = "button";
    row.setAttribute("aria-expanded", "false");
    row.innerHTML =
      "<span class='track__n'>" + pad(n) + "</span>" +
      "<span class='track__play' aria-hidden='true'>" + (unlocked ? "⏵" : "⏻") + "</span>" +
      "<span class='track__title'>" + (unlocked ? "Track tersembunyi" : "Track tersembunyi") +
        "<span class='leader' aria-hidden='true'></span></span>" +
      (unlocked ? "<span class='track__dur'>∞</span>" : "<span class='track__badge'>[unreleased]</span>");

    var panel = document.createElement("div");
    panel.className = "track__panel";
    var inner = document.createElement("div");
    var box = document.createElement("div");
    box.className = "hidden-reveal";
    box.style.margin = "var(--sp-md) 0 var(--sp-lg)";
    if (unlocked) {
      box.innerHTML = "<p class='tag'>Track 17 · terbuka</p><p class='hidden-reveal__msg'>" +
        esc(ht.message || "") + "</p>";
      row.addEventListener("click", function () { toggleTrack(n); });
    } else {
      box.innerHTML = "<p class='tag'>Terkunci sampai " + esc(fmtDateID(ht.unlock_date) || "nanti") + "</p>" +
        "<div class='countdown' id='hidden-countdown'></div>" +
        "<p class='hidden-reveal__msg mono' style='font-size:var(--fs-mono);color:var(--muted)'>Track ini akan terbuka sendiri pada waktunya.</p>";
      row.addEventListener("click", function () { toggleTrack(n); });
    }
    inner.appendChild(box);
    panel.appendChild(inner);
    wrap.appendChild(row);
    wrap.appendChild(panel);
    return wrap;
  }

  function toggleTrack(n, force) {
    var wrap = $(".track[data-n='" + n + "']");
    if (!wrap) return;
    var row = $(".track__row", wrap);
    var willOpen = force === true || (force !== false && !wrap.classList.contains("open"));
    if (willOpen) {
      if (openTrack != null && openTrack !== n) toggleTrack(openTrack, false);
      wrap.classList.add("open");
      row.setAttribute("aria-expanded", "true");
      openTrack = n;
    } else {
      wrap.classList.remove("open");
      row.setAttribute("aria-expanded", "false");
      if (openTrack === n) openTrack = null;
    }
  }

  // ---- liner notes ----
  function renderLiner() {
    $("#liner-head").textContent = "Liner notes — untuk " + (content.artist_a || "kamu");
    var body = $("#liner-body");
    body.innerHTML = "";
    var paras = String(content.liner_notes || "").split(/\n\n+/);
    paras.forEach(function (p) {
      if (!p.trim()) return;
      var el = document.createElement("p");
      el.className = "liner__p";
      charWrap(el, p.trim());
      body.appendChild(el);
    });
    var sign = $("#liner-sign");
    sign.innerHTML = "";
    charWrap(sign, content.closing || "");
    layoutStory(); // char list / pin heights changed
  }
  // wrap each character in <span class="c"> so scroll can highlight letter by letter.
  // Whole words stay wrapped together (no break opportunity between letter spans);
  // spaces become their own spans so lines still break normally.
  function charWrap(el, text) {
    for (var i = 0; i < text.length; i++) {
      var s = document.createElement("span");
      s.className = "c";
      s.textContent = text.charAt(i);
      el.appendChild(s);
    }
  }

  // ---- credits / 100 alasan ----
  function renderCredits() {
    var reasons = content.reasons || [];
    $("#credits-count").textContent = reasons.length + " kredit";
    // track of the day — deterministic from date
    renderTOTD();
    // list
    var list = $("#reasons");
    list.innerHTML = "";
    reasons.forEach(function (r, i) {
      var d = document.createElement("div");
      d.className = "reason";
      d.dataset.text = String(r).toLowerCase();
      d.innerHTML = "<span class='reason__n'>" + pad3(i + 1) + "</span><span class='reason__t'>" + esc(r) + "</span>";
      list.appendChild(d);
    });
    updateFilterCount();
  }
  function pad3(n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }

  function dayIndex() {
    var d = new Date();
    // days since epoch in local time -> stable within a day, changes next day
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000) + d.getFullYear() * 366;
  }
  function renderTOTD(forceIdx) {
    var reasons = content.reasons || [];
    if (!reasons.length) return;
    var idx = forceIdx == null ? (dayIndex() % reasons.length) : forceIdx;
    var el = $("#totd");
    el.innerHTML =
      "<span class='num'>" + pad3(idx + 1) + "</span>" +
      "<div class='body'><span class='k mono'>Track of the day</span>" +
      "<span class='v'>" + esc(reasons[idx]) + "</span></div>" +
      "<span class='tag'>#" + pad3(idx + 1) + "</span>";
  }

  function updateFilterCount() {
    var q = ($("#filter").value || "").trim().toLowerCase();
    var shown = 0;
    $$(".reason").forEach(function (d) {
      var hit = !q || d.dataset.text.indexOf(q) !== -1;
      d.classList.toggle("dim", !hit);
      d.classList.toggle("is-hit", !!q && hit);
      // highlight
      var t = $(".reason__t", d);
      var raw = t.textContent;
      if (q && hit) {
        var low = raw.toLowerCase(), pos = low.indexOf(q);
        if (pos !== -1) {
          t.innerHTML = esc(raw.slice(0, pos)) + "<mark>" + esc(raw.slice(pos, pos + q.length)) +
            "</mark>" + esc(raw.slice(pos + q.length));
        }
      } else if (!q) {
        t.textContent = raw;
      }
      if (hit) shown++;
    });
    $("#filter-count").textContent = q ? shown + " cocok" : "";
  }

  // ---- gallery (virtual museum wall) ----
  var albumFrames = [];   // cached photobox-album entries {src, ts}
  var deadAlbum = {};     // srcs that 404'd — never re-add (KV may still list them ~60s)
  var albumBound = false;
  var lastAlbumFetch = 0;
  function renderGallery() {
    var wall = $("#gallery-wall");
    if (!wall) return;
    wall.innerHTML = "";
    // curated track photos first
    (content.tracks || [])
      .slice()
      .sort(function (a, b) { return (a.n || 0) - (b.n || 0); })
      .forEach(function (t) {
        if (t.photo) wall.appendChild(frameEl(t.photo, pad(t.n) + " · " + (t.title || ""), fmtDateID(t.date) || ""));
      });
    // photobox album (cached across re-renders); each image self-heals if the
    // photo was deleted (404) — drop the frame instead of showing broken alt-text
    albumFrames.forEach(function (a) {
      var fr = frameEl(a.src, "Photobox · sesi berdua", a.ts);
      var img = fr.querySelector("img");
      if (img) {
        img.loading = "eager"; // load proactively so a deleted photo self-prunes before it's seen
        img.addEventListener("error", function () {
          deadAlbum[a.src] = true;
          albumFrames = albumFrames.filter(function (x) { return x.src !== a.src; });
          if (fr.parentNode) fr.parentNode.removeChild(fr);
          galleryCount(wall.children.length);
          galleryParallax.refresh();
          layoutStory();
        });
      }
      wall.appendChild(fr);
    });
    galleryCount(wall.children.length);
    galleryParallax.refresh();
    layoutStory(); // wall width changed -> recompute the pinned scroll track
    // images size asynchronously; recompute the track once each one lays out
    [].slice.call(wall.querySelectorAll("img")).forEach(function (im) {
      if (!im.complete) im.addEventListener("load", relayoutStory, { once: true });
    });
    // first paint: wire auto-refresh so the wall follows the album seamlessly,
    // then pull the current album
    if (!albumBound && /^https?:/.test(location.protocol)) {
      albumBound = true;
      window.addEventListener("pageshow", function (e) { if (e.persisted) refreshAlbum(); }); // back button / bfcache
      document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshAlbum(); });
      window.addEventListener("focus", function () { refreshAlbum(); });
      refreshAlbum(true);
    }
  }
  function albumKey(arr) { return arr.map(function (a) { return a.src; }).join("|"); }
  function refreshAlbum(force) {
    if (!/^https?:/.test(location.protocol)) return;
    var now = Date.now();
    if (!force && now - lastAlbumFetch < 3000) return; // throttle focus/visibility bursts
    lastAlbumFetch = now;
    fetch("/api/album", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var items = (j && j.items) ? j.items : [];
        var next = items
          .filter(function (a) { return !deadAlbum[a.url]; })
          .map(function (a) {
            var ts = "";
            if (a.uploaded) {
              var d = new Date(a.uploaded);
              if (!isNaN(d)) ts = d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
            }
            return { src: a.url, ts: ts };
          });
        if (albumKey(next) !== albumKey(albumFrames)) { albumFrames = next; renderGallery(); }
      })
      .catch(function () { /* album optional; ignore */ });
  }
  function galleryCount(n) {
    var c = $("#gallery-count");
    if (c) c.textContent = n ? n + " foto" : "";
    var empty = $("#gallery-empty");
    if (empty) empty.hidden = n > 0;
  }
  function frameEl(src, title, sub) {
    var fig = document.createElement("figure");
    fig.className = "frame";
    fig.innerHTML =
      "<div class='frame__mat'><span class='frame__pic'>" +
        "<img src='" + esc(src) + "' alt='" + esc(title) + "' loading='lazy'></span></div>" +
      "<figcaption class='frame__plaque'><span class='t'>" + esc(title) + "</span>" +
        (sub ? "<span class='d'>" + esc(sub) + "</span>" : "") +
      "</figcaption>";
    return fig;
  }

  // Gallery frames are flat (no 3D). Kept as a no-op so callers stay simple.
  var galleryParallax = { refresh: function () {} };
  function wireGalleryParallax() {}

  // ---- back cover ----
  function renderBack() {
    var note = $("#back-note");
    var nxt = nextAnniversary(startDate, new Date());
    note.textContent = "Pressing berikutnya ditekan pada " + fmtDateID(nxt.toISOString().slice(0, 10)) +
      ". Konten baru, track baru, catatan suara baru — kode yang sama.";
    // barcode (deterministic bars)
    var bc = $("#barcode"); bc.innerHTML = "";
    var seed = (content.catalog_no || "YS-004");
    var h = 0; for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    for (var b = 0; b < 42; b++) { h = (h * 1103515245 + 12345) >>> 0; var bar = document.createElement("i"); bar.style.height = (35 + (h % 65)) + "%"; bc.appendChild(bar); }
    // credits dl
    var dl = $("#back-credits");
    dl.innerHTML = "";
    var rows = [
      ["Artist", (content.artist_a || "") + " ♥ " + (content.artist_b || "")],
      ["Ditulis oleh", content.artist_b || ""],
      ["Katalog", content.catalog_no || "YS-004"],
      ["Label", content.label || "Yukisnow Corp."],
      ["Mulai", fmtDateID(content.start_date)],
      ["Track", (content.tracks || []).length + " + 1 tersembunyi"]
    ];
    rows.forEach(function (r) {
      var dt = document.createElement("dt"); dt.textContent = r[0];
      var dd = document.createElement("dd"); dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }

  // --------------------------------------------------------------- runtime + countdowns
  var runtimeTarget = { months: 0, days: 0 };
  function updateRuntime(animateIn) {
    var e = elapsed(startDate, new Date());
    runtimeTarget = e;
    if (animateIn && !prefersReduced()) countUp(e);
    else setRuntime(e.months, e.days);
  }
  function setRuntime(mo, da) {
    var txt = pad(mo) + ":" + pad(da);
    $("#runtime").textContent = txt;
    $("#now-runtime").textContent = txt;
  }
  function countUp(target) {
    var dur = 1100, t0 = null;
    function step(ts) {
      if (t0 == null) t0 = ts;
      var p = clamp((ts - t0) / dur, 0, 1);
      var e = 1 - Math.pow(1 - p, 3);
      setRuntime(Math.round(target.months * e), Math.round(target.days * e));
      if (p < 1) requestAnimationFrame(step); else setRuntime(target.months, target.days);
    }
    requestAnimationFrame(step);
  }

  function tickCountdowns() {
    var now = new Date();
    // back-cover next pressing
    renderCountdown($("#next-countdown"), nextAnniversary(startDate, now) - now);
    // hidden track
    var hc = $("#hidden-countdown");
    if (hc) {
      var ul = parseDate((content.hidden_track || {}).unlock_date);
      if (ul) {
        var diff = ul - now;
        if (diff <= 0) { render(); } // unlocked -> re-render to reveal
        else renderCountdown(hc, diff);
      }
    }
  }
  function renderCountdown(el, ms) {
    if (!el) return;
    ms = Math.max(0, ms);
    var s = Math.floor(ms / 1000);
    var dd = Math.floor(s / 86400); s -= dd * 86400;
    var hh = Math.floor(s / 3600); s -= hh * 3600;
    var mm = Math.floor(s / 60); s -= mm * 60;
    var units = [[dd, "hari"], [hh, "jam"], [mm, "menit"], [s, "detik"]];
    el.innerHTML = units.map(function (u) {
      return "<span class='unit'><b>" + pad(u[0]) + "</b><span>" + u[1] + "</span></span>";
    }).join("");
  }

  // --------------------------------------------------------------- turntable scroll
  var armEls = [];
  var nowSection, heroStage, heroTitles;
  var targetArm = 0, curArm = 0;
  var REST = -34, END = -5;

  function scrollProgress() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    return h > 0 ? clamp(window.scrollY / h, 0, 1) : 0;
  }
  function onFrame() {
    var p = scrollProgress();
    var reduced = prefersReduced();
    targetArm = lerp(REST, END, p);
    if (reduced) curArm = targetArm;
    else curArm += (targetArm - curArm) * 0.12;
    for (var i = 0; i < armEls.length; i++) armEls[i].style.setProperty("--arm", curArm.toFixed(2) + "deg");
    // gentle hero parallax — record drifts, title counter-drifts
    if (!reduced && heroStage) {
      var sy = window.scrollY, vh = window.innerHeight;
      if (sy < vh * 1.4) {
        heroStage.style.transform = "translate3d(0," + (sy * 0.16).toFixed(1) + "px,0)";
        if (heroTitles) heroTitles.style.transform = "translate3d(0," + (sy * -0.05).toFixed(1) + "px,0)";
      }
    }
    updateNowSection();
    updateStory();
    requestAnimationFrame(onFrame);
  }
  function updateNowSection() {
    var mid = window.innerHeight * 0.42;
    var secs = $$("[data-section]");
    var best = null;
    for (var i = 0; i < secs.length; i++) {
      var r = secs[i].getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) { best = secs[i]; break; }
      if (r.top > mid) break;
      best = secs[i];
    }
    if (best && nowSection) {
      var label = best.getAttribute("data-section");
      if (nowSection.textContent !== label) nowSection.textContent = label;
    }
  }

  // --------------------------------------------------------------- scroll-driven story
  // Two pinned sections react to scroll: the liner letter highlights word by word,
  // and the gallery pans its photos horizontally as you scroll down.
  var linerSec, linerPin, linerInner, linerWords = [], linerIdx = 0, linerEdge = null, linerOverflow = 0;
  var gallerySec, galleryWall;
  function padY(el) {
    var cs = getComputedStyle(el);
    return (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  var relayoutStory = debounce(function () { layoutStory(); }, 80);
  function layoutStory() {
    var reduced = prefersReduced();
    linerSec = $("#liner"); linerPin = $(".liner__pin"); linerInner = $("#liner-inner");
    if (linerSec && linerInner) {
      linerWords = [].slice.call(linerInner.querySelectorAll(".c"));
      linerInner.style.transform = "none";
      linerWords.forEach(function (w) { w.classList.remove("on", "edge"); });
      linerIdx = 0; linerEdge = null;
      if (reduced) {
        linerSec.classList.remove("is-progressive"); linerSec.style.minHeight = ""; linerOverflow = 0;
      } else {
        linerSec.classList.add("is-progressive");
        var avail = linerPin ? (linerPin.clientHeight - padY(linerPin)) : window.innerHeight;
        linerOverflow = Math.max(0, linerInner.offsetHeight - avail);
        linerSec.style.minHeight = Math.round(window.innerHeight + linerOverflow + window.innerHeight * 0.7) + "px";
      }
    }
    gallerySec = $("#gallery"); galleryWall = $("#gallery-wall");
    if (gallerySec && galleryWall) {
      if (reduced) { gallerySec.style.minHeight = ""; }
      else {
        var extra = Math.max(0, galleryWall.scrollWidth - galleryWall.clientWidth);
        gallerySec.style.minHeight = Math.round(window.innerHeight + extra) + "px";
      }
    }
  }
  function updateStory() {
    if (prefersReduced()) return;
    // Liner — pin the letter (pan it up if taller than the viewport), highlight
    // words up to the scroll progress with a pink leading edge.
    if (linerSec && linerWords.length) {
      var lr = linerSec.getBoundingClientRect();
      var lt = linerSec.offsetHeight - window.innerHeight;
      var lp = lt > 0 ? clamp(-lr.top / lt, 0, 1) : 0;
      if (linerOverflow) linerInner.style.transform = "translateY(" + (-lp * linerOverflow).toFixed(1) + "px)";
      var idx = Math.round(lp * linerWords.length);
      if (idx !== linerIdx) {
        var i;
        if (idx > linerIdx) { for (i = linerIdx; i < idx; i++) linerWords[i].classList.add("on"); }
        else { for (i = idx; i < linerIdx; i++) linerWords[i].classList.remove("on"); }
        if (linerEdge) linerEdge.classList.remove("edge");
        linerEdge = idx > 0 ? linerWords[Math.min(idx, linerWords.length) - 1] : null;
        if (linerEdge) linerEdge.classList.add("edge");
        linerIdx = idx;
      }
    }
    // Gallery — vertical scroll drives the horizontal pan (photos glide left -> right).
    if (gallerySec && galleryWall) {
      var gr = gallerySec.getBoundingClientRect();
      var gt = gallerySec.offsetHeight - window.innerHeight;
      var gp = gt > 0 ? clamp(-gr.top / gt, 0, 1) : 0;
      var max = galleryWall.scrollWidth - galleryWall.clientWidth;
      if (max > 0) galleryWall.scrollLeft = gp * max;
    }
  }

  // --------------------------------------------------------------- audio / now playing
  function setupAudio() {
    var btn = $("#playbtn"), icon = $("#playbtn-icon");
    audioEl.loop = true; // song repeats after it finishes
    var audioUnlocked = false, fadeTimer = null;
    function fadeVolume(target, ms, done) {
      if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
      target = Math.max(0, Math.min(1, target));
      var from = audioEl.volume, steps = Math.max(1, Math.round(ms / 30)), i = 0;
      fadeTimer = setInterval(function () {
        i++;
        audioEl.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
        if (i >= steps) { clearInterval(fadeTimer); fadeTimer = null; if (done) done(); }
      }, 30);
    }
    function unlockAudio() {
      if (audioUnlocked) return;
      audioUnlocked = true;
      audioEl.muted = false;
      try { audioEl.currentTime = 0; } catch (e) {}
      audioEl.volume = 0;
      if (audioEl.paused) audioEl.play().then(function () { fadeVolume(1, 700); }).catch(function () { fadeVolume(1, 700); });
      else fadeVolume(1, 700); // muted autoplay already running -> fade the sound in
    }
    function refresh() {
      icon.textContent = isPlaying ? "⏸" : "▶";
      btn.setAttribute("aria-pressed", isPlaying ? "true" : "false");
      btn.setAttribute("aria-label", isPlaying ? "Jeda lagu" : "Putar lagu");
      var di = $("#disc-toggle-icon"); if (di) di.textContent = isPlaying ? "⏸" : "▶";
      setSpin(isPlaying); // disc spins only while the song plays
    }
    // one shared toggle drives both the disc and the bottom bar -> always in sync
    function togglePlay() {
      if (!content.song_url) { toast("Belum ada lagu. Tambah di /edit.", true); return; }
      if (!audioEl.src) audioEl.src = content.song_url;
      if (!audioUnlocked) { unlockAudio(); return; } // first tap unmutes the autoplaying song
      if (audioEl.paused) {
        audioEl.volume = 0;
        audioEl.play().then(function () { fadeVolume(1, 450); }).catch(function () { toast("Gagal memutar audio.", true); });
      } else {
        fadeVolume(0, 450, function () { audioEl.pause(); audioEl.volume = 1; }); // fade out, then pause
      }
    }
    btn.addEventListener("click", togglePlay);
    var discToggle = $("#disc-toggle"); if (discToggle) discToggle.addEventListener("click", togglePlay);
    var miniTt = $("#mini-turntable"); if (miniTt) { miniTt.style.cursor = "pointer"; miniTt.addEventListener("click", togglePlay); }
    audioEl.addEventListener("play", function () { isPlaying = true; refresh(); });
    audioEl.addEventListener("pause", function () { isPlaying = false; refresh(); });
    audioEl.addEventListener("ended", function () { isPlaying = false; refresh(); });

    // song progress bar (seekable)
    var seek = $("#song-seek"), fill = $("#song-fill");
    audioEl.addEventListener("timeupdate", function () {
      if (fill && audioEl.duration) fill.style.setProperty("--p", (audioEl.currentTime / audioEl.duration * 100).toFixed(1) + "%");
    });
    if (seek) seek.addEventListener("click", function (e) {
      if (!audioEl.duration) return;
      var rect = seek.getBoundingClientRect();
      audioEl.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audioEl.duration;
    });
    refresh();

    // Autoplay: browsers only allow UNMUTED audio after a gesture. So autoplay the
    // looping song MUTED (allowed everywhere), then unmute from the start on her first
    // interaction (scroll / tap / key / play button). Closest possible to autoplay.
    if (content.song_url) {
      if (!audioEl.src) audioEl.src = content.song_url;
      audioEl.muted = true;
      audioEl.play().catch(function () {});
      ["scroll", "keydown", "click", "touchstart"].forEach(function (ev) {
        window.addEventListener(ev, unlockAudio, { once: true, passive: true });
      });
    }
  }
  function setSpin(playing) {
    // records always carry .spinning; play/pause is via animation-play-state on
    // body.song-playing, so pausing FREEZES the rotation in place (not reset to 0).
    ["#hero-record", "#mini-record"].forEach(function (sel) { var r = $(sel); if (r) r.classList.add("spinning"); });
    document.body.classList.toggle("song-playing", !!playing);
  }
  function spinOff() {
    ["#hero-record", "#mini-record"].forEach(function (sel) {
      var r = $(sel); if (r) { r.classList.remove("spinning"); r.classList.remove("playing"); }
    });
  }

  // --------------------------------------------------------------- reveals
  function setupReveals() {
    var els = $$(".reveal");
    if (!("IntersectionObserver" in window) || prefersReduced()) {
      els.forEach(function (e) { e.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.16 });
    els.forEach(function (e) { io.observe(e); });
  }

  // --------------------------------------------------------------- petals (blossom drift)
  // Soft two-ink petals falling like first snow. Restrained on purpose so the
  // printed look survives. Never runs under prefers-reduced-motion.
  function initPetals() {
    var canvas = document.getElementById("petals");
    if (!canvas || prefersReduced() || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0, petals = [];
    var COLORS = ["#FF4A7D", "#1C4FD8", "#F2EDE3"];
    function resize() {
      W = canvas.width = Math.floor(window.innerWidth * dpr);
      H = canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    }
    function make(seeded) {
      return {
        baseX: Math.random() * W,
        y: seeded ? Math.random() * H : -30 * dpr,
        r: (5 + Math.random() * 7) * dpr,
        sp: (0.25 + Math.random() * 0.6) * dpr,
        amp: (8 + Math.random() * 30) * dpr,
        ph: Math.random() * 6.283,
        sway: 0.006 + Math.random() * 0.012,
        rot: Math.random() * 6.283,
        vr: (Math.random() - 0.5) * 0.03,
        op: 0.16 + Math.random() * 0.26,
        col: COLORS[(Math.random() * COLORS.length) | 0]
      };
    }
    resize();
    var N = Math.max(9, Math.min(22, Math.round(window.innerWidth / 90)));
    for (var i = 0; i < N; i++) petals.push(make(true));
    window.addEventListener("resize", resize);
    function frame() {
      requestAnimationFrame(frame);
      if (document.hidden) return;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < petals.length; i++) {
        var p = petals[i];
        p.y += p.sp; p.ph += p.sway; p.rot += p.vr;
        if (p.y > H + 30 * dpr) petals[i] = p = make(false);
        var x = p.baseX + Math.sin(p.ph) * p.amp;
        ctx.save();
        ctx.translate(x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.op;
        ctx.fillStyle = p.col;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 0.55, p.r, 0, 0, 6.283);
        ctx.fill();
        ctx.restore();
      }
    }
    frame();
  }

  // --------------------------------------------------------------- toast
  var toastTimer;
  function toast(msg, isErr) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("err", !!isErr);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  // --------------------------------------------------------------- keyboard nav
  function setupKeyboard() {
    var list = $("#tracklist");
    list.addEventListener("keydown", function (e) {
      var rows = $$(".track__row", list);
      var idx = rows.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); if (idx < rows.length - 1) rows[idx + 1].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (idx > 0) rows[idx - 1].focus(); }
      else if (e.key === "Escape") { if (openTrack != null) { var o = openTrack; toggleTrack(o, false); } }
    });
  }

  // --------------------------------------------------------------- routing
  function handleRoute() {
    var h = location.hash || "";
    if (h.indexOf("edit") === 1 || h === "#edit") { Editor.open(); return; }
    Editor.close();
    var m = /#\/track\/(\d+)/.exec(h);
    if (m) {
      var n = parseInt(m[1], 10);
      var wrap = $(".track[data-n='" + n + "']");
      if (wrap) {
        toggleTrack(n, true);
        setTimeout(function () { wrap.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "center" }); }, 60);
      }
    }
  }

  // --------------------------------------------------------------- credits controls
  function setupCredits() {
    $("#filter").addEventListener("input", updateFilterCount);
    $("#shuffle").addEventListener("click", function () {
      var reasons = content.reasons || []; if (!reasons.length) return;
      var el = $("#totd");
      el.classList.remove("flicker"); void el.offsetWidth; el.classList.add("flicker");
      renderTOTD(Math.floor(Math.random() * reasons.length));
    });
  }

  /* =========================================================================
     EDITOR — the mixing desk
     ====================================================================== */
  var Editor = (function () {
    var root = $("#edit");
    var unlocked = false;
    var mediaRecorder = null, recChunks = [], recStart = 0, recTimer = null, recStream = null, recStarting = false;

    function open() {
      root.classList.add("on");
      document.body.classList.add("editing");
      renderShell();
    }
    function close() {
      root.classList.remove("on");
      document.body.classList.remove("editing");
      stopRecording(true);
    }

    function renderShell() {
      if (!unlocked) { renderGate(); return; }
      root.innerHTML =
        "<div class='edit__bar'>" +
          "<span class='brand'>Mixing desk · <b>" + esc(content.catalog_no || "YS-004") + "</b></span>" +
          "<div class='edit__actions'>" +
            "<button class='btn' id='ed-export' type='button'>Export</button>" +
            "<button class='btn btn--solid' id='ed-save' type='button'>Save</button>" +
            "<button class='btn' id='ed-close' type='button' aria-label='Tutup'>Tutup ✕</button>" +
          "</div>" +
        "</div>" +
        "<div class='edit__wrap'>" +
          "<div class='tabs' role='tablist'>" +
            tabBtn("master", "Master", true) + tabBtn("tracks", "Tracks") +
            tabBtn("credits", "Kredit") + tabBtn("hidden", "Rahasia") +
          "</div>" +
          "<div class='panel on' id='p-master'></div>" +
          "<div class='panel' id='p-tracks'></div>" +
          "<div class='panel' id='p-credits'></div>" +
          "<div class='panel' id='p-hidden'></div>" +
        "</div>";
      $("#ed-close").addEventListener("click", function () { location.hash = ""; });
      $("#ed-save").addEventListener("click", save);
      $("#ed-export").addEventListener("click", exportJSON);
      $$(".tab", root).forEach(function (b) {
        b.addEventListener("click", function () { selectTab(b.dataset.tab); });
      });
      renderMaster(); renderTracks(); renderCredits2(); renderHidden();
    }
    function tabBtn(id, label, sel) {
      return "<button class='tab' role='tab' data-tab='" + id + "' aria-selected='" + (sel ? "true" : "false") +
        "'>" + esc(label) + "<span class='tab__ind'></span></button>";
    }
    function selectTab(id) {
      $$(".tab", root).forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === id ? "true" : "false"); });
      $$(".panel", root).forEach(function (p) { p.classList.toggle("on", p.id === "p-" + id); });
    }

    function renderGate() {
      root.innerHTML =
        "<div class='gate'><div class='gate__card'>" +
          "<h2>Mixing desk</h2>" +
          "<p>Masukkan passcode untuk membuka editor.</p>" +
          "<div class='gate__row'>" +
            "<input class='field' id='gate-pass' type='password' placeholder='Passcode' autocomplete='off' aria-label='Passcode'>" +
            "<button class='btn btn--solid' id='gate-go' type='button'>Buka</button>" +
          "</div>" +
          "<p class='gate__err' id='gate-err' role='alert'></p>" +
          "<p class='hint'>Tekan Esc untuk kembali ke situs.</p>" +
        "</div></div>";
      var input = $("#gate-pass");
      function tryUnlock() {
        if ((input.value || "") === (content.passcode || "")) {
          unlocked = true; renderShell();
        } else {
          $("#gate-err").textContent = "Passcode salah.";
          input.value = ""; input.focus();
        }
      }
      $("#gate-go").addEventListener("click", tryUnlock);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
      input.focus();
    }

    // ---- Master ----
    function renderMaster() {
      var p = $("#p-master");
      p.innerHTML =
        strip("Preview lokal", "<button class='btn' id='m-reset' type='button'>Reset ke versi terbit</button>" +
          "<p class='hint'>Perangkat ini menyimpan hasil SAVE kamu (preview). Kalau situs menampilkan konten lama padahal sudah kamu terbitkan, tekan ini untuk membuang preview lokal lalu muat ulang.</p>") +
        strip("Nama kamu", inp("artist_a")) +
        strip("Nama dia", inp("artist_b")) +
        strip("Judul album", inp("album_title")) +
        strip("Katalog no.", inp("catalog_no")) +
        strip("Label", inp("label")) +
        strip("Tanggal mulai", inp("start_date", "date")) +
        strip("Lagu (file)", "<input class='field' id='m-song' type='file' accept='audio/*'>" +
          "<p class='hint' id='m-song-h'>" + (content.song_url ? "Lagu tersimpan." : "Belum ada lagu.") + "</p>") +
        strip("Liner notes", txt("liner_notes", 7)) +
        strip("Closing", inp("closing")) +
        strip("Footer", inp("footer")) +
        strip("Passcode", inp("passcode")) +
        strip("Token terbit (KV)", "<input class='field' id='m-token' type='password' placeholder='opsional — untuk Mode B' value='" +
          esc(localStorage.getItem(LS_TOKEN) || "") + "'><p class='hint'>Disimpan hanya di perangkat ini, bukan di content.json.</p>");
      bindInputs(p);
      $("#m-token").addEventListener("input", function () { localStorage.setItem(LS_TOKEN, this.value); });
      $("#m-reset").addEventListener("click", function () {
        if (confirm("Buang preview lokal di perangkat ini dan muat versi yang sudah terbit?")) {
          try { localStorage.removeItem(LS_CONTENT); } catch (e) {}
          location.reload();
        }
      });
      $("#m-song").addEventListener("change", function (e) {
        var f = e.target.files[0]; if (!f) return;
        blobToDataURL(f).then(function (d) { content.song_url = d; audioEl.src = ""; $("#m-song-h").textContent = "Lagu diperbarui (" + Math.round(f.size / 1024) + " KB)."; checkSize(); });
      });
    }

    // ---- Tracks ----
    function renderTracks() {
      var p = $("#p-tracks");
      p.innerHTML = "<div id='tk-list'></div>" +
        "<button class='btn' id='tk-add' type='button' style='margin-top:var(--sp-md)'>+ Tambah track</button>";
      var list = $("#tk-list", p);
      (content.tracks || []).forEach(function (t, i) { list.appendChild(trackCard(t, i)); });
      $("#tk-add").addEventListener("click", function () {
        content.tracks = content.tracks || [];
        content.tracks.push({ n: content.tracks.length + 1, title: "", date: "", story: "", photo: "", commentary: "" });
        renumber(); renderTracks();
      });
    }
    function trackCard(t, i) {
      var card = document.createElement("div");
      card.className = "tk";
      card.innerHTML =
        "<div class='tk__top'><span class='tk__n'>Track " + pad(t.n) + "</span>" +
          "<div class='tk__grip'>" +
            "<button class='iconbtn' data-act='up' aria-label='Naik'>↑</button>" +
            "<button class='iconbtn' data-act='down' aria-label='Turun'>↓</button>" +
            "<button class='iconbtn danger' data-act='del' aria-label='Hapus'>✕</button>" +
          "</div></div>" +
        "<input class='field' data-f='title' placeholder='Judul track' value='" + esc(t.title) + "'>" +
        "<input class='field' data-f='date' type='date' value='" + esc(t.date) + "'>" +
        "<textarea class='field' data-f='story' placeholder='Cerita...'>" + esc(t.story) + "</textarea>" +
        "<div class='tk__media'>" +
          "<div class='uploader'><span class='uploader__label'>Foto</span>" +
            (t.photo ? "<img class='thumb' src='" + esc(t.photo) + "' alt=''>" : "") +
            "<input type='file' accept='image/*' data-f='photo'>" +
            (t.photo ? "<button class='btn' data-act='delphoto' type='button'>Hapus foto</button>" : "") +
          "</div>" +
          "<div class='uploader'><span class='uploader__label'>Catatan suara</span>" +
            "<span class='hint' style='margin:0 0 .25em'>📖 Baca ini pas rekam:</span>" +
            "<textarea class='field' data-f='prompt' rows='2' placeholder='Prompt buat dibaca pas rekam…'>" + esc(t.prompt) + "</textarea>" +
            recorderUI(t) +
          "</div>" +
        "</div>";
      wireTrackCard(card, i);
      return card;
    }
    function recorderUI(t) {
      var canRec = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
      var html = "";
      if (t.commentary) {
        html += "<audio controls src='" + esc(t.commentary) + "' style='width:100%'></audio>" +
          "<button class='btn' data-act='delvoice' type='button'>Hapus suara</button>";
      }
      if (canRec) {
        html += "<div class='rec'><span class='rec__dot'></span>" +
          "<button class='btn' data-act='rec' type='button'>" + (t.commentary ? "Rekam ulang" : "Rekam") + "</button>" +
          "<button class='btn' data-act='stop' type='button' hidden>Stop</button>" +
          "<span class='rec__time'>0:00</span></div>";
      } else if (!t.commentary) {
        html += "<p class='hint'>Perekaman butuh koneksi https (buka situs versi live, bukan file lokal).</p>";
      }
      return html;
    }
    function wireTrackCard(card, i) {
      card.querySelector("[data-f='title']").addEventListener("input", function () { content.tracks[i].title = this.value; });
      card.querySelector("[data-f='date']").addEventListener("input", function () { content.tracks[i].date = this.value; });
      card.querySelector("[data-f='story']").addEventListener("input", function () { content.tracks[i].story = this.value; });
      var pf = card.querySelector("[data-f='prompt']");
      if (pf) pf.addEventListener("input", function () { content.tracks[i].prompt = this.value; });
      card.querySelector("[data-f='photo']").addEventListener("change", function (e) {
        var f = e.target.files[0]; if (!f) return;
        downscaleImage(f).then(function (d) { content.tracks[i].photo = d; renderTracks(); checkSize(); });
      });
      act(card, "up", function () { if (i > 0) { swap(content.tracks, i, i - 1); renumber(); renderTracks(); } });
      act(card, "down", function () { if (i < content.tracks.length - 1) { swap(content.tracks, i, i + 1); renumber(); renderTracks(); } });
      act(card, "del", function () { if (confirm("Hapus track ini?")) { content.tracks.splice(i, 1); renumber(); renderTracks(); } });
      act(card, "delphoto", function () { content.tracks[i].photo = ""; renderTracks(); });
      act(card, "delvoice", function () { content.tracks[i].commentary = ""; renderTracks(); });
      act(card, "rec", function () { startRecording(card, i); });
      act(card, "stop", function () { stopRecording(); });
    }
    function act(card, name, fn) {
      var b = card.querySelector("[data-act='" + name + "']");
      if (b) b.addEventListener("click", fn);
    }
    function swap(a, i, j) { var t = a[i]; a[i] = a[j]; a[j] = t; }
    function renumber() { (content.tracks || []).forEach(function (t, k) { t.n = k + 1; }); }

    // ---- voice recording ----
    function startRecording(card, i) {
      if (mediaRecorder || recStarting) return;
      recStarting = true;
      var recEl = $(".rec", card);
      var recBtn = $("[data-act='rec']", card), stopBtn = $("[data-act='stop']", card);
      if (recEl) recEl.classList.add("live");        // immediate feedback, before the mic resolves
      if (recBtn) recBtn.hidden = true;
      if (stopBtn) stopBtn.hidden = false;
      var tm0 = $(".rec__time", card); if (tm0) tm0.textContent = "0:00";
      // reuse an already-open mic so re-records start instantly; only getUserMedia the first time
      var need = (recStream && recStream.active)
        ? Promise.resolve(recStream)
        : navigator.mediaDevices.getUserMedia({ audio: true });
      need.then(function (stream) {
        recStream = stream;
        recStarting = false;
        if (!stopBtn || stopBtn.hidden) return;      // Stop was hit before the mic was ready
        var mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"].filter(function (m) {
          return window.MediaRecorder.isTypeSupported(m);
        })[0] || "";
        var mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        mediaRecorder = mr;
        recChunks = [];
        mr.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
        mr.onstop = function () { // local mr — stopRecording() nulls the module var before this async fires
          var blob = new Blob(recChunks, { type: mr.mimeType || mime || "audio/webm" });
          blobToDataURL(blob).then(function (d) {
            content.tracks[i].commentary = d; renderTracks(); checkSize();
            toast("Rekaman tersimpan. Jangan lupa Save atau Export.");
          });
        }; // recStream stays open for instant re-records; released on editor close
        recStart = Date.now();
        mr.start();
        recTimer = setInterval(function () {
          var s = Math.floor((Date.now() - recStart) / 1000);
          var tm = $(".rec__time", card); if (tm) tm.textContent = fmtClock(s);
          if (s >= 60) stopRecording();
        }, 250);
      }).catch(function () {
        recStarting = false;
        if (recEl) recEl.classList.remove("live");
        if (recBtn) recBtn.hidden = false;
        if (stopBtn) stopBtn.hidden = true;
        toast("Tidak bisa akses mikrofon. Izinkan mic di browser.", true);
      });
    }
    function stopRecording(silent) {
      recStarting = false;
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try { mediaRecorder.stop(); } catch (e) {}
      }
      mediaRecorder = null;
      if (silent) cleanupStream(); // release the mic only when leaving the editor
    }
    function cleanupStream() { if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; } }

    // ---- Credits ----
    function renderCredits2() {
      var p = $("#p-credits");
      p.innerHTML =
        "<div id='cr-list'></div>" +
        "<button class='btn' id='cr-add' type='button' style='margin:var(--sp-md) 0'>+ Tambah alasan</button>" +
        "<div class='strip'><label>Tempel massal</label><div>" +
          "<textarea class='field' id='cr-bulk' placeholder='Satu alasan per baris...'></textarea>" +
          "<div style='display:flex;gap:var(--sp-xs);margin-top:var(--sp-xs);flex-wrap:wrap'>" +
            "<button class='btn' id='cr-append' type='button'>Tambah ke daftar</button>" +
            "<button class='btn' id='cr-replace' type='button'>Ganti semua</button></div>" +
          "<p class='hint'>Total sekarang: <b id='cr-count'>" + (content.reasons || []).length + "</b></p>" +
        "</div></div>";
      var list = $("#cr-list", p);
      (content.reasons || []).forEach(function (r, i) { list.appendChild(reasonRow(r, i)); });
      $("#cr-add").addEventListener("click", function () { content.reasons.push(""); renderCredits2(); });
      $("#cr-append").addEventListener("click", function () { bulk(false); });
      $("#cr-replace").addEventListener("click", function () { if (confirm("Ganti semua alasan?")) bulk(true); });
    }
    function reasonRow(r, i) {
      var row = document.createElement("div");
      row.className = "tk";
      row.style.padding = "var(--sp-xs) var(--sp-sm)";
      row.innerHTML =
        "<div style='display:flex;gap:var(--sp-xs);align-items:center'>" +
          "<span class='tk__n'>" + pad3(i + 1) + "</span>" +
          "<input class='field' data-f='reason' value='" + esc(r) + "' style='flex:1'>" +
          "<button class='iconbtn' data-act='up' aria-label='Naik'>↑</button>" +
          "<button class='iconbtn' data-act='down' aria-label='Turun'>↓</button>" +
          "<button class='iconbtn danger' data-act='del' aria-label='Hapus'>✕</button>" +
        "</div>";
      row.querySelector("[data-f='reason']").addEventListener("input", function () { content.reasons[i] = this.value; });
      act(row, "up", function () { if (i > 0) { swap(content.reasons, i, i - 1); renderCredits2(); } });
      act(row, "down", function () { if (i < content.reasons.length - 1) { swap(content.reasons, i, i + 1); renderCredits2(); } });
      act(row, "del", function () { content.reasons.splice(i, 1); renderCredits2(); });
      return row;
    }
    function bulk(replace) {
      var lines = ($("#cr-bulk").value || "").split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return;
      content.reasons = replace ? lines : (content.reasons || []).concat(lines);
      renderCredits2();
    }

    // ---- Hidden ----
    function renderHidden() {
      var p = $("#p-hidden");
      var ht = content.hidden_track || (content.hidden_track = { unlock_date: "", message: "" });
      p.innerHTML =
        strip("Tanggal buka", "<input class='field' id='h-date' type='date' value='" + esc(ht.unlock_date) + "'>") +
        strip("Pesan rahasia", "<textarea class='field' id='h-msg' rows='5'>" + esc(ht.message) + "</textarea>");
      $("#h-date").addEventListener("input", function () { ht.unlock_date = this.value; });
      $("#h-msg").addEventListener("input", function () { ht.message = this.value; });
    }

    // ---- form helpers ----
    function strip(label, control) {
      return "<div class='strip'><label>" + esc(label) + "</label><div>" + control + "</div></div>";
    }
    function inp(field, type) {
      return "<input class='field' data-bind='" + field + "' type='" + (type || "text") + "' value='" + esc(content[field] || "") + "'>";
    }
    function txt(field, rows) {
      return "<textarea class='field' data-bind='" + field + "' rows='" + (rows || 4) + "'>" + esc(content[field] || "") + "</textarea>";
    }
    function bindInputs(scope) {
      $$("[data-bind]", scope).forEach(function (el) {
        el.addEventListener("input", function () { content[el.dataset.bind] = el.value; });
      });
    }

    // ---- save / export ----
    // Effective persisted size ignores inline media — those get uploaded to KV,
    // not stored in the content blob.
    function currentSize() {
      try {
        var s = JSON.stringify(content, function (k, v) {
          return (typeof v === "string" && v.indexOf("data:") === 0) ? "data:" : v;
        });
        return new Blob([s]).size;
      } catch (e) { return 0; }
    }
    function checkSize() {
      var mb = currentSize() / 1048576;
      if (mb > 4) toast("Perhatian: teks konten " + mb.toFixed(1) + "MB (>4MB).", true);
    }

    // Media lives in KV as its own file; the content blob only keeps URLs.
    function isDataUrl(v) { return typeof v === "string" && v.indexOf("data:") === 0; }
    function eachMediaField(fn) {
      (content.tracks || []).forEach(function (t) { fn(t, "photo"); fn(t, "commentary"); });
      if (content.hidden_track) { fn(content.hidden_track, "photo"); fn(content.hidden_track, "commentary"); }
      fn(content, "song_url");
    }
    function hasInlineMedia() {
      var found = false;
      eachMediaField(function (obj, key) { if (isDataUrl(obj[key])) found = true; });
      return found;
    }
    function uploadMedia(blob, ct, token) {
      return fetch("/api/media", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": ct || "application/octet-stream" },
        body: blob
      }).then(function (r) { if (!r.ok) throw new Error("upload " + r.status); return r.json(); })
        .then(function (j) { if (!j || !j.url) throw new Error("no url"); return j.url; });
    }
    // Upload every embedded photo/recording, replacing each data: URL in-place
    // with its hosted /api/media URL. Resolves with the count moved online.
    function migrateInlineMedia(token) {
      var jobs = [], moved = 0, failed = 0;
      eachMediaField(function (obj, key) {
        if (!isDataUrl(obj[key])) return;
        var val = obj[key];
        jobs.push(
          fetch(val).then(function (r) { return r.blob(); })
            .then(function (b) { return uploadMedia(b, b.type, token); })
            .then(function (u) { obj[key] = u; moved++; })
            .catch(function () { failed++; })
        );
      });
      return Promise.all(jobs).then(function () { return { moved: moved, failed: failed }; });
    }
    function save() {
      var token = localStorage.getItem(LS_TOKEN);
      var http = /^https?:/.test(location.protocol);
      if (token && http && hasInlineMedia()) {
        toast("Mengunggah foto & suara ke online…");
        migrateInlineMedia(token).then(function (res) {
          persist(token, http, res.failed);
        }).catch(function () { persist(token, http, 1); });
      } else {
        persist(token, http, 0);
      }
    }
    function persist(token, http, failed) {
      var localOk = true;
      try { localStorage.setItem(LS_CONTENT, JSON.stringify(content)); }
      catch (e) { localOk = false; }
      applyLive();
      if (token && http) {
        fetch("/api/content", {
          method: "PUT",
          headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify(content)
        }).then(function (r) {
          if (!r.ok) { toast("Gagal terbit (" + r.status + "). Cek token di Master.", true); return; }
          if (failed) toast("Terbit online ✓, tapi " + failed + " media gagal diunggah — coba Save lagi.", true);
          else toast(localOk ? "Tersimpan & terbit untuk semua ✓" : "Terbit online ✓ (media aman di server).");
        }).catch(function () { toast("Gagal terbit — jaringan. Coba lagi.", true); });
      } else if (!localOk) {
        toast("Perangkat penuh & belum online. Isi 'Token terbit (KV)' di Master untuk unggah online.", true);
      } else {
        toast("Tersimpan di perangkat ini SAJA (belum online). Isi 'Token terbit (KV)' di Master biar terbit buat semua.", true);
      }
      checkSize();
    }
    function applyLive() {
      var scrollY = window.scrollY;
      render();
      window.scrollTo(0, scrollY);
    }
    function exportJSON() {
      var blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "content.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("content.json diunduh. Commit untuk terbit.");
    }

    return { open: open, close: close };
  })();

  // --------------------------------------------------------------- media utils
  function blobToDataURL(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }
  function downscaleImage(file, maxW, quality) {
    maxW = maxW || 1400; quality = quality || 0.82;
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxW / img.width);
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try { res(c.toDataURL("image/jpeg", quality)); } catch (e) { rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("bad image")); };
      img.src = url;
    });
  }

  // --------------------------------------------------------------- global keys
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.body.classList.contains("editing")) {
      // only leave editor if not typing in a field OR gate
      location.hash = "";
    }
  });

  // --------------------------------------------------------------- init
  function init() {
    armEls = [$("#hero-turntable"), $("#mini-turntable")].filter(Boolean).map(function (t) { return t; });
    // arm elements set --arm on the .turntable containers
    nowSection = $("#now-section");
    heroStage = $(".hero__stage");
    heroTitles = $(".hero__titles");
    initPetals();

    loadContent().then(function (c) {
      content = c;
      render();
      setupAudio();
      setupCredits();
      setupKeyboard();
      wireGalleryParallax();
      layoutStory();
      setSpin(false); // stopped until the song plays

      // recompute the pinned scroll tracks once fonts/images settle and on resize
      window.addEventListener("load", relayoutStory);
      window.addEventListener("resize", debounce(layoutStory, 150));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayoutStory);
      setTimeout(relayoutStory, 400); // safety net if load already fired

      // hero entrance
      var tt = $("#hero-turntable");
      if (tt && !prefersReduced()) {
        tt.classList.add("drop");
        setTimeout(function () { tt.classList.remove("drop"); }, 1500);
      }

      handleRoute();
      window.addEventListener("hashchange", handleRoute);

      requestAnimationFrame(onFrame);
      tickCountdowns();
      setInterval(tickCountdowns, 1000);
      setInterval(function () { updateRuntime(false); }, 60000);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
