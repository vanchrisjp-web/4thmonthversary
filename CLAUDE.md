## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Photobox studio (added for YS-006, 15 Sep)

The strip is `assets/js/bingkai.js`: `plan()` is the layout, `draw()` is the frame, and the live
preview, the cards and the printed strip all use them. Run `node bingkai.test.mjs` before every
deploy. The 4th's and 5th's doors start in the classic Sisi A strip. Its default gap is 14 px, so
a side-by-side is 1116x500, not 1120x500; the test checks that the old gaps still give the old
sizes exactly.

- `?press=` sets the stamp and the starting frame (`006` → Ladang Bunga).
- `?from=` and `?fromname=` set the way back.
- `?song=` sets the music: an https mp3 on `*.vanchrisjp.workers.dev` only.
- Studio choices sync to the other booth as `{t:"studio"}`, and the newer wins.
- The frame stays editable after a shot and is sent again with a `gen`.
- Signaling and media (`photobox.js` above "capture") were not touched.
- Local QA: `CI=true npx wrangler dev --local --persist-to <folder outside this repo>`.
- Never save test strips to the live album; the 5th's wall and the 6th's Bilik Foto show every
  one.

## Green screen (15 Sep)

- Wallpapers and the mask arithmetic are `assets/js/latar.js`; run `node latar.test.mjs`.
  `bingkai.js` builds the wallpaper, the cut-out and the look in a layer (`env.layer`,
  `env.wall`).
- The "Satu tempat" layout (`bareng`) stands both of you in one scene. Sizes are per person
  (`besarH`, `besarG`), not per side.
- The cutter is MediaPipe's selfie segmenter, vendored in `assets/vendor/mediapipe` (never a CDN).
  It loads only when a wallpaper is chosen, and "Layar hijau beneran" keys real green instead.
- Never put `autoplay` back on the booth's `<video>`s. Chrome pauses muted autoplay video that is
  scrolled out of view, and the preview, the cut-out and the shutter read from it;
  `keepPlaying()` starts them from script.
- A wallpaper photo of your own travels to the other booth as `{t:"wall"}` chunks, in the same
  queue as strips.
