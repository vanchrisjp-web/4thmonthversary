/* =============================================================================
   bingkai.js — a photobox strip: where each picture sits, and what it sits in.

   A strip used to be one function per layout, with the paper, the footer and
   "KAMU ♥ AKU" drawn into every one of them. It is two things, and they are
   kept apart here:

     plan(o)  the LAYOUT: how many shots, and where the two pictures of each
              shot go ("a" is the one pressing the shutter, "b" the other).
     draw()   the FRAME: paper, decoration, caption, date, pressing number.

   That separation is what lets any layout wear any frame, and it is why the
   live preview in the booth, the little cards you choose from, and the strip
   that is printed are all the same two calls -- the preview IS the print,
   drawn smaller. Nothing here touches the DOM, the clock, or unseeded
   randomness: the booth passes in the pictures, the date and the pressing,
   and bingkai.test.mjs runs every layout in every frame.
   ========================================================================== */
(function (root) {
  "use strict";

  var MAXW = 2400, MAXH = 3600;   // a 2400x3600 PNG of photographs is ~4 MB; the album takes 5

  var RASIO = { "4:3": 3 / 4, "1:1": 1, "3:4": 4 / 3, "16:9": 9 / 16 };
  var RASIO_ORDER = ["4:3", "1:1", "3:4", "16:9"];

  var LAYOUTS = [
    { id: "side", name: "Berdampingan", note: "1 jepretan" },
    { id: "bareng", name: "Satu tempat", note: "berdua di satu latar · 1 jepretan" },
    { id: "stack", name: "Tumpuk", note: "1 jepretan" },
    { id: "grid", name: "Kotak 2×2", note: "2 jepretan" },
    { id: "strip", name: "Strip ×3", note: "3 jepretan" },
    { id: "strip4", name: "Strip ×4", note: "4 jepretan" },
    { id: "klasik", name: "Strip klasik", note: "satu kolom · 2 jepretan" },
    { id: "mendatar", name: "Pita mendatar", note: "kamu atas, dia bawah · 3 jepretan" },
    { id: "belah", name: "Satu frame", note: "dibelah dua · 1 jepretan" },
    { id: "jendela", name: "Jendela kecil", note: "satu besar, satu kecil" },
    { id: "polaroid", name: "Polaroid", note: "dua lembar · 1 jepretan" },
    { id: "kustom", name: "Kustom", note: "atur sendiri" }
  ];
  var LAYOUT_IDS = LAYOUTS.map(function (l) { return l.id; });

  var SUSUN = [
    { id: "pasang", name: "Berpasangan" },
    { id: "tumpuk", name: "Bertumpuk" },
    { id: "kolom", name: "Satu kolom" },
    { id: "baris", name: "Satu baris" }
  ];
  var POSISI = [
    { id: "atas", name: "Atas" },
    { id: "bawah", name: "Bawah" },
    { id: "tanpa", name: "Tanpa" }
  ];

  /* Five faces, all loaded by photobox.html. `k` evens out how big each one
     looks at the same pixel size (Caveat is small for its size), and `est`
     is its average advance per character -- used only to decide, before any
     canvas exists, whether a caption fits beside the date. */
  var HURUF = {
    tegas:  { name: "Tegas", family: "'Archivo', 'Arial Black', sans-serif", weight: 800, style: "normal", upper: true, track: 0.02, k: 1, est: 0.66, nudge: 0.04 },
    lebar:  { name: "Lebar", family: "'Mona Sans', 'Helvetica Neue', Arial, sans-serif", weight: 800, style: "normal", upper: false, track: -0.01, k: 1.05, est: 0.56, nudge: 0.04 },
    mesin:  { name: "Mesin ketik", family: "'IBM Plex Mono', 'Space Mono', monospace", weight: 600, style: "normal", upper: true, track: 0.06, k: 0.9, est: 0.66, nudge: 0.04 },
    anggun: { name: "Anggun", family: "'Fraunces', Georgia, serif", weight: 500, style: "italic", upper: false, track: 0, k: 1.12, est: 0.5, nudge: 0.02 },
    tangan: { name: "Tulisan tangan", family: "'Caveat', 'Segoe Print', cursive", weight: 700, style: "normal", upper: false, track: 0, k: 1.45, est: 0.42, nudge: 0 }
  };
  var HURUF_ORDER = ["tegas", "lebar", "mesin", "anggun", "tangan"];

  /* The frames. `pakai` is what choosing the frame sets -- but only for values
     still at the previous frame's own setting, so a thickness you dragged
     yourself survives a change of paper (see pakai()). */
  var FRAMES = {
    ladang: {
      name: "Ladang Bunga", paper: "#EDE8DC", ink: "#1B1A15", soft: "#5F5C52", accent: "#B5502C", moss: "#3E4B33",
      line: "rgba(27,26,21,0.78)", rule: "rgba(27,26,21,0.22)", mono: "'IBM Plex Mono', 'Space Mono', monospace",
      decor: "ladang", pakai: { tebal: 28, jarak: 14, sudut: 0, huruf: "lebar" }
    },
    sisia: {
      name: "Sisi A", paper: "#F2EDE3", ink: "#12100E", soft: "#9A958C", accent: "#FF4A7D",
      line: "rgba(18,16,14,0.85)", rule: "rgba(18,16,14,0.25)", mono: "'Space Mono', monospace",
      decor: "", pakai: { tebal: 18, jarak: 14, sudut: 0, huruf: "tegas" }
    },
    kafe: {
      name: "Kafe Malam", paper: "#101017", ink: "#FBF7F0", soft: "#8A8598", accent: "#E0A356",
      line: "rgba(224,163,86,0.55)", rule: "rgba(224,163,86,0.3)", mono: "'Space Mono', monospace",
      decor: "kafe", pakai: { tebal: 26, jarak: 12, sudut: 6, huruf: "anggun" }
    },
    salju: {
      name: "Salju", paper: "#E9EFF3", ink: "#1D2935", soft: "#667789", accent: "#4F7FA8",
      line: "rgba(29,41,53,0.45)", rule: "rgba(29,41,53,0.2)", mono: "'IBM Plex Mono', monospace",
      decor: "salju", pakai: { tebal: 26, jarak: 14, sudut: 12, huruf: "lebar" }
    },
    film: {
      name: "Film", paper: "#141210", ink: "#F2EDE3", soft: "#A39B8C", accent: "#F0A23A",
      line: "", rule: "rgba(242,237,227,0.18)", mono: "'Space Mono', monospace",
      decor: "film", pakai: { tebal: 42, jarak: 10, sudut: 3, huruf: "mesin" }
    },
    putih: {
      name: "Kertas putih", paper: "#FFFFFF", ink: "#1B1A15", soft: "#8A877E", accent: "#1B1A15",
      line: "rgba(27,26,21,0.12)", rule: "rgba(27,26,21,0.12)", mono: "'IBM Plex Mono', monospace",
      decor: "", pakai: { tebal: 34, jarak: 22, sudut: 0, huruf: "lebar" }
    },
    none: {
      name: "Tanpa bingkai", paper: "", ink: "#FFFDF8", soft: "rgba(255,253,248,0.82)", accent: "#FFB199",
      line: "", rule: "", mono: "'IBM Plex Mono', 'Space Mono', monospace", decor: "", pakai: null
    }
  };
  var FRAME_ORDER = ["ladang", "sisia", "kafe", "salju", "film", "putih", "none"];

  var WARNA = ["#EDE8DC", "#FFFFFF", "#F4C9D4", "#C9DDF0", "#DCE6C8", "#3E4B33", "#B5502C", "#1B1A15"];

  var PRESS = {
    "004": { name: "Sisi A", bulan: "Empat bulan", tgl: "17.07.2026" },
    "005": { name: "Kafe Malam", bulan: "Lima bulan", tgl: "17.08.2026" },
    "006": { name: "Ladang Bunga", bulan: "Enam bulan", tgl: "17.09.2026" }
  };

  var DEF = {
    layout: "side", n: 3, susun: "pasang", rasio: "4:3", tukar: false,
    frame: "sisia", tebal: 18, jarak: 14, sudut: 0, warna: "", hiasan: true, garis: true,
    teks: "Kamu ♥ Aku", posisi: "bawah", huruf: "tegas", ukuran: 100, tanggal: true, cap: true,
    look: "asli", hitung: 3,
    // the green screen: which wallpaper, how you are cut out, and where you stand in "Satu tempat"
    latar: "asli", potong: "otomatis", peka: 45, tepi: 2,
    besarH: 100, besarG: 100, jarakOrang: 45, depan: "G", wallKey: "",
    at: 0
  };

  var DATE_SAMPLE = "17 September 2026  ·  17:17";

  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function has(list, id) { for (var i = 0; i < list.length; i++) if ((list[i].id || list[i]) === id) return true; return false; }
  function int(v, lo, hi, dflt) {
    var n = Math.round(Number(v));
    return isFinite(n) && v !== "" && v !== null && v !== true && v !== false ? Math.max(lo, Math.min(hi, n)) : dflt;
  }
  function px(v) { return Math.max(1, Math.round(v)); }

  // ------------------------------------------------------------------ options
  function norm(v) {
    var o = copy(DEF);
    if (!v || typeof v !== "object") return o;
    if (has(LAYOUT_IDS, v.layout)) o.layout = v.layout;
    o.n = int(v.n, 1, 4, DEF.n);
    if (has(SUSUN, v.susun)) o.susun = v.susun;
    if (RASIO[v.rasio]) o.rasio = v.rasio;
    o.tukar = v.tukar === true;
    if (Object.prototype.hasOwnProperty.call(FRAMES, v.frame)) o.frame = v.frame;
    o.tebal = int(v.tebal, 0, 80, DEF.tebal);
    o.jarak = int(v.jarak, 0, 48, DEF.jarak);
    o.sudut = int(v.sudut, 0, 40, DEF.sudut);
    o.warna = typeof v.warna === "string" && /^#[0-9a-f]{6}$/i.test(v.warna) ? v.warna.toLowerCase() : "";
    o.hiasan = v.hiasan !== false;
    o.garis = v.garis !== false;
    if (typeof v.teks === "string") {
      o.teks = v.teks.replace(/[ -]/g, "").replace(/\s+/g, " ").trim().slice(0, 48);
    }
    if (has(POSISI, v.posisi)) o.posisi = v.posisi;
    if (Object.prototype.hasOwnProperty.call(HURUF, v.huruf)) o.huruf = v.huruf;
    o.ukuran = int(v.ukuran, 60, 160, DEF.ukuran);
    o.tanggal = v.tanggal !== false;
    o.cap = v.cap !== false;
    if (typeof v.look === "string" && /^[a-z]{2,12}$/.test(v.look)) o.look = v.look;
    o.hitung = [3, 5, 10].indexOf(Number(v.hitung)) >= 0 ? Number(v.hitung) : DEF.hitung;
    if (typeof v.latar === "string" && /^[a-z][a-z0-9-]{1,19}$/.test(v.latar)) o.latar = v.latar;
    if (v.potong === "otomatis" || v.potong === "hijau") o.potong = v.potong;
    o.peka = int(v.peka, 5, 95, DEF.peka);
    o.tepi = int(v.tepi, 0, 10, DEF.tepi);
    o.besarH = int(v.besarH, 50, 160, DEF.besarH);
    o.besarG = int(v.besarG, 50, 160, DEF.besarG);
    o.jarakOrang = int(v.jarakOrang, 0, 100, DEF.jarakOrang);
    if (v.depan === "H" || v.depan === "G") o.depan = v.depan;
    if (typeof v.wallKey === "string" && /^[a-z0-9]{1,24}$/.test(v.wallKey)) o.wallKey = v.wallKey;
    o.at = isFinite(Number(v.at)) && Number(v.at) > 0 ? Number(v.at) : 0;
    return o;
  }

  /* What a booth starts with when this device has never chosen anything. The
     booth is Side A's, and Side A's own strip is unchanged; a pressing that
     brings its own paper gets it (YS-006, the field). */
  function defaults(press) {
    var o = copy(DEF);
    if (press === "006") {
      o.frame = "ladang";
      o.tebal = FRAMES.ladang.pakai.tebal; o.jarak = FRAMES.ladang.pakai.jarak;
      o.sudut = FRAMES.ladang.pakai.sudut; o.huruf = FRAMES.ladang.pakai.huruf;
      o.teks = "Kamu ✿ Aku";
    }
    return o;
  }

  function pakai(v, id) {
    var o = norm(v);
    if (!Object.prototype.hasOwnProperty.call(FRAMES, id)) return o;
    var from = FRAMES[o.frame].pakai, to = FRAMES[id].pakai;
    o.frame = id;
    if (to) ["tebal", "jarak", "sudut", "huruf"].forEach(function (key) {
      if (!from || o[key] === from[key]) o[key] = to[key];
    });
    return o;
  }

  function presets(press) {
    var P = PRESS[press] || { name: "Photobox", bulan: "", tgl: "" };
    return [
      "Kamu ♥ Aku",
      "Kamu ✿ Aku",
      P.name + " · YS-" + (press || "004"),
      "Dua kota, satu frame",
      "Bandung · Tokyo",
      P.bulan ? P.bulan + ", masih kita" : "",
      "Kita usahakan rumah itu",
      P.tgl
    ].filter(Boolean);
  }
  function pressName(press) { return (PRESS[press] && PRESS[press].name) || ""; }

  // ------------------------------------------------------------------ layout
  function estWidth(text, size, huruf) {
    var H = HURUF[huruf] || { est: 0.6 };
    return String(text || "").length * size * H.est;
  }

  /* The bands above and below the pictures. The classic strip's numbers are
     where these come from: a 26px title in a 66px head, a footer of 64. */
  function bands(o, W) {
    // type grows only on prints wider than the classic side-by-side strip
    var S = Math.max(1, Math.min(1.7, W / 1120));
    var H = HURUF[o.huruf];
    var capOn = !!o.teks && o.posisi !== "tanpa";
    var capPx = (o.posisi === "atas" ? 26 : 20) * (o.ukuran / 100) * S * H.k;
    var meta = 14 * S;
    var out = { top: 0, bot: 0, two: false, S: S, capPx: capPx, meta: meta, cap: capOn };
    if (o.frame === "none" || o.layout === "polaroid") return out;
    if (capOn && o.posisi === "atas") out.top = Math.round(capPx * 2.54);
    var capBot = capOn && o.posisi === "bawah";
    if (capBot || o.tanggal || o.cap) {
      out.bot = Math.round(Math.max(capBot ? capPx * 3.2 : 0, meta * 4.58));
      if (capBot && (o.tanggal || o.cap)) {
        var side = Math.max(o.tanggal ? DATE_SAMPLE.length * meta * 0.6 : 0, o.cap ? 6 * 12 * S * 0.6 : 0);
        /* the caption shrinks to fit beside the date, as the classic footer's
           did; only when that would take it below 70% does it get its own line */
        if (estWidth(o.teks, capPx, o.huruf) * 0.7 + 2 * (side + 28 * S) > W) {
          out.two = true;
          out.bot = Math.round(capPx * 2.5 + meta * 2.8);
        }
      }
    }
    return out;
  }

  /* Grid layouts: columns x rows of equal cells, and which picture is in each.
     `cw` is the cell width the classic strips printed at. */
  function gridOf(o) {
    var n = o.n;
    function pairs(rows, cw) { return { cols: 2, rows: rows, cw: cw, at: function (c, r) { return [r, c ? "b" : "a"]; } }; }
    function columns(cols, cw) { return { cols: cols, rows: 2, cw: cw, at: function (c, r) { return [c, r ? "b" : "a"]; } }; }
    function oneCol(shots, cw) { return { cols: 1, rows: 2 * shots, cw: cw, at: function (c, r) { return [r >> 1, r % 2 ? "b" : "a"]; } }; }
    function oneRow(shots, cw) { return { cols: 2 * shots, rows: 1, cw: cw, at: function (c) { return [c >> 1, c % 2 ? "b" : "a"]; } }; }
    switch (o.layout) {
      case "side": return pairs(1, 533);
      case "grid": return pairs(2, 424);
      case "strip": return pairs(3, 285);
      case "strip4": return pairs(4, 286);
      case "stack": return columns(1, 584);
      case "klasik": return oneCol(2, 400);
      case "mendatar": return columns(3, 360);
      case "kustom":
        if (o.susun === "tumpuk") return columns(n, [584, 420, 360, 300][n - 1]);
        if (o.susun === "kolom") return oneCol(n, [584, 440, 360, 320][n - 1]);
        if (o.susun === "baris") return oneRow(n, [533, 420, 320, 280][n - 1]);
        return pairs(n, n === 1 ? 533 : 285);
    }
    return pairs(1, 533);
  }

  function build(o, k) {
    var none = o.frame === "none";
    var B = none ? 0 : o.tebal, G = none ? 0 : o.jarak, r = RASIO[o.rasio];
    var sw = function (w) { return o.tukar ? (w === "a" ? "b" : "a") : w; };
    var cells = [], kind = "grid", seam = 0, W, H, y0, bd;

    if (o.layout === "belah" || o.layout === "jendela" || o.layout === "bareng") {
      var cw = px(900 * k), ch = px(cw * r);
      W = 2 * B + cw; bd = bands(o, W); y0 = bd.top ? Math.max(bd.top, B) : B;
      if (o.layout === "bareng") {
        /* TOGETHER IN ONE PLACE: one frame, one wallpaper, and both of you cut
           out of your own rooms and standing in it. Two cells on the same
           rectangle; the first draws the whole scene. `pos` is the side. */
        kind = "bareng";
        cells.push({ x: B, y: y0, w: cw, h: ch, shot: 0, who: "a", scene: "lead", pos: o.tukar ? 1 : -1 });
        cells.push({ x: B, y: y0, w: cw, h: ch, shot: 0, who: "b", scene: "follow", pos: o.tukar ? -1 : 1 });
      } else if (o.layout === "belah") {
        kind = "belah";
        seam = none ? 0 : Math.max(3, Math.round(G * 0.6));
        cells.push({ x: B, y: y0, w: cw, h: ch, shot: 0, who: sw("a"), part: "kiri" });
        cells.push({ x: B, y: y0, w: cw, h: ch, shot: 0, who: sw("b"), part: "kanan" });
      } else {
        kind = "jendela";
        var iw = px(cw * 0.34), ih = px(iw * r), m = px(cw * 0.045);
        cells.push({ x: B, y: y0, w: cw, h: ch, shot: 0, who: sw("b") });
        cells.push({ x: B + cw - iw - m, y: y0 + ch - ih - m, w: iw, h: ih, shot: 0, who: sw("a"),
          inset: Math.max(5, Math.min(18, Math.round((none ? 14 : o.tebal) * 0.45))) });
      }
      H = y0 + ch + B + bd.bot;
    } else if (o.layout === "polaroid") {
      kind = "polaroid";
      var pw = px(440 * k), ph = px(pw * r), cp = px(pw * 0.06), cb = px(pw * 0.24);
      var cwid = pw + 2 * cp, chei = ph + cp + cb, spread = px(pw * 0.09), drop = px(pw * 0.035);
      var edge = Math.max(B, spread), gap = Math.max(G, px(pw * 0.04));
      W = 2 * edge + 2 * cwid + gap; bd = bands(o, W); y0 = edge;
      [{ x: edge, y: y0, rot: -3.2 }, { x: edge + cwid + gap, y: y0 + drop, rot: 2.6 }].forEach(function (cd, i) {
        cells.push({ x: cd.x + cp, y: cd.y + cp, w: pw, h: ph, shot: 0, who: sw(i ? "b" : "a"),
          rot: cd.rot, card: { x: cd.x, y: cd.y, w: cwid, h: chei }, lip: i ? "meta" : "cap" });
      });
      H = y0 + chei + drop + edge;
    } else {
      var gr = gridOf(o), cw2 = px(gr.cw * k), ch2 = px(cw2 * r);
      W = 2 * B + gr.cols * cw2 + (gr.cols - 1) * G;
      bd = bands(o, W); y0 = bd.top ? Math.max(bd.top, B) : B;
      for (var row = 0; row < gr.rows; row++) {
        for (var col = 0; col < gr.cols; col++) {
          var at = gr.at(col, row);
          cells.push({ x: B + col * (cw2 + G), y: y0 + row * (ch2 + G), w: cw2, h: ch2, shot: at[0], who: sw(at[1]) });
        }
      }
      H = y0 + gr.rows * ch2 + (gr.rows - 1) * G + B + bd.bot;
    }
    var shots = 0;
    cells.forEach(function (c) { shots = Math.max(shots, c.shot + 1); });
    return {
      W: W, H: H, cells: cells, kind: kind, edge: B, gap: G, seam: seam, bands: bd, shots: shots,
      top: bd.top ? { y: 0, h: Math.max(bd.top, B) } : null,
      bot: bd.bot ? { y: H - bd.bot, h: bd.bot } : null
    };
  }

  function plan(v) {
    var o = norm(v), k = 1, p = build(o, 1);
    for (var i = 0; i < 16 && (p.W > MAXW || p.H > MAXH); i++) {
      k *= Math.min(0.97, MAXW / p.W, MAXH / p.H);
      p = build(o, k);
    }
    return p;
  }

  // ------------------------------------------------------------------ colour
  function rgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(h)) return [128, 128, 128];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function lum(hex) {
    var c = rgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return "#" + [0, 1, 2].map(function (i) {
      var v = Math.round(x[i] + (y[i] - x[i]) * t);
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function palette(o) {
    var F = FRAMES[o.frame];
    if (o.frame === "none") {
      return { paper: "", ink: F.ink, soft: F.soft, accent: F.accent, moss: F.ink, line: "", rule: "",
        hole: "#35312C", holeInk: "#554E46", dark: true, mono: F.mono };
    }
    var paper = o.warna || F.paper, dark = lum(paper) < 0.3, own = !!o.warna;
    var ink = own ? (dark ? "#F4F0E6" : "#1B1A15") : F.ink;
    var soft = own ? (dark ? "rgba(244,240,230,0.66)" : "rgba(27,26,21,0.58)") : F.soft;
    var accent = F.accent;
    if (own && Math.abs(lum(accent) - lum(paper)) < 0.1) accent = ink;
    var moss = F.moss || ink;
    if (own && Math.abs(lum(moss) - lum(paper)) < 0.1) moss = ink;
    return {
      paper: paper, ink: ink, soft: soft, accent: accent, moss: moss,
      line: F.line ? (own ? (dark ? "rgba(244,240,230,0.5)" : "rgba(27,26,21,0.78)") : F.line) : "",
      rule: own ? (dark ? "rgba(244,240,230,0.22)" : "rgba(27,26,21,0.22)") : F.rule,
      hole: mix(paper, dark ? "#FFFFFF" : "#000000", 0.1),
      holeInk: mix(paper, dark ? "#FFFFFF" : "#000000", 0.24),
      dark: dark, mono: F.mono
    };
  }

  // ------------------------------------------------------------------ drawing helpers
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedOf(p, o) {
    var s = p.W * 73856093 ^ p.H * 19349663;
    for (var i = 0; i < o.layout.length; i++) s = (s * 31 + o.layout.charCodeAt(i)) | 0;
    return s;
  }

  function rrect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    g.beginPath();
    if (!r) { g.rect(x, y, w, h); return; }
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
    g.closePath();
  }

  function petal(g, x, y, len, wid, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    function P(u, v) { return [x + u * c - v * s, y + u * s + v * c]; }
    var b1 = P(len * 0.3, -wid), b2 = P(len * 0.95, -wid * 0.75), tip = P(len, 0), b3 = P(len * 0.95, wid * 0.75), b4 = P(len * 0.3, wid);
    g.beginPath(); g.moveTo(x, y);
    g.bezierCurveTo(b1[0], b1[1], b2[0], b2[1], tip[0], tip[1]);
    g.bezierCurveTo(b3[0], b3[1], b4[0], b4[1], x, y);
    g.fill();
  }
  function blossom(g, x, y, r, col, eye, rot) {
    g.fillStyle = col;
    for (var i = 0; i < 5; i++) petal(g, x, y, r, r * 0.46, rot + i * Math.PI * 0.4);
    g.fillStyle = eye;
    g.beginPath(); g.arc(x, y, r * 0.2, 0, Math.PI * 2); g.fill();
  }
  function sprig(g, x, y, len, ang, pal, R) {
    var c = Math.cos(ang), s = Math.sin(ang), bend = (R() - 0.5) * len * 0.45;
    var ex = x + c * len, ey = y + s * len;
    var mx = x + c * len / 2 - s * bend, my = y + s * len / 2 + c * bend;
    g.strokeStyle = pal.moss; g.lineWidth = Math.max(1, len * 0.028); g.lineCap = "round";
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
    var n = 4 + Math.floor(R() * 3);
    g.fillStyle = pal.moss;
    for (var i = 1; i <= n; i++) {
      var t = i / (n + 1), u = 1 - t;
      var qx = u * u * x + 2 * u * t * mx + t * t * ex, qy = u * u * y + 2 * u * t * my + t * t * ey;
      petal(g, qx, qy, len * (0.24 - t * 0.1), len * 0.06, ang + (i % 2 ? 1 : -1) * (0.7 + R() * 0.35));
    }
    blossom(g, ex, ey, len * 0.12, pal.accent, pal.paper, R() * 6.28);
  }
  function flake(g, x, y, r, col) {
    g.strokeStyle = col; g.lineWidth = Math.max(1, r * 0.13); g.lineCap = "round";
    g.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = i * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
      g.moveTo(x, y); g.lineTo(x + c * r, y + s * r);
      var bx = x + c * r * 0.56, by = y + s * r * 0.56;
      for (var k = -1; k <= 1; k += 2) {
        g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + k * 0.8) * r * 0.3, by + Math.sin(a + k * 0.8) * r * 0.3);
      }
    }
    g.stroke();
  }
  function sparkle(g, x, y, r, col) {
    g.fillStyle = col;
    g.beginPath(); g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r);
    g.fill();
  }

  // the outline of every picture, and the corners of a tilted card
  function corners(c) {
    var cd = c.card, cx = cd.x + cd.w / 2, cy = cd.y + cd.h / 2, a = c.rot * Math.PI / 180;
    var co = Math.cos(a), si = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (q) {
      var u = q[0] * cd.w / 2, v = q[1] * cd.h / 2;
      return [cx + u * co - v * si, cy + u * si + v * co];
    });
  }
  function bbox(p) {
    var x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
    p.cells.forEach(function (c) {
      var pts = c.card ? corners(c) : [[c.x, c.y], [c.x + c.w, c.y + c.h]];
      pts.forEach(function (q) { x = Math.min(x, q[0]); y = Math.min(y, q[1]); x2 = Math.max(x2, q[0]); y2 = Math.max(y2, q[1]); });
    });
    return { x: Math.max(0, x), y: Math.max(0, y), x2: Math.min(p.W, x2), y2: Math.min(p.H, y2) };
  }
  /* Decoration lives in the margins and is clipped out of the pictures, so a
     sprig can run behind a print the way a pressed flower slips under one. */
  function clipMargins(g, p) {
    g.beginPath(); g.rect(0, 0, p.W, p.H);
    p.cells.forEach(function (c) {
      if (c.inset || c.part === "kanan" || c.scene === "follow") return;
      if (c.card) {
        var q = corners(c);
        g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.lineTo(q[3][0], q[3][1]); g.closePath();
      } else g.rect(c.x, c.y, c.w, c.h);
    });
    g.clip("evenodd");
  }
  /* Motifs along the four margins. Where a band carries type, its middle is
     left clear so a flower never sits under a letter. */
  function scatter(p, R, fn, spacing) {
    var b = bbox(p), items = 0;
    var sides = [
      { x: 0, y: 0, w: p.W, h: b.y, along: "x", text: !!p.top },
      // the footer carries the date, the caption and the pressing from edge to edge
      { x: 0, y: b.y2, w: p.W, h: p.H - b.y2, along: "x", skip: !!p.bot },
      { x: 0, y: b.y, w: b.x, h: b.y2 - b.y, along: "y" },
      { x: b.x2, y: b.y, w: p.W - b.x2, h: b.y2 - b.y, along: "y" }
    ];
    sides.forEach(function (sd) {
      var th = sd.along === "x" ? sd.h : sd.w, len = sd.along === "x" ? sd.w : sd.h;
      if (sd.skip || th < 12 || len < 24) return;
      var size = Math.min(th * 0.34, 26), step = size * (spacing || 4.2), t = step * (0.4 + R() * 0.5);
      while (t < len - size) {
        var across = th * (0.35 + R() * 0.3);
        var x = sd.along === "x" ? sd.x + t : sd.x + across, y = sd.along === "x" ? sd.y + across : sd.y + t;
        var clearText = sd.text && t > len * 0.18 && t < len * 0.82;
        if (!clearText) fn(x, y, size * (0.75 + R() * 0.5), items++);
        t += step * (0.7 + R() * 0.7);
      }
    });
  }

  var DECOR = {
    /* Pressed flowers, sparingly: a sprig tucked in under each top corner and
       a few blossoms and leaves down the margins. Two inks, moss and rust, and
       nothing in the footer, which is the date's. */
    ladang: function (g, p, pal, R) {
      var b = bbox(p), u = Math.max(10, Math.min(40, (b.x + p.W - b.x2) / 2 + 4));
      sprig(g, Math.max(4, b.x * 0.35), Math.max(4, b.y * 0.35), u * 3.2, Math.PI / 4 + (R() - 0.5) * 0.3, pal, R);
      sprig(g, p.W - Math.max(4, (p.W - b.x2) * 0.35), Math.max(4, b.y * 0.35), u * 2.8, Math.PI * 3 / 4 + (R() - 0.5) * 0.3, pal, R);
      scatter(p, R, function (x, y, s, i) {
        if (i % 3 === 1) {
          g.fillStyle = pal.moss;
          petal(g, x, y, s * 1.4, s * 0.34, R() * 6.28);
          petal(g, x, y, s * 1.1, s * 0.3, R() * 6.28);
        } else blossom(g, x, y, s * 0.85, i % 3 ? pal.accent : pal.moss, pal.paper, R() * 6.28);
      }, 7.5);
    },
    kafe: function (g, p, pal, R) {
      if (p.edge >= 14) {
        var ins = p.edge * 0.42;
        g.strokeStyle = pal.rule; g.lineWidth = 1;
        rrect(g, ins, ins, p.W - 2 * ins, p.H - 2 * ins, 4); g.stroke();
      }
      scatter(p, R, function (x, y, s, i) {
        if (i % 2) sparkle(g, x, y, s * 0.6, pal.accent);
        else { g.fillStyle = pal.soft; g.beginPath(); g.arc(x, y, Math.max(1, s * 0.12), 0, Math.PI * 2); g.fill(); }
      });
    },
    salju: function (g, p, pal, R) {
      scatter(p, R, function (x, y, s, i) { flake(g, x, y, s * 0.62, i % 2 ? pal.accent : "#FFFFFF"); });
    },
    film: function (g, p, pal) {
      var b = bbox(p), tall = p.H >= p.W * 0.9;
      g.fillStyle = "rgba(236,229,214,0.9)";
      if (tall) {
        var th = Math.min(b.x, p.W - b.x2);
        if (th < 14) return;
        var w = Math.min(th * 0.42, 24), h = w * 0.7, step = h * 2.3;
        for (var y = step * 0.5; y < p.H - h; y += step) {
          rrect(g, (th - w) / 2, y, w, h, h * 0.25); g.fill();
          rrect(g, p.W - (th + w) / 2, y, w, h, h * 0.25); g.fill();
        }
      } else {
        var tv = Math.min(b.y, p.H - b.y2, 34);
        if (tv < 14) return;
        var hh = Math.min(tv * 0.42, 22), ww = hh * 1.4, st = ww * 2.3;
        for (var x = st * 0.5; x < p.W - ww; x += st) {
          rrect(g, x, (tv - hh) / 2, ww, hh, hh * 0.25); g.fill();
          rrect(g, x, p.H - (tv + hh) / 2, ww, hh, hh * 0.25); g.fill();
        }
      }
    }
  };

  // ------------------------------------------------------------------ type
  var GLYPH = /([♥✿])/;
  function setFont(g, H, size) {
    g.font = H.style + " " + H.weight + " " + size.toFixed(1) + "px " + H.family;
    if ("letterSpacing" in g) g.letterSpacing = H.track ? (size * H.track).toFixed(2) + "px" : "0px";
  }
  function segWidth(g, s, size) { return s === "✿" ? size * 0.95 : g.measureText(s).width; }
  /* One line of caption, centred, shrunk to fit. A ✿ is drawn, not set: the
     field's blossom in the frame's accent, the same on every phone whether or
     not its fonts have the character. A ♥ takes the accent too. */
  function caption(g, text, H, size, cx, cy, maxW, col, accent, eye) {
    var parts = String(H.upper ? text.toUpperCase() : text).split(GLYPH).filter(function (s) { return s !== ""; });
    if (!parts.length) return size;
    setFont(g, H, size);
    var w = parts.reduce(function (sum, s) { return sum + segWidth(g, s, size); }, 0);
    if (w > maxW && w > 0) {
      size = Math.max(9, size * maxW / w);
      setFont(g, H, size);
      w = parts.reduce(function (sum, s) { return sum + segWidth(g, s, size); }, 0);
    }
    var x = cx - w / 2;
    g.textAlign = "left"; g.textBaseline = "middle";
    parts.forEach(function (s) {
      var sw = segWidth(g, s, size);
      if (s === "✿") blossom(g, x + sw / 2, cy, size * 0.42, accent, eye, 0.3);
      else { g.fillStyle = s === "♥" ? accent : col; g.fillText(s, x, cy + H.nudge * size); }
      x += sw;
    });
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    return size;
  }
  function metaFont(g, size, family) {
    g.font = "400 " + size.toFixed(1) + "px " + family;
    if ("letterSpacing" in g) g.letterSpacing = "0px";
  }
  function bar(g, x, y, w, h, col) { g.fillStyle = col; rrect(g, x, y, w, h, h / 2); g.fill(); }

  function framedText(g, p, o, pal, env) {
    var bd = p.bands, H = HURUF[o.huruf], S = bd.S, W = p.W;
    var cap = bd.cap ? o.teks : "", date = o.tanggal ? String(env.date || "") : "", stamp = o.cap ? String(env.press || "") : "";
    var pad = Math.max(18 * S, p.edge);
    if (env.thumb) {
      var hb = Math.max(4, bd.capPx * 0.5);
      if (p.top && cap) bar(g, W * 0.3, p.top.h / 2 - hb / 2, W * 0.4, hb, pal.ink);
      if (p.bot) {
        var mid = p.bot.y + p.bot.h / 2;
        if (cap && o.posisi === "bawah") bar(g, W * 0.36, (bd.two ? p.bot.y + p.bot.h * 0.36 : mid) - hb / 2, W * 0.28, hb, pal.ink);
        var mh = Math.max(3, bd.meta * 0.4), my = bd.two ? p.bot.y + p.bot.h * 0.74 : mid;
        if (date) bar(g, pad, my - mh / 2, W * 0.18, mh, pal.soft);
        if (stamp) bar(g, W - pad - W * 0.08, my - mh / 2, W * 0.08, mh, pal.soft);
      }
      return;
    }
    if (p.top && cap) {
      caption(g, cap, H, bd.capPx, W / 2, p.top.h / 2 + 2 * S, W - 2 * pad, pal.ink, pal.accent, pal.paper);
    }
    if (!p.bot) return;
    var y0 = p.bot.y, h = p.bot.h;
    if (pal.rule) {
      g.strokeStyle = pal.rule; g.lineWidth = 1;
      g.beginPath(); g.moveTo(16 * S, y0); g.lineTo(W - 16 * S, y0); g.stroke();
    }
    var metaY = bd.two ? y0 + h - bd.meta * 1.45 : y0 + h / 2;
    g.textBaseline = "middle";
    var dw = 0, sw = 0;
    if (date) {
      metaFont(g, bd.meta, pal.mono); g.fillStyle = pal.ink; g.textAlign = "left";
      g.fillText(date, pad, metaY); dw = g.measureText(date).width;
    }
    if (stamp) {
      metaFont(g, 12 * S, pal.mono); g.fillStyle = pal.soft; g.textAlign = "right";
      g.fillText(stamp, W - pad, metaY); sw = g.measureText(stamp).width;
    }
    if (cap && o.posisi === "bawah") {
      if (bd.two) caption(g, cap, H, bd.capPx, W / 2, y0 + bd.capPx * 1.3, W - 2 * pad, pal.ink, pal.accent, pal.paper);
      else caption(g, cap, H, bd.capPx, W / 2, metaY, Math.max(40, W - 2 * (pad + Math.max(dw, sw) + 16 * S)), pal.ink, pal.accent, pal.paper);
    }
  }

  /* No frame: the type goes on the photograph, so it is set in paper over a
     soft shade -- ink on a picture is unreadable. */
  function overlayText(g, p, o, env) {
    var bd = p.bands, H = HURUF[o.huruf], S = bd.S, W = p.W;
    var cap = bd.cap ? o.teks : "", date = o.tanggal ? String(env.date || "") : "", stamp = o.cap ? String(env.press || "") : "";
    if (!cap && !date && !stamp) return;
    var size = bd.capPx * 1.2, meta = bd.meta, pad = 20 * S, paperCol = "#FFFDF8", accent = FRAMES.none.accent;
    var capTop = cap && o.posisi === "atas";
    var botH = (cap && !capTop ? size * 2.2 : 0) + (date || stamp ? meta * 2.6 : 0) + 16 * S;
    function shade(y, h, down) {
      var gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(down ? 0 : 1, "rgba(0,0,0,0)");
      gr.addColorStop(down ? 1 : 0, "rgba(0,0,0,0.44)");
      g.fillStyle = gr; g.fillRect(0, y, W, h);
    }
    if (env.thumb) {
      shade(p.H - botH, botH, true);
      if (capTop) shade(0, size * 2.6, false);
      var hb = Math.max(4, size * 0.45);
      if (cap) bar(g, W * 0.32, (capTop ? size * 1.2 : p.H - botH * 0.55) - hb / 2, W * 0.36, hb, paperCol);
      return;
    }
    shade(p.H - botH, botH, true);
    if (capTop) shade(0, size * 2.6, false);
    g.save();
    g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 10 * S;
    var metaY = p.H - meta * 1.5;
    if (cap) {
      var cy = capTop ? size * 1.25 : (date || stamp ? metaY - meta * 0.9 - size * 0.8 : p.H - size * 1.1);
      caption(g, cap, H, size, W / 2, cy, W - 2 * pad, paperCol, accent, paperCol);
    }
    g.textBaseline = "middle";
    if (date) { metaFont(g, meta, FRAMES.none.mono); g.fillStyle = paperCol; g.textAlign = "left"; g.fillText(date, pad, metaY); }
    if (stamp) { metaFont(g, 12 * S, FRAMES.none.mono); g.fillStyle = FRAMES.none.soft; g.textAlign = "right"; g.fillText(stamp, W - pad, metaY); }
    g.restore();
  }

  // ------------------------------------------------------------------ pictures
  function cover(g, s, x, y, w, h, filter) {
    var sw = s.w, sh = s.h;
    if (!sw || !sh) return false;
    var k = Math.max(w / sw, h / sh), dw = sw * k, dh = sh * k;
    try { g.filter = filter && filter !== "none" ? filter : "none"; } catch (e) {}
    if (s.flip) { g.save(); g.translate(2 * x + w, 0); g.scale(-1, 1); }
    try { g.drawImage(s.img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e) {}
    if (s.flip) g.restore();
    try { g.filter = "none"; } catch (e) {}
    return true;
  }
  function placeholder(g, c, pal, env, x, y, w, h, shots) {
    g.fillStyle = pal.hole; g.fillRect(x, y, w, h);
    var cx = x + w / 2, r = Math.min(w, h) * 0.16, cy = y + h * 0.54;
    g.fillStyle = pal.holeInk;
    g.beginPath(); g.arc(cx, cy - r * 0.95, r * 0.62, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy + r * 1.3, r * 1.2, Math.PI, 0); g.closePath(); g.fill();
    if (!env.thumb && h > 70) {
      var size = Math.max(10, Math.min(22, h * 0.07));
      metaFont(g, size, pal.mono);
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText((c.who === "a" ? "KAMU" : "DIA") + (shots > 1 ? " · " + (c.shot + 1) : ""), cx, y + h - size * 1.3);
    }
  }
  function lipText(g, c, o, pal, env) {
    var cd = c.card, H = HURUF[o.huruf], cx = cd.x + cd.w / 2, lipY = c.y + c.h, lipH = cd.y + cd.h - lipY;
    var ink = "#1B1A15", soft = "rgba(27,26,21,0.55)", accent = pal.accent === "#FFFDF8" ? "#B5502C" : pal.accent;
    if (lum(accent) > 0.7) accent = "#B5502C";
    var cap = o.posisi !== "tanpa" ? o.teks : "";
    if (env.thumb) {
      var hb = Math.max(4, lipH * 0.16);
      if (c.lip === "cap" && cap) bar(g, cx - cd.w * 0.25, lipY + lipH / 2 - hb / 2, cd.w * 0.5, hb, ink);
      if (c.lip === "meta" && (o.tanggal || o.cap)) bar(g, cx - cd.w * 0.18, lipY + lipH / 2 - hb / 3, cd.w * 0.36, hb * 0.66, soft);
      return;
    }
    if (c.lip === "cap" && cap) {
      caption(g, cap, H, lipH * 0.36 * (o.ukuran / 100) * H.k, cx, lipY + lipH * 0.5, cd.w * 0.86, ink, accent, "#FBFAF6");
    }
    if (c.lip === "meta") {
      var meta = Math.max(10, lipH * 0.15);
      g.textAlign = "center"; g.textBaseline = "middle";
      var date = o.tanggal ? String(env.date || "") : "", stamp = o.cap ? String(env.press || "") : "";
      if (date) { metaFont(g, meta, pal.mono); g.fillStyle = ink; g.fillText(date, cx, lipY + lipH * (stamp ? 0.4 : 0.5)); }
      if (stamp) { metaFont(g, meta * 0.85, pal.mono); g.fillStyle = soft; g.fillText(stamp, cx, lipY + lipH * (date ? 0.68 : 0.5)); }
    }
  }
  /* A layer the size of a rectangle of the plan, in real pixels (env.scale),
     with plan coordinates still working inside it. The booth supplies layers
     (env.layer), so this file never makes a canvas of its own. */
  function layerFor(env, x, y, w, h) {
    var sc = env.scale || 1, lw = Math.max(1, Math.ceil(w * sc)), lh = Math.max(1, Math.ceil(h * sc));
    var L = env.layer(lw, lh), lg = L.getContext("2d");
    lg.setTransform(sc, 0, 0, sc, -x * sc, -y * sc);
    return { c: L, g: lg, sc: sc };
  }
  function frameAt(g, img, box, flip) {
    if (flip) { g.save(); g.translate(2 * box.x + box.w, 0); g.scale(-1, 1); }
    try { g.drawImage(img, box.x, box.y, box.w, box.h); } catch (e) {}
    if (flip) g.restore();
  }
  function coverBox(src, x, y, w, h) {
    var k = Math.max(w / src.w, h / src.h);
    return { x: x + (w - src.w * k) / 2, y: y + (h - src.h * k) / 2, w: src.w * k, h: src.h * k };
  }
  /* One of you, cut out: the camera frame, then its mask with destination-in,
     in a layer of its own so the cut never bites into the wallpaper. The mask
     covers the whole frame, so it is drawn to the same box and the same
     mirror. `tepi` softens the edge. */
  function cutPerson(env, box, src, o, x, y, w, h) {
    var P = layerFor(env, x, y, w, h), pg = P.g;
    frameAt(pg, src.img, box, src.flip);
    pg.globalCompositeOperation = "destination-in";
    if (o.tepi) { try { pg.filter = "blur(" + (o.tepi * 0.5 * P.sc).toFixed(2) + "px)"; } catch (e) {} }
    frameAt(pg, src.mask, box, src.flip);
    try { pg.filter = "none"; } catch (e) {}
    pg.globalCompositeOperation = "source-over";
    return P.c;
  }
  // a layer is laid on the page through the look, so the room and the two of you grade together
  function lay(g, L, x, y, w, h, env) {
    try { g.filter = env.filter && env.filter !== "none" ? env.filter : "none"; } catch (e) {}
    g.drawImage(L, x, y, w, h);
    try { g.filter = "none"; } catch (e) {}
  }
  function paste(dst, L) {
    dst.save(); dst.setTransform(1, 0, 0, 1, 0, 0); dst.drawImage(L, 0, 0); dst.restore();
  }
  // a picture with a wallpaper behind it (every layout but "Satu tempat")
  function cutout(g, src, x, y, w, h, o, env) {
    if (o.latar === "asli" || !src.mask || !env.layer || !env.wall) return false;
    var S = layerFor(env, x, y, w, h);
    env.wall(S.g, x, y, w, h);
    paste(S.g, cutPerson(env, coverBox(src, x, y, w, h), src, o, x, y, w, h));
    lay(g, S.c, x, y, w, h, env);
    return true;
  }
  function silhouette(g, box, env, who) {
    var cx = box.x + box.w / 2, r = box.h * 0.15;
    g.fillStyle = "rgba(251,247,240,0.8)";
    g.beginPath(); g.arc(cx, box.y + box.h * 0.38, r, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, box.y + box.h + r * 0.3, box.h * 0.36, Math.PI, 0); g.closePath(); g.fill();
    if (!env.thumb && box.h > 90) {
      metaFont(g, Math.max(10, Math.min(20, box.h * 0.06)), "'IBM Plex Mono', monospace");
      g.fillStyle = "#1B1A15"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(who === "a" ? "KAMU" : "DIA", cx, box.y + box.h * 0.8);
    }
  }
  // no camera yet, but a wallpaper chosen: show the room, with a place for you in it
  function wallPlaceholder(g, c, o, env, x, y, w, h) {
    if (o.latar === "asli" || !env.layer || !env.wall) return false;
    var S = layerFor(env, x, y, w, h);
    env.wall(S.g, x, y, w, h);
    var bh = h * 0.86, bw = bh * 4 / 3;
    silhouette(S.g, { x: x + (w - bw) / 2, y: y + h - bh, w: bw, h: bh }, env, c.who);
    lay(g, S.c, x, y, w, h, env);
    return true;
  }
  /* "Satu tempat". The wallpaper, then each of you cut out and standing on
     the bottom edge: sized by your own slider (besarH is the host's, besarG
     the guest's -- `a` is always this screen's own camera, so sizes follow
     the person, not the side), spaced by jarakOrang, the one in front drawn
     last. A camera not yet cut stands whole in its half, so nobody vanishes
     while the cutter warms up. */
  function drawScene(g, p, c, o, pal, env) {
    var cells = p.cells.filter(function (k) { return k.scene; });
    var srcs = cells.map(function (k) { return env.src ? env.src(k) : null; });
    if (!env.layer || !env.wall) {
      cells.forEach(function (k, i) {
        var hx = k.pos < 0 ? c.x : c.x + c.w / 2;
        if (!(srcs[i] && cover(g, srcs[i], hx, c.y, c.w / 2, c.h, env.filter))) placeholder(g, k, pal, env, hx, c.y, c.w / 2, c.h, 1);
      });
      return;
    }
    var guestIsA = env.role === "guest";
    var front = (o.depan === "G") === guestIsA ? "a" : "b";
    var S = layerFor(env, c.x, c.y, c.w, c.h);
    env.wall(S.g, c.x, c.y, c.w, c.h);
    var order = cells.map(function (k, i) { return i; }).sort(function (i, j) {
      return (cells[i].who === front ? 1 : 0) - (cells[j].who === front ? 1 : 0);
    });
    var d = c.w * (0.16 + 0.5 * o.jarakOrang / 100);
    order.forEach(function (i) {
      var k = cells[i], src = srcs[i];
      var guest = (k.who === "a") === guestIsA;
      var hh = c.h * 0.9 * (guest ? o.besarG : o.besarH) / 100;
      var ww = hh * (src ? src.w / src.h : 4 / 3);
      var cx = c.x + c.w / 2 + k.pos * d / 2;
      var box = { x: cx - ww / 2, y: c.y + c.h - hh, w: ww, h: hh };
      if (src && src.mask) paste(S.g, cutPerson(env, box, src, o, c.x, c.y, c.w, c.h));
      else if (src) {
        var hx = k.pos < 0 ? c.x : c.x + c.w / 2;
        S.g.save(); S.g.beginPath(); S.g.rect(hx, c.y, c.w / 2, c.h); S.g.clip();
        frameAt(S.g, src.img, coverBox(src, hx, c.y, c.w / 2, c.h), src.flip);
        S.g.restore();
      } else silhouette(S.g, box, env, k.who);
    });
    lay(g, S.c, c.x, c.y, c.w, c.h, env);
  }

  function drawCell(g, p, c, o, pal, env) {
    if (c.scene === "follow") return;
    var none = o.frame === "none";
    var R = none ? 0 : Math.min(o.sudut, c.w / 2, c.h / 2);
    var src = env.src ? env.src(c) : null;
    g.save();
    if (c.card) {
      var cd = c.card, cx = cd.x + cd.w / 2, cy = cd.y + cd.h / 2;
      g.translate(cx, cy); g.rotate(c.rot * Math.PI / 180); g.translate(-cx, -cy);
      g.save();
      g.shadowColor = "rgba(20,16,10,0.28)"; g.shadowBlur = cd.w * 0.05; g.shadowOffsetY = cd.w * 0.012;
      g.fillStyle = "#FBFAF6"; rrect(g, cd.x, cd.y, cd.w, cd.h, 3); g.fill();
      g.restore();
      lipText(g, c, o, pal, env);
      R = Math.min(R, 6);
    }
    if (c.inset) {
      g.save();
      g.shadowColor = "rgba(0,0,0,0.3)"; g.shadowBlur = c.inset * 1.6;
      g.fillStyle = pal.paper || "#FFFDF8";
      rrect(g, c.x - c.inset, c.y - c.inset, c.w + 2 * c.inset, c.h + 2 * c.inset, R ? R + c.inset : 0); g.fill();
      g.restore();
    }
    var bx = c.x, bw = c.w;
    if (c.part) {
      // one photograph cut on a slant: each half is covered into its own side
      var slant = c.w * 0.07, mid = c.x + c.w / 2;
      bw = c.w / 2 + slant;
      if (c.part === "kanan") bx = mid - slant;
      g.save(); rrect(g, c.x, c.y, c.w, c.h, R); g.clip();
      g.beginPath();
      if (c.part === "kiri") { g.moveTo(c.x, c.y); g.lineTo(mid + slant, c.y); g.lineTo(mid - slant, c.y + c.h); g.lineTo(c.x, c.y + c.h); }
      else { g.moveTo(mid + slant, c.y); g.lineTo(c.x + c.w, c.y); g.lineTo(c.x + c.w, c.y + c.h); g.lineTo(mid - slant, c.y + c.h); }
      g.closePath(); g.clip();
    } else {
      rrect(g, c.x, c.y, c.w, c.h, R); g.save(); g.clip();
    }
    if (c.scene) drawScene(g, p, c, o, pal, env);
    else if (src) {
      if (!cutout(g, src, bx, c.y, bw, c.h, o, env) && !cover(g, src, bx, c.y, bw, c.h, env.filter)) placeholder(g, c, pal, env, bx, c.y, bw, c.h, p.shots);
    } else if (!wallPlaceholder(g, c, o, env, bx, c.y, bw, c.h)) placeholder(g, c, pal, env, bx, c.y, bw, c.h, p.shots);
    g.restore();
    if (o.garis && pal.line && !c.part && !c.card) {
      g.strokeStyle = pal.line; g.lineWidth = Math.max(1.5, p.W / 560);
      var lw = g.lineWidth / 2;
      rrect(g, c.x + lw, c.y + lw, c.w - 2 * lw, c.h - 2 * lw, Math.max(0, R - lw)); g.stroke();
    }
    if (env.hot === c.shot && env.hot >= 0) {
      g.strokeStyle = pal.accent || "#FF4A7D"; g.lineWidth = Math.max(4, p.W * 0.006);
      rrect(g, c.x + g.lineWidth / 2, c.y + g.lineWidth / 2, c.w - g.lineWidth, c.h - g.lineWidth, R); g.stroke();
    }
    g.restore();
  }

  /* g is already scaled so that one unit of the plan is one unit here; the
     booth draws the preview smaller by scaling the context, never the plan.
     env: src(cell) -> {img,w,h,flip,mask} | null, filter, date, press, hot, thumb,
     and for wallpapers: wall(g,x,y,w,h), layer(w,h) -> canvas, scale, role. */
  function draw(g, p, v, env) {
    var o = norm(v), pal = palette(o), F = FRAMES[o.frame];
    env = env || {};
    g.save();
    if (pal.paper) { g.fillStyle = pal.paper; g.fillRect(0, 0, p.W, p.H); }
    else if (p.kind !== "polaroid") { g.fillStyle = "#0E0D0C"; g.fillRect(0, 0, p.W, p.H); }
    if (o.hiasan && F.decor && DECOR[F.decor]) {
      g.save(); clipMargins(g, p); DECOR[F.decor](g, p, pal, rng(seedOf(p, o))); g.restore();
    }
    p.cells.forEach(function (c) { drawCell(g, p, c, o, pal, env); });
    if (p.kind === "belah" && p.seam) {
      var c0 = p.cells[0], slant = c0.w * 0.07, mid = c0.x + c0.w / 2;
      g.strokeStyle = pal.paper; g.lineWidth = p.seam; g.lineCap = "butt";
      g.beginPath(); g.moveTo(mid + slant, c0.y); g.lineTo(mid - slant, c0.y + c0.h); g.stroke();
    }
    if (p.kind !== "polaroid") {
      if (o.frame === "none") overlayText(g, p, o, env);
      else framedText(g, p, o, pal, env);
    }
    g.restore();
  }

  var api = {
    LAYOUTS: LAYOUTS, SUSUN: SUSUN, POSISI: POSISI, RASIO: RASIO, RASIO_ORDER: RASIO_ORDER,
    HURUF: HURUF, HURUF_ORDER: HURUF_ORDER, FRAMES: FRAMES, FRAME_ORDER: FRAME_ORDER, WARNA: WARNA, DEF: DEF,
    norm: norm, defaults: defaults, pakai: pakai, presets: presets, pressName: pressName,
    plan: plan, draw: draw, palette: palette, estWidth: estWidth, lum: lum
  };
  root.Bingkai = api;
})(typeof window !== "undefined" ? window : globalThis);
