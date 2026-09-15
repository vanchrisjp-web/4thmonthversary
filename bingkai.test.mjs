// node bingkai.test.mjs — the photobox strip's layouts and frames (assets/js/bingkai.js)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const W = {};
vm.runInNewContext(readFileSync(path.join(here, "assets/js/bingkai.js"), "utf8"), { window: W, Math, Number, Object, String, isFinite, parseInt });
const B = W.Bingkai;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
const J = (v) => JSON.parse(JSON.stringify(v));

/* A 2D context that records what is asked of it and answers measureText the
   way a real one roughly would, so draw() runs end to end without a browser. */
function fakeContext() {
  const calls = [];
  const state = { font: "400 10px x", letterSpacing: "0px" };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "calls") return calls;
      if (key === "measureText") return (s) => ({ width: String(s).length * (parseFloat(/(\d+(\.\d+)?)px/.exec(target.font)?.[1] || "10")) * 0.55 });
      if (key === "createLinearGradient") return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return (...args) => { calls.push([key, ...args.map((a) => (typeof a === "number" ? Math.round(a * 100) / 100 : typeof a === "string" ? a : "·"))]); };
    },
    set(target, key, value) { target[key] = value; calls.push(["set:" + String(key), value]); return true; }
  });
  return ctx;
}
const pic = { img: {}, w: 1280, h: 720 };

t("every layout plans a canvas whose pictures stay inside it", () => {
  for (const L of B.LAYOUTS) {
    for (const rasio of B.RASIO_ORDER) {
      for (const frame of B.FRAME_ORDER) {
        const p = B.plan({ layout: L.id, rasio, frame, n: 4, susun: "kolom" });
        assert.ok(p.W > 100 && p.H > 100, L.id + " " + rasio + " " + frame);
        assert.ok(p.W <= 2400 && p.H <= 3600, "capped: " + L.id + " " + rasio + " " + p.W + "x" + p.H);
        assert.ok(p.shots >= 1 && p.shots <= 4);
        for (const c of p.cells) {
          if (c.card) continue;
          assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= p.W + 0.5 && c.y + c.h <= p.H + 0.5, L.id + " cell outside");
        }
      }
    }
  }
});

t("shot counts are what the cards say", () => {
  const count = (o) => B.plan(o).shots;
  assert.equal(count({ layout: "side" }), 1);
  assert.equal(count({ layout: "stack" }), 1);
  assert.equal(count({ layout: "grid" }), 2);
  assert.equal(count({ layout: "strip" }), 3);
  assert.equal(count({ layout: "strip4" }), 4);
  assert.equal(count({ layout: "klasik" }), 2);
  assert.equal(count({ layout: "mendatar" }), 3);
  assert.equal(count({ layout: "belah" }), 1);
  assert.equal(count({ layout: "jendela" }), 1);
  assert.equal(count({ layout: "polaroid" }), 1);
  for (const susun of ["pasang", "tumpuk", "kolom", "baris"]) {
    for (let k = 1; k <= 4; k++) assert.equal(count({ layout: "kustom", n: k, susun }), k, susun + " " + k);
  }
});

t("every shot has both of you in it, exactly once per picture slot", () => {
  for (const L of B.LAYOUTS) {
    const p = B.plan({ layout: L.id, n: 3, susun: "tumpuk" });
    for (let s = 0; s < p.shots; s++) {
      const whos = p.cells.filter((c) => c.shot === s).map((c) => c.who).sort().join("");
      assert.equal(whos, "ab", L.id + " shot " + s);
    }
  }
});

t("grid cells never overlap", () => {
  for (const id of ["side", "stack", "grid", "strip", "strip4", "klasik", "mendatar", "kustom"]) {
    const cells = B.plan({ layout: id, n: 4, jarak: 0 }).cells;
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, id + " cells " + i + "/" + j);
    }
  }
});

t("with the old gaps, the classic Side A geometry prints its old sizes exactly", () => {
  const classic = B.defaults("004");
  const size = (layout, extra) => { const p = B.plan({ ...classic, layout, ...extra }); return p.W + "x" + p.H; };
  assert.equal(size("side", { jarak: 18 }), "1120x500");
  assert.equal(size("stack", { jarak: 18 }), "620x994");
  assert.equal(size("grid", { jarak: 16 }), "900x752");
  assert.equal(size("strip", { posisi: "atas" }), "620x818");
  assert.equal(size("strip4", { posisi: "atas", jarak: 12 }), "620x1044");
});

