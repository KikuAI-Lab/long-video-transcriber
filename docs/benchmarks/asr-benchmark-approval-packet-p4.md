# ASR Benchmark Approval Packet P4

P4 adds an operator approval packet for future Long Video ASR benchmark runs. It does not call ASR providers and it does not produce benchmark scores.

The approval packet records:

- sanitized sample ids;
- pending or approved consent status;
- pending or ready transcript-oracle status;
- required human actions before execution;
- whether the dry-run benchmark plan can be executed.

Committed approval packets must not contain media locations, source URLs, filenames, local paths, raw transcripts or provider output. A `ready` approval packet only means the operator can run the benchmark and write sanitized ledger rows. It is not benchmark evidence by itself.
