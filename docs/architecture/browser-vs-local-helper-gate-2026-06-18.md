# Browser vs Local Helper Gate - 2026-06-18

## Decision

Keep browser-only as the public P0 direction until the ASR benchmark manifest proves or disproves 60-minute reliability.

Do not add Tauri, a native helper, a hosted queue, accounts, API access, or paid claims before the benchmark gate is run.

## Browser-Only Stays If

- 60-minute RU, EN, and mixed RU+EN samples complete on recommended desktop-class browsers.
- A reload or interruption resumes from the first incomplete chunk.
- Export package includes `transcript.md`, `transcript.txt`, `subtitles.srt`, `subtitles.vtt`, and `qa-notes.md`.
- Quality and subtitle usefulness both reach at least `12/20` on the benchmark rubric.
- The app can honestly mark weak devices as limited or unsupported before long processing starts.

## Local Helper Starts If

- Browser ASR cannot complete 60-minute samples reliably.
- Model download, memory pressure, WebGPU/WASM gaps, or codec support make the browser path too brittle.
- Local MLX/faster-whisper/WhisperKit materially beats browser ASR while preserving the local privacy story.

## Hosted ASR Boundary

Hosted ASR may be used as a benchmark oracle or explicit opt-in fallback. It is not the default product architecture while the public value proposition is local source-media processing.

## Next Action

Run `docs/benchmarks/asr-benchmark-manifest-2026-06-18.json` in P1 and record results before changing public copy or architecture.
