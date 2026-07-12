# Side A — a monthsversary record

A single-page site that *is* a vinyl record: 16 memories are 16 tracks, the days
together are the runtime, the love letter is the liner notes, the 100 reasons are
the credits sheet, and the time capsule is a hidden Track 17. Catalog no. **YS-004**.

Built as a **gift** and a **platform** — next month you change the content, bump the
catalog number, and re-deploy. No code changes.

- **Stack:** vanilla HTML/CSS/JS. No framework, no bundler, no build step.
- **Runs anywhere:** works from `file://`, any static host, and Cloudflare Pages.
- **Editor:** a hidden, passcode-gated "mixing desk" at `#edit`.

---

## Run it locally

Just open `index.html` in a browser — it works from `file://`.

For the full experience (voice recording needs a secure context), serve it:

```bash
npx serve .
# or
python -m http.server 8080
```

Then visit `http://localhost:8080`.

> Voice-note **recording** needs `https` or `localhost` (browser rule). Playing an
> existing voice note works everywhere, including `file://`.

---

## Content lives in one object

Everything the site shows comes from a single content object. Load order (each layer
deep-merges over the previous, and any failure is silent):

```
built-in defaults (assets/js/data.js)   ← the site is never blank
        ↓
content.json                            ← the published content everyone sees
        ↓
KV via /api/content                     ← Mode B only (optional)
        ↓
localStorage                            ← your device only (preview before publishing)
```

So the site renders completely even with no network.

---

## The editor — `#edit`

1. Open `yourdomain.com/#edit` (works on any host — it's a hash route).
2. Enter the passcode. Default: **`salju2026`** (change it in Master).
3. Four tabs:
   - **Master** — names, album title, catalog no., start date, song upload, liner
     notes, closing, footer, passcode.
   - **Tracks** — per track: title, date, story, **photo upload**, **voice recorder**
     (record / play / re-record / delete), reorder, add, delete.
   - **Kredit** — the 100 reasons: edit, reorder, add, delete, bulk paste.
   - **Rahasia** — hidden Track 17: unlock date + secret message.
4. Two actions:
   - **SAVE** → writes to `localStorage` (instant preview on this device). In Mode B,
     also publishes to KV if a token is set.
   - **EXPORT** → downloads a fresh `content.json` to commit.

Photos are auto-downscaled to ≤1400px @ JPEG q0.82. Voice notes are capped at ~60s.
You'll get a warning if the content passes ~4MB.

---

## Publish an edit (Mode A — the default loop)

```
open  yourdomain.com/#edit
  → make changes → EXPORT → content.json downloads
  → replace content.json in the repo → git commit && git push
  → live in ~30s
```

---

## Deploy to Cloudflare Pages (Mode A)

**Connect to Git (auto-deploys on every push):**

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → pick the repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`/`**
4. **Save and Deploy.** You get `side-a.pages.dev`. Every `git push` re-deploys.

No `_redirects` and no env vars are needed for Mode A — `#edit` is a hash route, so
static hosting serves it natively.

**Custom domain:** Pages project → **Custom domains** → **Set up a domain** → enter it.
If the zone is on Cloudflare the record is created for you; otherwise point
`CNAME → <project>.pages.dev`. TLS provisions automatically. Then `yourdomain.com` and
`yourdomain.com/#edit` both work with zero extra config.

---

## Deploy — Mode B (optional: SAVE publishes for everyone)

Removes the export-and-commit step. Only do this if you want it; Mode A is complete.

1. Create a KV namespace:
   ```bash
   npx wrangler kv namespace create CONTENT
   ```
2. In `wrangler.toml`, uncomment the `[[kv_namespaces]]` block and paste the `id`.
3. Set the write password as an **encrypted secret**:
   ```bash
   npx wrangler pages secret put EDIT_TOKEN
   ```
   (or dashboard → Settings → Environment variables → add `EDIT_TOKEN`, Encrypt).
4. In `#edit` → **Master** → "Token terbit (KV)", paste the same value. It is stored
   only on your device, never in `content.json`.
5. Now **SAVE** in the editor writes straight to KV via `PUT /api/content`
   (auth checked server-side). If anything fails, it falls back to localStorage and
   tells you to use EXPORT.

Security note: the `#edit` passcode is **obscurity, not security** — in Mode A it's in
client JS. That's fine: SAVE in Mode A only writes to *your* browser; publishing needs
repo access. Mode B writes are gated by the server-side `EDIT_TOKEN`, never the passcode.
Don't put anything here you wouldn't want on a public URL — `*.pages.dev` is public.

---

## Add the song

Drop an audio file at `audio/side-a.mp3` and set `song_url` to `"audio/side-a.mp3"`
(in `#edit` → Master, or directly in `content.json`). Or upload it in the editor.

---

## Next pressing (Month 5)

It's a content change, not a code change:

- new tracks, new commentary, new liner notes,
- bump `catalog_no` to `YS-005`,
- move the hidden track's unlock date forward.

Change it in `#edit`, EXPORT, commit. Done.

---

## Project layout

```
index.html            the whole site + the editor
content.json          published content (optional; site works without it)
assets/css/style.css  the two-ink risograph design system
assets/js/data.js     built-in defaults (16 tracks, 100 reasons, the letter)
assets/js/app.js       reader + editor logic
audio/                the song
functions/api/content.js   Mode B API (safe to keep; 404s without KV)
wrangler.toml         Cloudflare config (Mode B is commented out)
_headers              caching rules
```
