# Build: "Side A" — a monthsversary record

Build a single-page site that is a **gift for my girlfriend**, celebrating our 4th monthsversary. Ship it as a deployable static site with a hidden, password-protected editor.

---

## 1. The concept (do not swap this out)

**The site is a vinyl record.** Not a website *about* a record — a record. Every structure comes from that world, which is why the site earns its shapes instead of decorating with them:

| Site element | Record vernacular |
|---|---|
| 16 memories | **16 tracks** on the album |
| Days together | **total runtime** (counter reads `04:29` = 4 months, 29 days) |
| The love letter | **liner notes**, printed on the inner sleeve |
| 100 reasons | the **credits / lyric sheet** — dense, tiny, numbered `001–100` |
| Time capsule | **hidden Track 17**, `[UNRELEASED]`, locked until a date |
| The editor | the **mixing desk** |
| This month's edition | **catalog no. YS-004** |

The pun is bilingual and load-bearing: *album* = photo album = record album. Lean on it.

---

## 2. Anti-brief — what will get rejected

I've already seen the generic version and I don't want it again:

- ❌ Cream/ivory background + high-contrast serif + terracotta accent. This is the default AI look.
- ❌ Floating hearts, petal particles, rose SVGs, script fonts, pink gradients, glowing orbs.
- ❌ A centered vertical stack of `eyebrow → serif h2 → card` repeated eight times.
- ❌ A night→dawn→day scroll gradient.
- ❌ A "runaway button" gag or a sealed wax-seal envelope.

Restraint over sentiment. The *content* is emotional; the *design* should be cool, printed, and precise. That contrast is the whole point.

---

## 3. Design system

**Palette** — a two-ink risograph print with visible ink behavior:
```
--ink:      #12100E   /* sleeve black, near-black with warmth */
--paper:    #F2EDE3   /* uncoated stock */
--riso-pink:#FF4A7D   /* fluorescent ink 1 */
--riso-blue:#1C4FD8   /* ink 2 */
--halftone: #9A958C   /* grey for rules, captions */
```
Rules: black sleeve dominates. The two inks **overprint** — where pink and blue overlap, blend to a violet (`mix-blend-mode: multiply`). Add a subtle halftone/grain texture (CSS repeating radial-gradient or an SVG feTurbulence overlay). Slight misregistration (1–2px offset on duplicated headline layers) as a deliberate print artifact. No border-radius except on circular things (the record).

**Type** — a grotesk system, no serifs anywhere:
- Display: `Archivo` 800 (or `Big Shoulders Display`) — tight tracking, oversized, uppercase.
- Body: `Space Grotesk`.
- Utility: `Space Mono` for track numbers, runtimes, catalog nos., labels. Mono is where the "catalog" personality lives.

**Signature element (spend the boldness here, keep everything else quiet):**
A **turntable that actually responds to scroll.** The record spins, and the **tonearm tracks across it as scroll progress** — the needle's position on the disc *is* the scrollbar. The grooves in the record are drawn as concentric rings, one per month together. It stays as a small persistent player in the corner after the hero. Do this one thing extremely well and cut anything else that competes with it.

---

## 4. Page structure

1. **The sleeve (hero)** — a full-bleed album cover. Artist = our two names, title = the album name, `CAT. NO. YS-004`, `SIDE A / SIDE B`, and `TOTAL RUNTIME 04:29` (live from the start date). On load: the record slides out of the sleeve and drops onto the platter. One orchestrated moment, then stillness.
2. **Tracklist — 16 tracks.** A dense mono-set list (`01 ⏵ TITLE ······· 03:12`). Clicking a track expands it in place into a **liner-note spread**: the photo (printed, halftoned), the date, the story, and — if present — a **commentary audio note** you can play. Deep-linkable: `#/track/07`. Keyboard: ↑ ↓ to move, Enter to open.
3. **Liner notes** — the love letter, set as an inner-sleeve print: narrow measure, mono header (`LINER NOTES — WRITTEN BY ___`), paragraphs revealed in sequence. No envelope gimmick; it's a printed insert.
4. **Credits — 100 Alasan.** Set as a real credits sheet: two dense columns, small type, numbered `001`–`100`. On top, one is pulled out as **"TRACK OF THE DAY"** — rotates daily, deterministic from the date, so the site is different every visit. A `⏵ SHUFFLE` control picks one at random with a mechanical flicker. A filter field to search the list.
5. **Hidden track — Track 17.** Rendered in the tracklist as `17 ······· [UNRELEASED]` with a countdown. It unlocks on a date I set (default: the next monthsversary), then reveals a secret message.
6. **Back cover** — countdown to the **next pressing** (next monthsversary), credits, footer.

Persistent **now-playing bar** at the bottom throughout: the mini record, tonearm, play/pause for the real song, and current section as the "track" name.

---

## 5. Features

