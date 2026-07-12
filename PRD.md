# PRD — "Side A"
### A monthsversary record · Yukisnow Corp. · Catalog no. YS-004

**Owner:** Evan
**Audience of one:** Sabil
**Companion doc:** `PROMPT.md` (the build brief for Claude Code). This PRD is the contract; `PROMPT.md` is the creative direction. Where they disagree, this document wins on *behavior*, `PROMPT.md` wins on *design*.

---

## 1. Context

Every month I build her a site. The last three were pretty but interchangeable — the same romantic template with a different date on it. The 4th one has to be a thing she remembers, and it has to be something I can keep updating for months without rebuilding.

So this release does two jobs at once:

1. **A gift** that doesn't read as a template.
2. **A platform** — one codebase I re-press every month with new content, new photos, new voice notes, no code changes.

The concept: **the site is a vinyl record.** 16 memories are 16 tracks, days together are the runtime, the letter is the liner notes, the 100 reasons are the credits sheet, the time capsule is a hidden track. See `PROMPT.md` §1.

---

## 2. Goals

| # | Goal | How we know it worked |
|---|---|---|
| G1 | She feels seen, not marketed to | She sends it to someone. She opens it again on a different day. |
| G2 | It does not look AI-generated or templated | Nothing from the anti-brief (`PROMPT.md` §2) appears in the build |
| G3 | I can update everything without touching code | I add a photo + a voice note + edit a track in under 3 minutes, from my phone |
| G4 | It stays live and cheap forever | $0/month on Cloudflare, no server to maintain |
| G5 | Reusable next month | Month 5 = change content, bump the catalog no., re-deploy |

## 3. Non-goals

- Public discovery, SEO, analytics, sharing cards. This has **one** reader.
- Accounts, multi-user, comments, real-time anything.
- A CMS. The editor is a single-purpose tool, not a product.
- Mobile app, PWA, offline mode.
- Real security. See §10 — the threat model is "nobody is attacking this."

---

## 4. Users

**Evan (author, admin).** Uses `/edit` on desktop and phone. Wants: fast content entry, photo upload that doesn't need resizing first, voice recording in-browser, and a publish step that is one action.

**Sabil (reader).** Opens a link on an Android phone, on mobile data, probably at night. Wants: it loads, it's beautiful, it's about her. She will never see `/edit` and must never be able to break anything.

---

## 5. Functional requirements

Priority: **P0** = ship-blocking · **P1** = should have · **P2** = if time.

### 5.1 The record (reader-facing)

| ID | Requirement | P |
|---|---|---|
| F-01 | **Sleeve/hero** shows artists (both names), album title, catalog no., and **total runtime** derived live from `start_date` (`04:29` = 4 months, 29 days) | P0 |
| F-02 | **Turntable signature**: record spins; **tonearm position = scroll progress**; grooves = one ring per month together | P0 |
| F-03 | **Tracklist of 16**, mono-set, each expandable in place into a liner-note spread (photo, date, story) | P0 |
| F-04 | Tracks are **deep-linkable** (`#/track/07`) and keyboard-navigable (↑↓, Enter, Esc) | P1 |
| F-05 | **Commentary note** — a voice recording plays inside an expanded track, if one exists | P0 |
| F-06 | **Liner notes** — the letter, revealed in sequence, set as a printed insert | P0 |
| F-07 | **Credits sheet** — 100 reasons, numbered `001`–`100`, two dense columns | P0 |
| F-08 | **Track of the day** — one reason surfaced, deterministic from the date, rotates daily | P0 |
| F-09 | **Shuffle** — pull a random reason; **Filter** — search the 100 | P1 |
| F-10 | **Hidden Track 17** — shows `[UNRELEASED]` + countdown; unlocks on `unlock_date`, then reveals the message | P0 |
| F-11 | **Now-playing bar** — persistent; plays the real song; play/pause; record spin syncs to playback | P1 |
| F-12 | **Back cover** — countdown to the next monthsversary ("next pressing"), credits, footer | P0 |
| F-13 | **Print stylesheet** — `Cmd+P` produces a proper sleeve insert (tracklist + liner notes + credits) | P2 |

### 5.2 The mixing desk (`/edit`)

| ID | Requirement | P |
|---|---|---|
| E-01 | Reached at **`#edit`** — a hash route, so it needs zero server routing and works on any custom domain | P0 |
| E-02 | **Passcode gate** before any editor UI renders | P0 |
| E-03 | Tab **Master**: names, album title, catalog no., `start_date`, song upload, liner notes, closing, footer, passcode | P0 |
| E-04 | Tab **Tracks**: per track — title, date, story, **photo upload**, **voice recorder** (record / play / re-record / delete, with duration); reorder ↑↓; add; delete | P0 |
| E-05 | Tab **Credits**: the 100 — edit, reorder, add, delete, **bulk paste** (newline-separated) | P0 |
| E-06 | Tab **Hidden Track**: unlock date + secret message | P0 |
| E-07 | **`SAVE`** → persists (localStorage in Mode A; KV in Mode B). Instant preview. | P0 |
| E-08 | **`EXPORT`** → downloads a valid `content.json` | P0 |
| E-09 | **Photo pipeline**: auto-downscale ≤1400px, JPEG q0.82, before storing | P0 |
| E-10 | **Audio pipeline**: MediaRecorder; cap voice notes ~60s; warn if total payload > 4MB | P0 |
| E-11 | Editor is fully usable on a **phone** | P1 |

