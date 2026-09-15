# Vendored: MediaPipe Tasks Vision

Copied here so the photobox cut-out never depends on a CDN at runtime.

- `@mediapipe/tasks-vision` 1.0.1 (npm), Apache License 2.0, Copyright Google LLC:
  `vision_bundle.mjs`, `wasm/vision_wasm_internal.{js,wasm}`, `wasm/vision_wasm_nosimd_internal.{js,wasm}`
  (the loader picks the SIMD or no-SIMD pair).
- `selfie_segmenter.tflite`, float16, from storage.googleapis.com/mediapipe-models (Apache 2.0).

Update by `npm pack @mediapipe/tasks-vision@<version>` and copying the same files.
