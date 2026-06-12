# Browser-Local ASR Chunk Runner Benchmark - 2026-06-11

## Scope

This note records the first browser-local chunk runner evidence for the Long Video Transcriber direction. It is a stability gate, not a product-quality ASR benchmark.

## Environment

- Date: 2026-06-11
- Environment: standalone local browser app
- Browser automation: Playwright against local Nuxt dev server
- Device reported by browser page: 8 CPU threads, 16 GB memory class, WebGPU available, not cross-origin isolated
- Dev-server warning: Vite HMR WebSocket port `24678` was already in use; page still loaded and ran

## Evidence

### Unit And Build Evidence

- `pnpm check:browser-local-asr`: 9/9 tests passed
- Implemented and tested:
  - deterministic chunk runner state
  - resume checkpoint shape
  - cancel after active model call
  - failed-chunk retry
  - runner state in project snapshots
  - deterministic uncompressed ZIP archive builder
  - native browser media audio extraction gate before ASR model loading

### Browser Planner Evidence

Synthetic local WAV files were generated under ignored local artifacts:

| File | Duration | Size | Browser result |
| --- | ---: | ---: | --- |
| `silence-5m.wav` | 5m | 9.2 MB | 12 chunks, IndexedDB + OPFS checkpoint saved |
| `silence-30m.wav` | 30m | 56 MB | 72 chunks, IndexedDB + OPFS checkpoint saved |
| `silence-60m.wav` | 60m | 110 MB | 144 chunks, IndexedDB + OPFS checkpoint saved |

This proves the page can inspect long local audio files, build resumable project manifests, and persist local checkpoints without uploading source media.

### Browser ASR Smoke Evidence

`speech-smoke.wav`:

- Duration: 9.39s
- Size: 300 KB
- Adapter: `onnx-community/whisper-large-v3-turbo` through Transformers.js
- Network evidence: Hugging Face config/tokenizer/encoder/decoder requests returned 200, and ONNX Runtime WASM loaded
- Result: 1 planned chunk completed, 3 transcript segments created
- UI elapsed label: 99s
- ZIP export: `speech-smoke.zip`
- ZIP contents verified with `unzip -l`:
  - `transcript.md`
  - `transcript.txt`
  - `subtitles.srt`
  - `subtitles.vtt`
  - `qa-notes.md`

### Video Evidence

`video-smoke.mp4`:

- Duration: 5s
- Result: project manifest and one chunk were planned
- Extraction: `native-video-audio-decode` passed in Chromium through `AudioContext.decodeAudioData`

`speech-video-smoke.mp4`:

- Duration: 5.95s
- Result: video -> native audio decode -> one ASR chunk -> transcript/SRT/VTT/QA package
- UI elapsed label: 12s
- Segment count: 2
- ZIP export: `speech-video-smoke.zip`
- ZIP contents verified with `unzip -l`:
  - `transcript.md`
  - `transcript.txt`
  - `subtitles.srt`
  - `subtitles.vtt`
  - `qa-notes.md`

### Video Extraction Planner Evidence

Synthetic local MP4/AAC files were generated under ignored local artifacts:

| File | Duration | Browser result |
| --- | ---: | --- |
| `video-silence-300s.mp4` | 5m | 12 chunks, `native-video-audio-decode`, 300s decoded in 428ms |
| `video-silence-1800s.mp4` | 30m | 72 chunks, `native-video-audio-decode`, 1800s decoded in 3056ms |
| `video-silence-3600s.mp4` | 60m | 144 chunks, `native-video-audio-decode`, 3600s decoded in 5395ms |

This proves the current Chromium path can extract audio from MP4/AAC test videos locally before loading the ASR model. It does not prove every user video codec/container works.

Real local MP4 evidence:

| File class | Duration | Size | Browser result |
| --- | ---: | ---: | --- |
| Zoom MP4, H.264/AAC stereo | 22m 22s | 75 MB | 54 chunks, `native-video-audio-decode`, 1342s decoded in 2017-5899ms across two local smokes |

This real-file smoke used the extraction test only. Full ASR inference was intentionally not run on the 22-minute file because the current Transformers.js Whisper baseline is still too slow to be treated as the default long-file model.

## Decision

Do not choose a production default ASR model yet.

The current shippable layer is:

- local media inspection
- hardware gate
- project manifest
- native audio/video-audio extraction gate for browser-decodable media
- audio chunk runner
- local checkpoint persistence
- deterministic transcript/SRT/VTT/QA packaging
- browser ZIP export

The current non-shippable layer is:

- 30m/60m model inference stability
- default paid-product model selection
- broad video codec/container fallback beyond native browser decode

## Interpretation

The Transformers.js Whisper baseline is useful as a compatibility smoke test, but it is too slow to be the current default for long files. A 9.39s file taking roughly 99s in the browser is not acceptable evidence for 60-120 minute paid subtitle workflows.

The native MP4/AAC extraction path is now good enough for the next benchmark loop, but the model decision should stay deferred until one of these paths proves materially better:

- sherpa-onnx Parakeet adapter for RU+EN browser-local runs
- GigaAM RU path plus an EN path or language router
- fallback extraction for unsupported user videos through WebCodecs, ffmpeg.wasm, or a lighter demux path

## Product Wording Constraint

Public wording should stay conservative:

- say "browser-local ASR spike" or "local draft transcript package"
- do not promise production-ready long-video transcription
- do not promise production video-to-SRT quality until 30m/60m inference and real-speech quality are benchmarked

## Next Gate

Use the native extraction adapter on real speech samples, then rerun:

1. 5m video with real speech
2. 30m video with real speech
3. 60m video with real speech
4. ZIP export verification after each run
5. memory and tab-stability notes for each run

The current local evidence has a successful 22m real MP4 extraction smoke, but no completed 30m/60m real-speech ASR benchmark yet.
