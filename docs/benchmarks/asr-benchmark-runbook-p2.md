# ASR Benchmark Runbook - P2

This runbook is a readiness contract, not benchmark evidence.

## Before Any Run

1. Fill the corpus manifest with approved sample ids only.
2. Keep media files outside the repository.
3. Do not store local paths, media URLs, raw transcripts, file names or speaker identities in committed artifacts.
4. Mark every sample `consentStatus: "approved"` only after the source is approved for local benchmark use.
5. Mark every sample `transcriptOracleStatus: "ready"` only after the quality rubric can score omissions, language handling, timestamps and subtitle usefulness without storing raw transcript text.

## Run Boundary

- Browser-local candidates may run against local media after the corpus manifest is ready.
- Hosted ASR remains an explicit opt-in oracle and needs a separate approval before any media leaves the device.
- Ledger records may store scores, timings, failure codes and sanitized notes only.

## Exit To Provider Choice

Provider selection is blocked until:

- `summarizeCorpusReadiness(...)` returns `ready`;
- the benchmark ledger covers every required adapter x required sample case;
- export package files exist for every successful row;
- failures are recorded with allowed failure codes instead of being dropped.
