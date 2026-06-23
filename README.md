# Long Video Transcriber

Long Video Transcriber is a browser-local experiment for private first-pass transcripts and rough SRT/VTT export packages.

**[Open the product page](https://kikuai.dev/translator-ready-srt/)**

[Run locally](#quickstart) · [Benchmark gate](#benchmark-gate) · [Privacy boundary](#privacy-boundary)

The app accepts a user-owned audio or video file, decodes the audio in the browser, runs a local ASR adapter, checkpoints chunk progress locally, and exports a ZIP package:

- `transcript.md`
- `transcript.txt`
- `subtitles.srt`
- `subtitles.vtt`
- `qa-notes.md`

## Quickstart

```bash
npm install
npm test
npm run build
npm run dev
```

Open the Vite dev URL and choose a small local audio/video file for a smoke test. First model run can be slow because browser model assets need to download and initialize.

Expected test result:

```text
# tests 25
# pass 25
```

## Current Scope

This repository is the standalone product surface. It is intentionally separate from any website hub, telemetry endpoint, account system, billing system, or server upload path.

Current implemented layer:

- browser hardware gate;
- local media metadata inspection;
- native browser audio/video-audio decode where the browser supports the container and codec;
- chunk manifest and runner state;
- local IndexedDB/OPFS checkpoint shape;
- deterministic transcript/SRT/VTT/QA packager;
- uncompressed ZIP export;
- optional Transformers.js Whisper-family baseline loaded only after the user starts a run.

Not promised yet:

- production-ready subtitles;
- reliable speaker labels;
- broad 60-120 minute inference stability;
- every video codec/container;
- better accuracy than desktop or cloud transcription tools;
- paid workflow, accounts, API, or team features.

## Privacy Boundary

In this app, the selected source media file is read by the browser. The repository does not include a server upload endpoint.

The current ASR baseline may download model assets from the model provider when the user starts a run. Public wording should stay precise: source media is not uploaded by this app, but model files can be downloaded over the network.

## Model Candidates

The product direction is RU+EN first. Current candidates are tracked in `src/lib/asr-candidates.js`:

- `onnx-community/whisper-large-v3-turbo` through Transformers.js as the browser-compatible baseline;
- `sherpa-onnx/parakeet-tdt-0.6b-v3-int8` as the RU+EN multilingual benchmark candidate;
- GigaAM Russian as the RU quality research lane.

Model licenses and attribution must be reviewed before any paid packaging.

## Benchmark Gate

Before treating this as a paid product, collect evidence for:

- RU, EN, and mixed RU+EN samples;
- 5, 30, and 60 minute real-speech files;
- real-time factor by hardware class;
- memory and tab stability;
- reload/resume behavior;
- transcript quality;
- SRT/VTT usefulness;
- failure messages for unsupported files.

## License

Code is MIT. Third-party model licenses are separate and must be respected.