---

## 6. Content model

One object. Defaults are baked into the JS, so the site is **never blank and never depends on a backend**.

```jsonc
{
  "passcode": "salju2026",
  "catalog_no": "YS-004",
  "artist_a": "…", "artist_b": "…",
  "album_title": "…",
  "start_date": "YYYY-MM-DD",      // drives runtime, grooves, all countdowns
  "song_url": "",                   // path or data URL
  "liner_notes": "…",               // \n\n-separated paragraphs
  "tracks": [                       // 16 by default
    { "n": 1, "title": "", "date": "", "story": "",
      "photo": "", "commentary": "" }   // data URLs
  ],
  "hidden_track": { "unlock_date": "", "message": "" },
  "reasons": ["…"],                 // exactly 100
  "closing": "…", "footer": "…"
}
```

**Load order (strict):**

```
built-in DEFAULTS
   ↓ deep-merge
content.json          (published — everyone sees this)
   ↓ deep-merge
KV via /api/content   (Mode B only — everyone sees this)
   ↓ deep-merge
localStorage          (my device only — preview before publishing)
```

Any layer failing must be silent and non-fatal. A dead network still renders a complete site.

---

## 7. Architecture

Vanilla HTML/CSS/JS. **No framework, no bundler, no build step.** The single hardest requirement: `index.html` must run correctly from `file://`.

```
/
├── index.html          # the whole site + the editor
├── content.json        # published content (optional; site works without it)
├── audio/              # song file(s)
├── functions/
│   └── api/
│       └── content.js  # Mode B only — Cloudflare Pages Function
├── wrangler.toml       # Mode B only — KV binding
├── README.md
└── PROMPT.md / PRD.md
```

**Two hosting modes. Mode A must work standalone; Mode B is layered on top and must degrade to Mode A if its bindings are absent.**

---

## 8. Deployment — Cloudflare

### Mode A · Static Pages (default, ship this first)

**Path 1 — direct upload (fastest, no Git):**
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Drag the project folder in. Deploy.
3. You get `side-a.pages.dev`.

**Path 2 — Git (auto-deploy on push, recommended):**
1. Push the repo to GitHub.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick the repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(empty)*
   - Build output directory: **`/`**
4. Deploy. Every `git push` re-deploys in ~30s.

**No `_redirects` and no env vars are needed** — `#edit` is a hash route, so static hosting serves it natively. This is precisely why we chose a hash route.

**Custom domain:**
1. Pages project → **Custom domains** → **Set up a domain**.
2. Enter the domain. If the zone is on Cloudflare, the `CNAME` is created automatically; otherwise point `CNAME → <project>.pages.dev` at your registrar.
3. TLS provisions automatically. Then `yourdomain.com` and `yourdomain.com/#edit` both work with **zero extra config**.

**Publishing an edit (Mode A loop):**
```
open  yourdomain.com/#edit
  → make changes → EXPORT → content.json downloads
  → replace content.json in the repo → git push
  → live in ~30s
```

**Caching:** add a `_headers` file so `content.json` is never stale:
```
/content.json
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/audio/*
  Cache-Control: public, max-age=31536000, immutable
```

### Mode B · Pages Functions + KV (optional — `SAVE` publishes for real)

Removes the export-and-commit step: `SAVE` in `/edit` writes straight to KV and it's live for her immediately.

1. Create a KV namespace: `wrangler kv namespace create CONTENT`
2. Bind it — `wrangler.toml`:
   ```toml
   name = "side-a"
   pages_build_output_dir = "."

   [[kv_namespaces]]
   binding = "CONTENT"
   id = "<namespace_id>"
   ```
3. `functions/api/content.js`:
   - `GET  /api/content` → returns the stored JSON (or `404`, which the client treats as "fall back to content.json").
   - `PUT  /api/content` → validates `Authorization: Bearer <token>` against the **`EDIT_TOKEN`** secret, then writes.
4. Set the secret (dashboard → Settings → Environment variables → **Encrypt**), or:
   `wrangler pages secret put EDIT_TOKEN`
5. Client: on `SAVE`, `PUT` to `/api/content`. On any non-2xx (including a missing binding), fall back to `localStorage` and tell me plainly: *"Tersimpan di perangkat ini. Gagal terbit — gunakan EXPORT."*

**Photos in Mode B:** if `content.json` approaches the KV 25MB value limit, move photos to **R2** — bind a bucket, `PUT` each image, store the public URL in the content object instead of a data URL. Only do this if the payload actually demands it (P2).

---

## 9. Non-functional requirements