- **Real audio.** A song plays (file in `/audio/` or uploaded via the editor). Muted by default; one honest play button. The record's spin syncs to whether audio is playing.
- **Commentary notes.** In the editor, I can **record a voice note per track** (MediaRecorder API) — my voice narrating that memory. It plays inside the expanded track. This is the feature I care most about.
- **Track of the day** — daily deterministic rotation through the 100.
- **Hidden Track 17** — date-locked reveal.
- **Print stylesheet** — `Cmd+P` outputs a real, well-set record sleeve insert (tracklist + liner notes + credits). Free, and it means she can print it.
- Accessibility floor: keyboard-navigable, visible focus, `prefers-reduced-motion` fully respected (record stops spinning, reveals become instant), works down to 360px, semantic HTML, alt text.

---

## 6. Data model

All content lives in one object. Ship sensible Indonesian defaults so the site is complete before I touch it.

```js
{
  passcode: "salju2026",
  catalog_no: "YS-004",
  artist_a: "...", artist_b: "...",
  album_title: "...",
  start_date: "YYYY-MM-DD",     // drives runtime, grooves, countdowns
  song_url: "",                  // or uploaded audio
  liner_notes: "...",            // the letter, \n\n paragraphs
  tracks: [                      // exactly 16 by default, add/remove freely
    { n:1, title:"", date:"", story:"", photo:"", commentary:"" }  // photo/commentary = data URLs
  ],
  hidden_track: { unlock_date:"", message:"" },
  reasons: [ /* 100 strings — see §8 */ ],
  closing: "...", footer: "..."
}
```

**Load order:** built-in defaults → `content.json` (if fetched) → `localStorage` override. This means the site is never blank and never depends on a backend.

---

## 7. The editor — `/edit`

A **hash route** (`#edit`), so it works on any host and any custom domain with zero server routing config. Passcode-gated (from the content object).

Styled as a **mixing desk** — same ink/paper system, mono labels, channel-strip rows. Tabs:

- **Master** — names, album title, catalog no., start date, song upload, liner notes, closing, footer, passcode.
- **Tracks** — the 16 (or more): title, date, story, **photo upload**, **voice-note recorder** (record / re-record / delete, with duration), reorder ↑↓, add, delete.
- **Credits** — the 100 reasons: edit, reorder, add, delete, bulk paste.
- **Hidden Track** — unlock date + secret message.

Two actions, named for what they do:
- **`SAVE`** → writes to `localStorage`. Instant preview on this device.
- **`EXPORT`** → downloads `content.json` to commit. Live for everyone.

Photos: auto-downscale to ≤1400px, JPEG q0.82, before storing. Audio: cap voice notes (~60s) and warn me if `content.json` exceeds ~4MB.

---

## 8. Content I'm supplying

- **16 tracks**: seed with plausible Indonesian placeholder titles/stories so the site reads complete. I'll replace them in `/edit`.
- **100 Alasan**: seed all 100 in Indonesian. If a list is present in this directory, use it verbatim; otherwise write 100 distinct, specific, non-repetitive reasons — no filler, no near-duplicates.
- **Liner notes**: write a warm, plainspoken Indonesian love letter for a 4-month anniversary. Not flowery. Real.

All UI copy in **Indonesian**, sentence case, no exclamation-mark spam. Code, comments, and commits in English.

---

## 9. Deployment

Static-first. Target **Cloudflare Pages**:
- Framework preset **None**, no build command, output dir `/`.
- Everything must work from `file://` and from a bare static host. No bundler, no framework, no backend required.
- Vanilla HTML/CSS/JS. Google Fonts via CDN. No other dependencies.

**Optional (build it only if it doesn't compromise the static path):** a Cloudflare Pages Function at `functions/api/content.js` backed by a KV namespace, so `SAVE` in `/edit` persists server-side (`PUT` guarded by a password env var) and no commit is needed. If KV isn't bound, silently fall back to the `content.json` + `localStorage` path.

Write a short `README.md`: deploy steps, custom-domain steps, how to use `/edit`, how to publish an edit.

---

## 10. How to work

1. **Plan first.** Write a compact design plan — tokens, type scale, layout wireframe (ASCII), and the signature moment. Then critique it against §2: if any part reads like the default you'd produce for any romantic site, revise it and say what you changed.
2. **Then build.** Follow the plan exactly.
3. **Verify yourself.** Take screenshots (Playwright/headless) at 375px and 1440px. Check the console is clean. Open `#edit`, enter the passcode, confirm all four tabs render and photo upload + voice recording work. Fix what you find before telling me it's done.
4. **Then critique again.** Remove one thing that isn't earning its place.

## Done when
- [ ] Tonearm tracks scroll; record spins; both stop under `prefers-reduced-motion`.
- [ ] 16 tracks expand, deep-link, and play commentary audio.
- [ ] 100 reasons render as a credits sheet; track-of-the-day rotates daily.
- [ ] Track 17 stays locked until its date, then reveals.
- [ ] `#edit` gates on the passcode; photos and voice notes save; `EXPORT` produces a valid `content.json` that the site loads.
- [ ] Zero console errors. Clean at 360px. Prints as a proper sleeve insert.
