// node latar.test.mjs — the photobox wallpapers and the cut-out masks (assets/js/latar.js)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const W = {};
vm.runInNewContext(readFileSync(path.join(here, "assets/js/latar.js"), "utf8"), { window: W, Math, Number, Object, String, isFinite });
const L = W.Latar;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

function fakeContext() {
  const calls = [];
  const state = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "calls") return calls;
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return (...args) => { calls.push([key, ...args.map((a) => (typeof a === "number" ? Math.round(a * 1000) / 1000 : typeof a === "string" ? a : "·"))]); };
    },
    set(target, key, value) { target[key] = value; calls.push(["set:" + String(key), typeof value === "string" ? value : "·"]); return true; }
  });
  return ctx;
}

t("the list has unique ids, starting with the camera as it is and ending with your own photo", () => {
  assert.equal(new Set(L.IDS).size, L.IDS.length);
  assert.equal(L.IDS[0], "asli");
  assert.equal(L.IDS[L.IDS.length - 1], "foto");
  for (const id of ["ladang", "sakura", "kebun", "kota", "salju", "kafe", "studio"]) assert.ok(L.IDS.includes(id), id);
});

t("every wallpaper draws at a card, a preview and a print size without throwing", () => {
  for (const id of L.IDS) {
    for (const [w, h] of [[96, 72], [571, 428], [1800, 1350], [456, 1390]]) {
      const g = fakeContext();
      L.draw(g, id, 10, 20, w, h, null);
      assert.ok(g.calls.some((c) => c[0] === "fillRect" || c[0] === "fill"), id + " " + w);
      assert.equal(g.calls[0][0], "save");
      assert.equal(g.calls[g.calls.length - 1][0], "restore");
    }
  }
});

t("a wallpaper is seeded: the same scene every time, and the same shapes at every size", () => {
  for (const id of ["ladang", "sakura", "kebun", "kota", "salju", "kafe"]) {
    const a = fakeContext(), b = fakeContext(), big = fakeContext();
    L.draw(a, id, 0, 0, 400, 300);
    L.draw(b, id, 0, 0, 400, 300);
    L.draw(big, id, 0, 0, 1600, 1200);
    assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls), id);
    const kinds = (g) => g.calls.map((c) => c[0]).join(",");
    assert.equal(kinds(a), kinds(big), id + " scales, it does not change");
  }
});

t("scenes are really drawn, and a plain colour is one fill", () => {
  const g = fakeContext();
  L.draw(g, "ladang", 0, 0, 800, 600);
  assert.ok(g.calls.filter((c) => c[0] === "arc").length > 200, "a field of flowers");
  const p = fakeContext();
  L.draw(p, "jambu", 0, 0, 800, 600);
  assert.equal(p.calls.filter((c) => c[0] === "fillRect").length, 1);
});

t("your own photo covers the rectangle, and without one it is the studio paper", () => {
  const img = { naturalWidth: 1000, naturalHeight: 500 };
  const g = fakeContext();
  L.draw(g, "foto", 0, 0, 400, 400, img);
  const di = g.calls.find((c) => c[0] === "drawImage");
  assert.deepEqual(di.slice(2), [-200, 0, 800, 400]);
  const none = fakeContext();
  L.draw(none, "foto", 0, 0, 400, 400, null);
  assert.ok(!none.calls.some((c) => c[0] === "drawImage"));
  assert.ok(none.calls.some((c) => c[0] === "fillRect"));
  const unknown = fakeContext();
  L.draw(unknown, "nope", 0, 0, 100, 100);
  assert.ok(unknown.calls.length > 2);
});

t("person confidence becomes a soft-edged mask", () => {
  const out = new Uint8ClampedArray(5 * 4);
  L.alpha([0, 0.3, 0.5, 0.7, 1], out);
  assert.deepEqual([out[3], out[7], out[11], out[15], out[19]], [0, 0, 128, 255, 255]);
  assert.equal(out[8], 255);
});

t("a green screen drops the green and keeps you, more of it as sensitivity rises", () => {
  const px = (r, g, b, peka) => L.chroma(new Uint8ClampedArray([r, g, b, 255]), peka)[3];
  assert.equal(px(0, 255, 0, 45), 0, "pure green");
  assert.equal(px(40, 190, 60, 45), 0, "a real cloth");
  assert.equal(px(224, 172, 140, 45), 255, "skin");
  assert.equal(px(128, 128, 128, 45), 255, "grey");
  assert.equal(px(30, 30, 40, 95), 255, "dark hair");
  const edge = [100, 125, 100];   // green leads by 0.098
  assert.ok(px(...edge, 95) >= px(...edge, 5));
  assert.equal(px(...edge, 5), 0);
  assert.equal(px(...edge, 95), 255);
});

console.log(n + " tests passed");
