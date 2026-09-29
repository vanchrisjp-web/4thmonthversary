/* =============================================================================
   latar.js — the wallpapers you can stand in front of in the photobox, and
   the two small pieces of arithmetic that decide which pixels are you.

   Everything here is pure: no DOM, and randomness only from a seed taken from
   the wallpaper's name. So the live preview, the little cards and the printed
   strip draw the SAME scene at any size -- a flower in the corner of the card
   is in the corner of the print. latar.test.mjs runs every one of them.

   The cutting itself (which pixels are a person) happens in photobox.js, with
   MediaPipe's selfie segmenter or a green-screen key; this file only turns its
   numbers into a mask:
     alpha()   a person-confidence map (0..1) -> mask alpha, with a soft edge
     chroma()  camera pixels -> mask alpha, dropping whatever is green enough
   ========================================================================== */
(function (root) {
  "use strict";

  var LIST = [
    { id: "asli", name: "Asli", note: "kamera apa adanya" },
    { id: "malam26", name: "Malam 26", note: "ulang tahunmu" },
    { id: "ladang", name: "Ladang senja", note: "YS-006" },
    { id: "sakura", name: "Sakura", note: "musim semi" },
    { id: "kebun", name: "Kebun teh", note: "Bandung" },
    { id: "kota", name: "Kota malam", note: "Tokyo" },
    { id: "salju", name: "Salju", note: "malam bersalju" },
    { id: "kafe", name: "Kafe malam", note: "YS-005" },
    { id: "studio", name: "Studio", note: "kertas foto" },
    { id: "krem", name: "Krem polos", note: "" },
    { id: "jambu", name: "Merah jambu", note: "" },
    { id: "langit", name: "Biru langit", note: "" },
    { id: "foto", name: "Foto sendiri", note: "dari galeri" }
  ];
  var IDS = LIST.map(function (l) { return l.id; });
  var POLOS = { krem: "#EFE6D6", jambu: "#F2C6CF", langit: "#BFD8EC" };

  function seed(id) {
    var s = 2166136261;
    for (var i = 0; i < id.length; i++) { s ^= id.charCodeAt(i); s = Math.imul(s, 16777619); }
    return s >>> 0;
  }
  function rng(s) {
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); g.fill(); }
  function grad(g, x0, y0, x1, y1, stops) {
    var gr = g.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    return gr;
  }
  function glow(g, x, y, r, inner, outer) {
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // a ridge line across the scene, closed down to the bottom edge
  function ridge(g, x, y, w, h, base, amp, freq, phase) {
    g.beginPath(); g.moveTo(x, y + h);
    for (var i = 0; i <= 40; i++) {
      var t = i / 40;
      g.lineTo(x + w * t, y + h * (base + amp * Math.sin(t * Math.PI * 2 * freq + phase) + amp * 0.35 * Math.sin(t * 19 + phase * 2)));
    }
    g.lineTo(x + w, y + h); g.closePath();
  }
  function hill(g, x, y, w, h, base, amp, freq, phase, col) { ridge(g, x, y, w, h, base, amp, freq, phase); g.fillStyle = col; g.fill(); }
  function flower5(g, x, y, r, col, eye) {
    g.fillStyle = col;
    for (var k = 0; k < 5; k++) { var a = k * 1.2566; circle(g, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.52); }
    g.fillStyle = eye; circle(g, x, y, r * 0.3);
  }

  var SCENE = {
    ladang: function (g, x, y, w, h, R, U) {
      g.fillStyle = grad(g, 0, y, 0, y + h * 0.72, [[0, "#27304F"], [0.45, "#9C6273"], [0.78, "#E3A77E"], [1, "#F3D5A8"]]);
      g.fillRect(x, y, w, h);
      var sx = x + w * 0.7, sy = y + h * 0.56;
      glow(g, sx, sy, U * 0.42, "rgba(255,236,200,0.75)", "rgba(255,236,200,0)");
      g.fillStyle = "#FFF1D6"; circle(g, sx, sy, U * 0.085);
      hill(g, x, y, w, h, 0.6, 0.035, 1.3, R() * 6, "#7B7A66");
      hill(g, x, y, w, h, 0.68, 0.045, 2.1, R() * 6, "#56603F");
      hill(g, x, y, w, h, 0.78, 0.03, 1.6, R() * 6, "#3E4B33");
      var cols = ["#B5502C", "#E79AA6", "#F4EAD2", "#E7B84F", "#C96F8A"];
      for (var i = 0; i < 240; i++) {
        var t = Math.pow(R(), 0.6), fx = x + w * R(), fy = y + h * (0.7 + 0.3 * t), r = U * (0.004 + 0.016 * t);
        var col = cols[Math.floor(R() * cols.length)];
        if (r > U * 0.011) flower5(g, fx, fy, r, col, "#F3D38A");
        else { g.fillStyle = col; circle(g, fx, fy, r * 0.6); }
      }
    },
    sakura: function (g, x, y, w, h, R, U) {
      g.fillStyle = grad(g, 0, y, 0, y + h, [[0, "#D6E6F2"], [0.7, "#F6E3E8"], [1, "#EFD6DD"]]);
      g.fillRect(x, y, w, h);
      hill(g, x, y, w, h, 0.82, 0.02, 1.1, R() * 6, "#E6CBD3");
      var twig = function (bx, by, l, a, wdt, depth, tips) {
        var ex = bx + Math.cos(a) * l, ey = by + Math.sin(a) * l, bend = (R() - 0.5) * l * 0.35;
        var mx = (bx + ex) / 2 - Math.sin(a) * bend, my = (by + ey) / 2 + Math.cos(a) * bend;
        g.strokeStyle = "#4B3934"; g.lineCap = "round"; g.lineWidth = Math.max(0.5, wdt);
        g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
        tips.push([ex, ey]);
        if (depth > 0) {
          for (var i = 0; i < 2; i++) {
            var t = 0.4 + R() * 0.45, u = 1 - t;
            var qx = u * u * bx + 2 * u * t * mx + t * t * ex, qy = u * u * by + 2 * u * t * my + t * t * ey;
            tips.push([qx, qy]);
            twig(qx, qy, l * (0.42 + R() * 0.2), a + (i ? 1 : -1) * (0.45 + R() * 0.45), wdt * 0.6, depth - 1, tips);
          }
        }
      };
      var tips = [];
      twig(x - w * 0.02, y + h * 0.04, U * 0.75, 0.35, U * 0.024, 2, tips);
      twig(x + w * 1.02, y + h * 0.1, U * 0.65, Math.PI - 0.42, U * 0.02, 2, tips);
      var cols = ["#F6BCCB", "#F9D7E0", "#EE9DB2", "#FFF4F6"];
      tips.forEach(function (p) {
        for (var k = 0; k < 5; k++) {
          flower5(g, p[0] + (R() - 0.5) * U * 0.09, p[1] + (R() - 0.5) * U * 0.07, U * (0.014 + R() * 0.012), cols[Math.floor(R() * cols.length)], "#D9667F");
        }
      });
      for (var i = 0; i < 70; i++) {
        g.fillStyle = cols[i % 3];
        var px = x + w * R(), py = y + h * R(), pr = U * (0.004 + R() * 0.006);
        g.beginPath(); g.ellipse ? g.ellipse(px, py, pr * 1.6, pr, R() * 3, 0, Math.PI * 2) : g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      }
    },
    kebun: function (g, x, y, w, h, R, U) {
      g.fillStyle = grad(g, 0, y, 0, y + h * 0.6, [[0, "#B9D5E0"], [1, "#EEF1E4"]]);
      g.fillRect(x, y, w, h);
      hill(g, x, y, w, h, 0.42, 0.07, 0.8, R() * 6, "#8EA3A6");
      g.fillStyle = grad(g, 0, y + h * 0.36, 0, y + h * 0.6, [[0, "rgba(255,255,255,0)"], [1, "rgba(255,255,255,0.55)"]]);
      g.fillRect(x, y + h * 0.36, w, h * 0.24);
      [[0.55, 0.04, 1.2, "#8DB27A", "#76A064"], [0.7, 0.05, 1.7, "#5E8F4E", "#4E7D41"], [0.84, 0.03, 1.3, "#3F6E37", "#335C2D"]].forEach(function (L) {
        var ph = R() * 6;
        g.save();
        ridge(g, x, y, w, h, L[0], L[1], L[2], ph); g.fillStyle = L[3]; g.fill(); g.clip();
        g.strokeStyle = L[4]; g.lineWidth = Math.max(0.6, U * 0.007);
        for (var row = 1; row < 14; row++) {
          var off = row * 0.028;
          g.beginPath();
          for (var i = 0; i <= 40; i++) {
            var t = i / 40;
            var yy = y + h * (L[0] + off + L[1] * Math.sin(t * Math.PI * 2 * L[2] + ph) * (1 - row * 0.05));
            if (i) g.lineTo(x + w * t, yy); else g.moveTo(x + w * t, yy);
          }
          g.stroke();
        }
        g.restore();
      });
      g.fillStyle = "#2F4F2A";
      for (var k = 0; k < 7; k++) circle(g, x + w * (0.08 + k * 0.13 + R() * 0.04), y + h * (0.53 + R() * 0.02), U * (0.018 + R() * 0.01));
    },
    kota: function (g, x, y, w, h, R, U) {
      g.fillStyle = grad(g, 0, y, 0, y + h, [[0, "#0B1030"], [0.6, "#262B57"], [0.86, "#5A3F6B"], [1, "#1A1433"]]);
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,0.8)";
      for (var s = 0; s < 90; s++) circle(g, x + w * R(), y + h * R() * 0.5, U * (0.0015 + R() * 0.003));
      var ground = y + h * 0.88;
      var block = function (near) {
        var bx = x - w * 0.02;
        while (bx < x + w) {
          var bw = w * (near ? 0.07 + R() * 0.08 : 0.04 + R() * 0.06);
          var bh = h * (near ? 0.1 + R() * 0.16 : 0.16 + R() * 0.26);
          g.fillStyle = near ? "#0C0F29" : "#161B42";
          g.fillRect(bx, ground - bh, bw, bh + h * 0.12);
          g.fillStyle = near ? "rgba(246,214,130,0.9)" : "rgba(246,214,130,0.55)";
          var cw = Math.max(1, bw / 6), chh = Math.max(1, h * 0.012);
          for (var wy = ground - bh + chh; wy < ground - chh; wy += chh * 2.2) {
            for (var wx = bx + cw * 0.6; wx < bx + bw - cw; wx += cw * 1.7) if (R() < 0.33) g.fillRect(wx, wy, cw * 0.8, chh);
          }
          bx += bw + w * 0.004;
        }
      };
      block(false);
      // the tower
      var tx = x + w * 0.74, top = y + h * 0.24, base = ground, half = U * 0.09;
      g.strokeStyle = "#E0553B"; g.lineWidth = Math.max(0.8, U * 0.006);
      g.beginPath(); g.moveTo(tx - half, base); g.quadraticCurveTo(tx - half * 0.2, top + (base - top) * 0.45, tx, top);
      g.moveTo(tx + half, base); g.quadraticCurveTo(tx + half * 0.2, top + (base - top) * 0.45, tx, top); g.stroke();
      for (var b = 1; b < 9; b++) {
        var ty = base - (base - top) * b / 9, sp = half * Math.pow(1 - b / 9, 1.6);
        g.beginPath(); g.moveTo(tx - sp, ty); g.lineTo(tx + sp, ty); g.stroke();
      }
      g.fillStyle = "#F4F1EA";
      g.fillRect(tx - half * 0.55, base - (base - top) * 0.42, half * 1.1, h * 0.018);
      g.fillRect(tx - half * 0.3, base - (base - top) * 0.72, half * 0.6, h * 0.012);
      glow(g, tx, top, U * 0.03, "rgba(255,120,90,0.9)", "rgba(255,120,90,0)");
      block(true);
      g.fillStyle = "#07091C"; g.fillRect(x, ground + h * 0.02, w, h);
    },
    salju: function (g, x, y, w, h, R, U) {
      g.fillStyle = grad(g, 0, y, 0, y + h, [[0, "#1C2A48"], [1, "#4E6E92"]]);
      g.fillRect(x, y, w, h);
      glow(g, x + w * 0.22, y + h * 0.2, U * 0.24, "rgba(240,244,250,0.45)", "rgba(240,244,250,0)");
      g.fillStyle = "#F1F4F8"; circle(g, x + w * 0.22, y + h * 0.2, U * 0.065);
      hill(g, x, y, w, h, 0.62, 0.05, 1.1, R() * 6, "#9FB3CB");
      for (var p = 0; p < 11; p++) {
        var px = x + w * (0.03 + p * 0.095 + R() * 0.03), py = y + h * (0.74 + R() * 0.04), ph = U * (0.12 + R() * 0.08);
        for (var tier = 0; tier < 3; tier++) {
          var ty = py - ph * tier * 0.28, tw = ph * (0.36 - tier * 0.08);
          g.fillStyle = "#2B455A";
          g.beginPath(); g.moveTo(px, ty - ph * 0.42); g.lineTo(px - tw, ty); g.lineTo(px + tw, ty); g.closePath(); g.fill();
          g.fillStyle = "#E8EEF5";
          g.beginPath(); g.moveTo(px, ty - ph * 0.42); g.lineTo(px - tw * 0.35, ty - ph * 0.28); g.lineTo(px + tw * 0.35, ty - ph * 0.28); g.closePath(); g.fill();
        }
      }
      hill(g, x, y, w, h, 0.8, 0.025, 0.9, R() * 6, "#EEF3F8");
      for (var s = 0; s < 170; s++) {
        g.fillStyle = "rgba(255,255,255," + (0.45 + R() * 0.5).toFixed(2) + ")";
        circle(g, x + w * R(), y + h * R(), U * (0.002 + R() * 0.006));
      }
    },
    kafe: function (g, x, y, w, h, R, U) {
      var bg = g.createRadialGradient(x + w * 0.5, y + h * 0.35, 0, x + w * 0.5, y + h * 0.35, Math.max(w, h) * 0.8);
      bg.addColorStop(0, "#3A2718"); bg.addColorStop(1, "#110C09");
      g.fillStyle = bg; g.fillRect(x, y, w, h);
      var tones = ["255,206,133", "224,163,86", "240,150,120", "251,247,240"];
      for (var i = 0; i < 55; i++) {
        var bx = x + w * R(), by = y + h * R(), br = U * (0.025 + R() * 0.08), tone = tones[Math.floor(R() * tones.length)];
        glow(g, bx, by, br, "rgba(" + tone + "," + (0.12 + R() * 0.28).toFixed(2) + ")", "rgba(" + tone + ",0)");
      }
      g.strokeStyle = "rgba(20,14,10,0.9)"; g.lineWidth = Math.max(0.6, U * 0.004);
      g.beginPath(); g.moveTo(x, y + h * 0.16); g.quadraticCurveTo(x + w * 0.5, y + h * 0.34, x + w, y + h * 0.12); g.stroke();
      for (var k = 0; k <= 16; k++) {
        var t = k / 16, u = 1 - t;
        var lx = u * u * x + 2 * u * t * (x + w * 0.5) + t * t * (x + w);
        var ly = u * u * (y + h * 0.16) + 2 * u * t * (y + h * 0.34) + t * t * (y + h * 0.12);
        glow(g, lx, ly + U * 0.012, U * 0.03, "rgba(255,214,150,0.9)", "rgba(255,214,150,0)");
      }
    },
    /* Kalung 26, her birthday night: a deep red room lit warm from the
       middle, soft lights out of focus, two strings of bulbs across the top,
       and a few hearts in the dark. */
    malam26: function (g, x, y, w, h, R, U) {
      g.fillStyle = grad(g, 0, y, 0, y + h, [[0, "#140504"], [0.55, "#2E0B0A"], [1, "#4A140F"]]);
      g.fillRect(x, y, w, h);
      glow(g, x + w * 0.5, y + h * 0.42, Math.max(w, h) * 0.62, "rgba(224,80,60,0.3)", "rgba(224,80,60,0)");
      for (var i = 0; i < 30; i++) {
        var a = (0.06 + R() * 0.16).toFixed(3), c = 150 + Math.floor(R() * 80);
        g.fillStyle = "rgba(255," + c + ",120," + a + ")";
        circle(g, x + R() * w, y + R() * h * 0.82, U * (0.018 + R() * 0.06));
      }
      [[0.08, 0.1], [0.2, 0.14]].forEach(function (L, k) {
        var y0 = y + h * L[0], sag = h * L[1], n = 11 + k * 3;
        g.strokeStyle = "rgba(40,20,14,0.9)"; g.lineWidth = Math.max(1, U * 0.004);
        g.beginPath(); g.moveTo(x - w * 0.02, y0); g.quadraticCurveTo(x + w / 2, y0 + sag * 2, x + w * 1.02, y0); g.stroke();
        for (var j = 0; j <= n; j++) {
          var t = j / n, u = 1 - t;
          var bx = u * u * (x - w * 0.02) + 2 * u * t * (x + w / 2) + t * t * (x + w * 1.02);
          var by = u * u * y0 + 2 * u * t * (y0 + sag * 2) + t * t * y0 + U * 0.012;
          glow(g, bx, by, U * 0.05, "rgba(255,214,150,0.55)", "rgba(255,214,150,0)");
          g.fillStyle = "#FFE3B0"; circle(g, bx, by, U * 0.008);
        }
      });
      for (var k2 = 0; k2 < 7; k2++) {
        var hx = x + (0.08 + R() * 0.84) * w, hy = y + (0.34 + R() * 0.5) * h, hs = U * (0.03 + R() * 0.05);
        g.fillStyle = "rgba(240,122,92," + (0.14 + R() * 0.16).toFixed(3) + ")";
        g.beginPath(); g.moveTo(hx, hy + hs * 0.9);
        g.bezierCurveTo(hx - hs * 1.4, hy, hx - hs * 0.8, hy - hs * 1.1, hx, hy - hs * 0.35);
        g.bezierCurveTo(hx + hs * 0.8, hy - hs * 1.1, hx + hs * 1.4, hy, hx, hy + hs * 0.9);
        g.fill();
      }
    },
    studio: function (g, x, y, w, h, R, U) {
      var bg = g.createRadialGradient(x + w * 0.5, y + h * 0.38, 0, x + w * 0.5, y + h * 0.38, Math.max(w, h) * 0.78);
      bg.addColorStop(0, "#FAF5EC"); bg.addColorStop(1, "#D6CAB6");
      g.fillStyle = bg; g.fillRect(x, y, w, h);
      g.fillStyle = grad(g, 0, y + h * 0.72, 0, y + h, [[0, "rgba(60,45,30,0)"], [1, "rgba(60,45,30,0.14)"]]);
      g.fillRect(x, y + h * 0.72, w, h * 0.28);
    }
  };

  /* Paint wallpaper `id` over the rectangle, covering it. `img` is only used
     for "foto" (her or his own picture); without one it is the studio paper. */
  function draw(g, id, x, y, w, h, img) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    if (POLOS[id]) {
      g.fillStyle = POLOS[id]; g.fillRect(x, y, w, h);
    } else if (id === "foto" && img && (img.naturalWidth || img.width)) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.max(w / iw, h / ih);
      g.drawImage(img, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
    } else {
      var name = SCENE[id] ? id : "studio";
      SCENE[name](g, x, y, w, h, rng(seed(name)), Math.min(w, h));
    }
    g.restore();
  }

  /* Person confidence (0..1 per pixel) to a mask. Below `lo` is background,
     above `hi` is you, and a smoothstep between keeps the edge of hair soft
     instead of a cut-paper outline. `out` is RGBA; only alpha matters. */
  function alpha(conf, out, lo, hi) {
    lo = lo == null ? 0.3 : lo; hi = hi == null ? 0.7 : hi;
    var span = Math.max(1e-6, hi - lo);
    for (var i = 0, j = 0; i < conf.length; i++, j += 4) {
      var v = (conf[i] - lo) / span;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      v = v * v * (3 - 2 * v);
      out[j] = out[j + 1] = out[j + 2] = 255;
      out[j + 3] = Math.round(v * 255);
    }
    return out;
  }

  /* A real green screen: a pixel is background when green beats both red and
     blue by more than the tolerance. `peka` (5..95) is how much green counts;
     the last few percent fade rather than cut. Rewrites RGBA in place. */
  function chroma(data, peka) {
    var t = 0.04 + Math.max(5, Math.min(95, peka == null ? 45 : peka)) / 100 * 0.3, s = 0.05;
    for (var j = 0; j < data.length; j += 4) {
      var key = (data[j + 1] - Math.max(data[j], data[j + 2])) / 255;
      var a = (t - key) / s;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      data[j] = data[j + 1] = data[j + 2] = 255;
      data[j + 3] = Math.round(a * 255);
    }
    return data;
  }

  root.Latar = { LIST: LIST, IDS: IDS, draw: draw, alpha: alpha, chroma: chroma };
})(typeof window !== "undefined" ? window : globalThis);