t("the ratio shapes every picture, and thickness and gap move them", () => {
  const sq = B.plan({ layout: "grid", rasio: "1:1" }).cells[0];
  assert.equal(sq.w, sq.h);
  const tall = B.plan({ layout: "side", rasio: "3:4" }).cells[0];
  assert.ok(tall.h > tall.w);
  const thin = B.plan({ layout: "strip", tebal: 4, jarak: 2 }), thick = B.plan({ layout: "strip", tebal: 60, jarak: 40 });
  assert.equal(thin.cells[0].x, 4);
  assert.equal(thick.cells[0].x, 60);
  assert.equal(thick.cells[1].x - (thick.cells[0].x + thick.cells[0].w), 40);
});

t("no frame means the pictures touch the edge, with no bands", () => {
  const p = B.plan({ layout: "strip", frame: "none", tebal: 50, jarak: 30, teks: "Halo", posisi: "atas" });
  assert.equal(p.cells[0].x, 0);
  assert.equal(p.cells[0].y, 0);
  assert.equal(p.top, null);
  assert.equal(p.bot, null);
  const last = p.cells[p.cells.length - 1];
  assert.equal(last.x + last.w, p.W);
  assert.equal(last.y + last.h, p.H);
});

t("swapping puts each of you where the other was", () => {
  const a = B.plan({ layout: "side" }).cells.map((c) => c.who).join("");
  const b = B.plan({ layout: "side", tukar: true }).cells.map((c) => c.who).join("");
  assert.equal(a, "ab");
  assert.equal(b, "ba");
});

t("a long caption beside the date moves to its own line", () => {
  const short = B.plan({ layout: "stack", teks: "Kamu ♥ Aku" });
  const long = B.plan({ layout: "stack", teks: "Dua kota, satu frame, dan satu lagu yang sama" });
  assert.equal(short.bands.two, false);
  assert.equal(long.bands.two, true);
  assert.ok(long.bot.h > short.bot.h);
  const alone = B.plan({ layout: "stack", teks: "Dua kota, satu frame, dan satu lagu yang sama", tanggal: false, cap: false });
  assert.equal(alone.bands.two, false);
});

t("caption on top makes a head band; no caption and no meta, no footer", () => {
  assert.ok(B.plan({ layout: "strip", posisi: "atas" }).top);
  assert.equal(B.plan({ layout: "strip", posisi: "bawah" }).top, null);
  const bare = B.plan({ layout: "side", posisi: "tanpa", tanggal: false, cap: false });
  assert.equal(bare.bot, null);
  assert.equal(bare.H, 2 * 18 + bare.cells[0].h);
});

t("norm clamps junk and keeps a deliberate empty caption", () => {
  const o = B.norm({ layout: "x", tebal: 999, jarak: -4, sudut: "12", warna: "red", teks: "  ab   c  ", ukuran: 5, hitung: 7, tukar: "yes", n: 9, frame: "__proto__" });
  assert.equal(o.layout, "side");
  assert.equal(o.tebal, 80);
  assert.equal(o.jarak, 0);
  assert.equal(o.sudut, 12);
  assert.equal(o.warna, "");
  assert.equal(o.teks, "ab c");
  assert.equal(o.ukuran, 60);
  assert.equal(o.hitung, 3);
  assert.equal(o.tukar, false);
  assert.equal(o.n, 4);
  assert.equal(o.frame, "sisia");
  assert.equal(B.norm({ teks: "" }).teks, "");
  assert.equal(B.norm({ warna: "#B5502C" }).warna, "#b5502c");
  assert.equal(B.norm({ teks: "x".repeat(90) }).teks.length, 48);
});

t("YS-006 walks in wearing the field; Side A and the café keep the classic strip", () => {
  const six = B.defaults("006");
  assert.equal(six.frame, "ladang");
  assert.equal(six.huruf, "lebar");
  assert.match(six.teks, /✿/);
  assert.equal(B.defaults("004").frame, "sisia");
  assert.equal(B.defaults("005").frame, "sisia");
  assert.ok(B.presets("006").some((s) => /Ladang Bunga · YS-006/.test(s)));
  assert.ok(B.presets("006").includes("17.09.2026"));
  assert.ok(B.presets("123").length >= 5);
});

