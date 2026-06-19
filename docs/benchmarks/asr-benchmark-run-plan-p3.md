# ASR Benchmark Run Plan P3

P3 adds a dry-run benchmark planner. It does not call ASR providers and it does not claim benchmark results.

The planner consumes:

- the benchmark manifest;
- the sanitized corpus readiness manifest;
- the P1 benchmark matrix.

It emits assignments only when the corpus summary is `ready`. Pending or invalid corpora return no assignments and keep the benchmark blocked.

Committed run plans must store only stable ids, readiness metadata and result policy. Media locations, raw transcripts, URLs, filenames and local paths remain outside the repository.
