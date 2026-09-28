# M3 measured cost decision

Boundary `c1f4baf48a5d07b6d8c166c4434070267c427c36`; unchanged authenticated World kernel.

All 24 admission comparisons, 36 native fresh-invocation comparisons and 36 WASM fresh-invocation comparisons have no confirmed slowdown. The current 89-byte PRE witness passes all 14 timing comparisons; its old 92-byte cost question is superseded. The unchanged 193-byte callable witness retains its previously measured +2.44 µs / 6.8% WASM fresh cost, still awaiting acceptance.

The native zero-baseline timer-floor case was measured again with 256 sessions per sample: +0.15 ns / 0.7%, not confirmed. Original samples are preserved. Thirteen other phase comparisons confirm increases:

| Engine | Control | Scenario / boundary | Phase | Paired median increase | Ratio |
| --- | --- | --- | --- | ---: | ---: |
| native | m25 | react-rejects-subject / 0002 | checkpointNs | 0.084 µs | +8.4% |
| native | c0 | consequence-common / 0008 | startOrRestoreNs | 17.792 µs | +8.1% |
| wasm | m25 | paired-rebinding-inquiry / 0020 | checkpointNs | 1.834 µs | +11.5% |
| wasm | m25 | paired-rebinding-inquiry / 0022 | checkpointNs | 0.916 µs | +12.8% |
| wasm | m25 | paired-reset-react / 0002 | checkpointNs | 2.750 µs | +10.8% |
| wasm | m25 | paired-reset-react / 0004 | checkpointNs | 1.708 µs | +6.2% |
| wasm | m25 | consequence-common / 0013 | executionAndOutcomeNs | 28.709 µs | +52.2% |
| wasm | m25 | document-amendment-two-turn-conversation / 0013 | checkpointNs | 1.000 µs | +6.0% |
| wasm | m25 | document-amendment-two-turn-conversation / 0015 | executionAndOutcomeNs | 2.874 µs | +7.4% |
| wasm | c0 | paired-rebinding-inquiry / 0021 | startOrRestoreNs | 20.416 µs | +6.5% |
| wasm | c0 | paired-rebinding-react / 0009 | checkpointNs | 4.500 µs | +10.7% |
| wasm | c0 | paired-reset-inquiry / 0021 | startOrRestoreNs | 22.084 µs | +6.9% |
| wasm | c0 | consequence-common / 0013 | startOrRestoreNs | 74.208 µs | +25.3% |

## Memory and retained behavior

Local admission and measured execution-memory changes versus M2.5 are within the supplied thresholds; checkpoint maxima do not grow. Six cumulative execution-memory comparisons exceed the pre-cutover threshold. They already appear in M2.5 and are slightly reduced here: consequence native peak +7,780 bytes (~1.3%); document native peak up to +21,972 bytes (~5.8%); document WASM peak up to +9,332 bytes (~3.5%). These newly measured cumulative cells are not silently covered by the earlier admission-memory acceptance.

Canonical behavior agrees across 201 recorded boundaries. Final package integration passes 411 steps / 202 Zig tests and Chromium/Firefox transfer/cleanup. No correctness or authority exception is proposed.

§9.5 requires acceptance or correction of the remaining measured tradeoffs. Raw samples and exact identities are retained in `../conformance/agent4/m3-economics.json` and the accompanying compressed sample file. This decision does not accept later M4–M8 costs.