t("choosing a frame brings its thickness, but not over one you set yourself", () => {
  const start = B.defaults("006");
  const kafe = B.pakai(start, "kafe");
  assert.equal(kafe.frame, "kafe");
  assert.equal(kafe.tebal, B.FRAMES.kafe.pakai.tebal);
  assert.equal(kafe.huruf, "anggun");
  const mine = B.pakai({ ...start, tebal: 61, huruf: "tangan" }, "film");
  assert.equal(mine.tebal, 61);
  assert.equal(mine.huruf, "tangan");
  assert.equal(mine.jarak, B.FRAMES.film.pakai.jarak);
  const none = B.pakai(start, "none");
  assert.equal(none.tebal, start.tebal);
  assert.equal(B.pakai(none, "ladang").tebal, B.FRAMES.ladang.pakai.tebal);
});

t("a paper colour of your own keeps the type readable", () => {
  const dark = B.palette(B.norm({ frame: "ladang", warna: "#1b1a15" }));
  assert.equal(dark.ink, "#F4F0E6");
  const light = B.palette(B.norm({ frame: "kafe", warna: "#ffffff" }));
  assert.equal(light.ink, "#1B1A15");
  const rust = B.palette(B.norm({ frame: "ladang", warna: "#b5502c" }));
  assert.notEqual(rust.accent, "#B5502C");
});

t("every layout draws in every frame, in print and as a card, without throwing", () => {
  for (const L of B.LAYOUTS) {
    for (const frame of B.FRAME_ORDER) {
      for (const posisi of ["atas", "bawah", "tanpa"]) {
        const o = { layout: L.id, frame, posisi, teks: "Kamu ✿ Aku ♥", sudut: 10, n: 2 };
        const p = B.plan(o);
        const g1 = fakeContext();
        B.draw(g1, p, o, { src: (c) => (c.who === "a" ? { ...pic, flip: true } : pic), filter: "sepia(0.2)", date: "15 September 2026  ·  07:12", press: "YS-006", hot: 0 });
        assert.ok(g1.calls.length > 10, L.id + " " + frame);
        const g2 = fakeContext();
        B.draw(g2, p, o, { thumb: true, press: "YS-006" });
        assert.ok(g2.calls.some((c) => c[0] === "fill"), "thumb " + L.id + " " + frame);
      }
    }
  }
});

t("the caption is printed, with the flower drawn and the heart in the accent", () => {
  const o = { ...B.defaults("006"), teks: "Kamu ✿ Aku ♥", layout: "side" };
  const g = fakeContext();
  B.draw(g, B.plan(o), o, { src: () => pic, date: "17 September 2026  ·  17:17", press: "YS-006" });
  const texts = g.calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
  assert.ok(texts.includes("Kamu "), texts.join("|"));
  assert.ok(texts.includes(" Aku "));
  assert.ok(texts.includes("♥"));
  assert.ok(!texts.includes("✿"), "the blossom is drawn, not set");
  assert.ok(texts.includes("17 September 2026  ·  17:17"));
  assert.ok(texts.includes("YS-006"));
  const heartColour = g.calls.findIndex((c) => c[0] === "fillText" && c[1] === "♥");
  const lastFill = g.calls.slice(0, heartColour).reverse().find((c) => c[0] === "set:fillStyle");
  assert.equal(lastFill[1], B.FRAMES.ladang.accent);
});

t("missing pictures print as a place for you, labelled", () => {
  const o = { layout: "strip" };
  const g = fakeContext();
  B.draw(g, B.plan(o), o, { src: () => null, date: "", press: "YS-004" });
  const texts = g.calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
  assert.ok(texts.includes("KAMU · 1"));
  assert.ok(texts.includes("DIA · 3"));
});

t("decoration is seeded: the same strip draws the same flowers every time", () => {
  const o = { ...B.defaults("006"), layout: "strip4" };
  const p = B.plan(o);
  const a = fakeContext(), b = fakeContext();
  B.draw(a, p, o, { src: () => pic, date: "x", press: "YS-006" });
  B.draw(b, p, o, { src: () => pic, date: "x", press: "YS-006" });
  assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls));
  const bare = fakeContext();
  B.draw(bare, p, { ...o, hiasan: false }, { src: () => pic, date: "x", press: "YS-006" });
  assert.ok(bare.calls.length < a.calls.length);
});

t("the mirror is flipped only for your own picture", () => {
  const o = { layout: "side", frame: "putih" };
  const g = fakeContext();
  B.draw(g, B.plan(o), o, { src: (c) => (c.who === "a" ? { ...pic, flip: true } : pic), date: "", press: "" });
  assert.equal(g.calls.filter((c) => c[0] === "scale" && c[1] === -1).length, 1);
});

console.log(n + " tests passed");