| ID | Requirement |
|---|---|
| N-01 | **Mobile-first.** Correct from **360px** up. She's on a phone. |
| N-02 | First contentful paint < 2s on a throttled 4G connection |
| N-03 | Total transfer for the reader < 5MB (photos are the budget — enforce the downscale) |
| N-04 | **`prefers-reduced-motion` fully respected**: record stops spinning, reveals become instant |
| N-05 | Keyboard-navigable with visible focus; semantic HTML; alt text on every photo |
| N-06 | **Zero console errors** in the shipped build |
| N-07 | Site renders completely with JS-fetched content unavailable (defaults must carry it) |
| N-08 | Works on iOS Safari and Android Chrome, current versions |
| N-09 | All UI copy in **Indonesian**, sentence case. Code, comments, commits in **English**. |

---

## 10. Security model — stated honestly

**The passcode on `/edit` is obscurity, not security.** In Mode A it lives in client-side JS; anyone who views source can read it. That is **acceptable and by design**, because:

- The reader is one person who will not view source.
- Even if someone did open `/edit` in Mode A, `SAVE` only writes to **their own** `localStorage`. They cannot change what anyone else sees. Publishing requires commit access to the repo.

**Mode B changes this**, and the change is not optional: once a `PUT` endpoint can mutate what everyone sees, auth must be **server-side**. The `EDIT_TOKEN` lives as an encrypted Cloudflare secret and is checked in the Function. Never ship a Mode B write path guarded only by the client-side passcode.

Do not put anything in this site you'd be unwilling to have on a public URL. `*.pages.dev` is public and unlisted, not private.

---

## 11. Build phases

| Phase | Deliverable | Gate |
|---|---|---|
| **0 · Design plan** | Tokens, type scale, ASCII wireframe, the signature moment. Self-critique against the anti-brief; state what changed and why. | Nothing generic survives |
| **1 · Skeleton** | `index.html`, content model, defaults, all 100 reasons + 16 track stubs, load-order logic | Renders complete with no network |
| **2 · The record** | Sleeve, turntable, tonearm-as-scrollbar, tracklist | The signature works and it's the best thing on the page |
| **3 · Content sections** | Liner notes, credits sheet, track of the day, hidden track, back cover | All P0 reader features |
| **4 · Mixing desk** | `#edit`: gate + 4 tabs, photo pipeline, voice recorder, SAVE, EXPORT | I can round-trip content without touching code |
| **5 · Verify** | Playwright screenshots @375px and @1440px, console clean, editor round-trip tested | §12 passes |
| **6 · Ship** | Cloudflare Pages (Mode A) + custom domain + `README.md` | Live on the domain |
| **7 · Optional** | Mode B (Functions + KV), print stylesheet | Only if it doesn't weaken Mode A |

---

## 12. Acceptance tests

Run these before calling it done.

**Reader**
- [ ] Load on a cold cache at 375px. No console errors. No horizontal scroll.
- [ ] Runtime counter matches the real elapsed time from `start_date`.
- [ ] Tonearm advances across the record as I scroll; record spins; both freeze under `prefers-reduced-motion`.
- [ ] All 16 tracks open, close, deep-link (`#/track/07` loads that track open), and play commentary audio where present.
- [ ] Reasons render `001`–`100`. Track of the day is stable within a day and **different tomorrow** (verify by faking the clock).
- [ ] Track 17 reads `[UNRELEASED]` with a live countdown; set the unlock date to yesterday → it reveals the message.
- [ ] Every photo has meaningful alt text. Tab through the whole page; focus is always visible.

**Editor**
- [ ] `#edit` shows only the gate. Wrong passcode → error, no editor. Correct → four tabs.
- [ ] Upload a 12MP photo → stored ≤1400px wide; the page still loads fast.
- [ ] Record a voice note → it plays back in the editor and inside the expanded track on the site.
- [ ] `SAVE` → reload the site → changes persist.
- [ ] `EXPORT` → drop the `content.json` next to `index.html` → **open in a clean browser profile** → the changes appear there too.
- [ ] Do all of the above **on a phone**.

**Deploy**
- [ ] Live on `*.pages.dev`, then on the custom domain.
- [ ] `yourdomain.com/#edit` works on the custom domain with no extra config.
- [ ] Push a `content.json` change → live within a minute.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Base64 photos + audio bloat `content.json` past what's sane to load | Hard downscale, 60s audio cap, warn above 4MB, R2 escape hatch (§8) |
| `MediaRecorder` codec differences (Safari records `mp4`, Chrome `webm`) | Feature-detect, pick a supported `mimeType`, store the type alongside the blob; if unsupported, hide the recorder rather than break |
| iOS blocks audio autoplay | Never autoplay. The play button is the only entry point — which is also the honest design. |
| The build drifts back into the romantic template | Phase 0 gate; the anti-brief in `PROMPT.md` §2 is a hard rejection list |
| Concept over-delivers on cleverness, under-delivers on feeling | The letter, the stories, and the voice notes carry the emotion. Design stays cool. If a section is only clever, cut it. |

---

## 14. Next pressing

Month 5 is a content change, not a code change: new tracks, new commentary, new liner notes, bump to `YS-005`, move the hidden track's unlock date forward. If that isn't true when this is done, it isn't done.
