# Mobility measurements

The local reference workload reads a 42-byte, four-newline file in three chunks,
retains a child and cleanup marker, and presents the result. The moving variants
complete A→B→A (epochs 0→1→2); stationary execution has the same capabilities
and SQLite durability locally. No paid provider or production credential is used.
The [raw observations](../conformance/agent4/mobility-measurements.json) include
640 samples, artifact/input identities, phase timings, browser observations and
fresh-process recovery. These are bounded local measurements, not WAN estimates.

The platform was Apple M2 Pro, Darwin 27.2 arm64, local APFS, Node 26.10.0,
SQLite 3.53.4 and Zig 0.16.0. Boundary `65f46131f366bdd21aa98701f4110ecb801d2c8d`
and World `a48d5fd0cb2d4fcbe79bc3188f354d7d036d29f5` are unchanged. The kernel is
`9627eb1e66239119bccb4ddcd43b4f6c757180dab930a9feb276671262f735d1`; the verified
runtime inventory is `d96a01edd4bbfa22ab1d1540f5eb7b2d29f1c350e424012c4d33d19fbd5fba86`.
The historical baseline and candidate sets came from the explicitly dirty `73f449f` worktree while
constructing this harness. The baseline uses that commit's preflight behavior;
the candidate reuses immutable encoding within each preflight call. Actual image
and complete synthetic task-reply hashes are recorded per sample; these results
do not claim emission from another committed tree.

## Matched comparisons

Each cell below is the median of ten separate Node processes. Modes rotate within
each repetition. Provisioning TLS, keys and journals is excluded; World startup
is included. Runtime verification and reading kernel bytes precede the timer;
network acquisition of the runtime bundle is not measured. Cold includes first
Kernel creation/preparation and uncached destination-image delivery, with no
priming run. Warm follows an unmeasured identical run in
the same process, caching the image/kernel path. It still creates and completes a
new run. `R` is the number of immediate requirements (1 or the default maximum 16).

Manual portability restores actual continuations but has no journal or peer
protocol. Fixed uses authored destinations with the same durable custody protocol.
Ensure discovers/selects destinations in the program. Stationary uses `Here` with
matching local bindings and durable per-effect publication. Manual's delta cannot
be interpreted as pure runtime overhead for the durable modes.

| Mode | Cache | R | Baseline total ms | Candidate total ms | Candidate first read ms |
|---|---|---:|---:|---:|---:|
| manual | cold | 1 | 45.582 | 44.505 | 27.521 |
| manual | cold | 16 | 113.461 | 60.217 | 45.577 |
| manual | warm | 1 | 20.713 | 19.850 | 8.744 |
| manual | warm | 16 | 65.914 | 31.596 | 19.563 |
| fixed | cold | 1 | 499.704 | 502.871 | 204.141 |
| fixed | cold | 16 | 687.302 | 565.958 | 276.245 |
| fixed | warm | 1 | 472.013 | 455.022 | 169.770 |
| fixed | warm | 16 | 591.006 | 496.819 | 217.476 |
| ensure | cold | 1 | 577.499 | 563.033 | 244.384 |
| ensure | cold | 16 | 803.271 | 636.574 | 313.306 |
| ensure | warm | 1 | 551.740 | 553.987 | 220.425 |
| ensure | warm | 16 | 695.285 | 571.961 | 245.703 |
| stationary | cold | 1 | 359.028 | 356.804 | 117.264 |
| stationary | cold | 16 | 357.343 | 329.801 | 122.026 |
| stationary | warm | 1 | 427.160 | 437.829 | 117.256 |
| stationary | warm | 16 | 372.468 | 365.948 | 113.194 |

Preflight previously re-encoded the same binding metadata for each requested
requirement. Call-local lazy reuse reduces a focused warm R16 ensure
preflight sample from 157.629 to 46.211 ms. Across the matched end-to-end samples,
ensure R16 improves 20.75% cold and 17.74% warm. R1 variability overlaps; there is
no precise R1 improvement claim. Unfavorable medians remain visible: fixed cold R1,
ensure warm R1 and stationary warm R1 increased. The last increased 2.50%; this
study does not establish its cause. Warm stationary can be slower than cold;
priming and filesystem scheduling affect these short local runs. Observed p95 is
provided in the raw file, but ten observations do not estimate service tails.

## Bytes, memory and durability cost

The ensure/manual image is 4,421 bytes; fixed is 2,661 bytes. Largest moved PST3
state grows from 1,268 to 8,396 bytes for ensure and from 1,083 to 8,211 for fixed
as R grows from 1 to 16. It is not constant-size migration. The following byte
counts include application artifact bodies and protocol metadata across both
moves; HTTP framing and TLS overhead are excluded. Warm moves upload no image.

| Mode | R | Cold / warm application bytes | Cold / warm commits | Peak World working bytes |
|---|---:|---:|---:|---:|
| fixed | 1 | 38,306 / 29,946 | 42 / 41 | 121,566 |
| fixed | 16 | 62,599 / 50,013 | 42 / 41 | 140,202 |
| ensure | 1 | 44,074 / 33,953 | 48 / 47 | 177,978 |
| ensure | 16 | 71,535 / 57,188 | 48 / 47 | 188,973 |
| stationary | 1 | 0 / 0 | 33 / 33 | 167,405 |
| stationary | 16 | 0 / 0 | 33 / 33 | 182,933 |

Manual counts only image/outcome copies: 7,397 / 2,976 bytes at R1 and
16,901 / 12,480 at R16. These are not TLS-protocol equivalents. All memory peaks
are sampled after every public Kernel call before reset/teardown. Maximum live
World working memory is 150,023 bytes for ensure R16 and 102,042 for fixed R16;
maximum single-instance WASM linear memory is 1,179,648 bytes. Process RSS and
aggregate simultaneous-instance memory are not represented by that number.

For warm R16 ensure, median separate encode/restore probes are 0.037 / 0.293 ms;
fixed is 0.033 / 0.157 ms. Median sums of the two freeze transactions are
19.186 / 19.907 ms (ensure/fixed). Median sums of SQLite COMMIT spans are
385.461 / 329.537 ms. A parked-admission span has median 14.440 / 14.108 ms.
These spans overlap; adding them does not produce an exclusive CPU profile.
Encoding probes are outside task latency. Required durable commits remain a
major measured cost; this optimization removes repeated preflight encoding
without weakening publication or recovery boundaries.

Structural checks assert resident reuse, zero live working allocations at close,
zero stationary peer bytes, warm image-cache hits, bounded memory, exact results,
and physical retirement. They impose no noisy wall-clock threshold. Metadata
contains current requirements/transfer identities rather than a copied transcript;
receipt history remains in SQLite, outside PST3.

## Browser and recovery

The extracted-package browser witness uses actual mTLS and a separate Node data
process. Worker A1 terminates before delivery; the data process exits before fresh
Worker A2 resumes. Both engines preserve the child/cleanup capture and return
42 bytes/four newlines. One observation per engine gives:

| Engine | A1 attach through terminal A2 ms | Mirrored successor publication ms | Executor commands ms |
|---|---:|---:|---:|
| Chromium 153.0.8010.12 | 921.672 | 63.799 | 133.229 |
| Firefox 155.0 | 924.911 | 66.491 | 123.670 |

Publication includes durable commit. Totals exclude browser launch/provisioning
but include test orchestration, the 250 ms CLI pump and 50 ms return polling.
These single observations are not browser latency distributions or isolated
kernel timings. Both use the same authenticated kernel as Node. Authority and
privacy negatives run separately; see the [acceptance matrix](mobility-acceptance.md).

Five fresh Node processes recover accepted custody after the original data process
has exited. They import extracted production modules, verify the runtime, open
SQLite, restore World, consume the saved arrival and publish the next READY read
without redispatching a leaf. Median internal time is 64.313 ms; median process
start-to-exit is 171.590 ms (range 170.255–173.130). This tests process recovery on
local APFS with SQLite EXTRA, not power loss or backup rollback.

## Post-review repair measurements

The repaired implementation was measured again with ten processes per cell
(160 additional samples), on the same dependency tuple and platform. The raw
`post_review_repairs` section records the dirty `cd6856d` source observation and
SHA-256 identities of the actual runtime and harness files. The preceding tables
retain the earlier optimization study; this follow-up measures the repaired code.
No causal speedup is inferred from comparing these separate sessions.

| Mode | Cache | R | Total median ms | First read median ms | Commits |
|---|---|---:|---:|---:|---:|
| manual | cold | 1 | 44.990 | 27.167 | 0 |
| manual | cold | 16 | 57.143 | 41.376 | 0 |
| manual | warm | 1 | 20.367 | 8.723 | 0 |
| manual | warm | 16 | 33.437 | 20.815 | 0 |
| fixed | cold | 1 | 483.323 | 197.490 | 41 |
| fixed | cold | 16 | 544.062 | 277.205 | 41 |
| fixed | warm | 1 | 418.946 | 151.771 | 40 |
| fixed | warm | 16 | 470.862 | 194.468 | 40 |
| ensure | cold | 1 | 548.789 | 233.259 | 47 |
| ensure | cold | 16 | 613.845 | 314.351 | 47 |
| ensure | warm | 1 | 518.966 | 184.498 | 46 |
| ensure | warm | 16 | 556.011 | 233.776 | 46 |
| stationary | cold | 1 | 330.088 | 103.938 | 32 |
| stationary | cold | 16 | 308.413 | 106.868 | 32 |
| stationary | warm | 1 | 405.154 | 103.074 | 32 |
| stationary | warm | 16 | 332.637 | 99.509 | 32 |

Registration and initial policy admission now commit atomically, removing one
transaction per run. The existing reconstruction and working-memory guards are
unchanged and passed for every sample. Artifact sizes, network-byte accounting
and peak working-memory bounds remain as in the earlier study. The harness
records artifacts from actual delivery instead of separately admitting an
envelope for observation; the first qualification attempt detected those extra
restores, and its failure was retained before correcting the observation path.

Fresh browser observations were chromium 856.388 ms and firefox 913.476 ms
from A1 attach through terminal A2. Five fresh-process recovery observations had
median import/verify/open/restore/publication time 66.571 ms and median total
process time 171.851 ms. These retain the earlier bounded local
method and are not latency-distribution or power-loss claims.

## Cancellation and quota repair measurements

A second follow-up adds 160 samples after the cancellation retry, record quota,
and CLI diagnostic repairs. The raw `post_cancellation_repairs` section records
the dirty `b830805` source observation and hashes of the actual runtime and
harness files. Both preceding studies remain unchanged. These separate sessions
do not establish a causal performance change.

| Mode | Cache | R | Total median ms | First read median ms | Commits |
|---|---|---:|---:|---:|---:|
| manual | cold | 1 | 45.154 | 26.906 | 0 |
| manual | cold | 16 | 60.859 | 44.868 | 0 |
| manual | warm | 1 | 20.005 | 8.610 | 0 |
| manual | warm | 16 | 33.969 | 21.056 | 0 |
| fixed | cold | 1 | 491.769 | 201.445 | 41 |
| fixed | cold | 16 | 554.881 | 278.508 | 41 |
| fixed | warm | 1 | 450.087 | 160.876 | 40 |
| fixed | warm | 16 | 458.791 | 180.703 | 40 |
| ensure | cold | 1 | 545.230 | 241.194 | 47 |
| ensure | cold | 16 | 640.865 | 312.727 | 47 |
| ensure | warm | 1 | 475.827 | 173.798 | 46 |
| ensure | warm | 16 | 545.074 | 224.777 | 46 |
| stationary | cold | 1 | 326.923 | 106.663 | 32 |
| stationary | cold | 16 | 310.438 | 110.468 | 32 |
| stationary | warm | 1 | 320.802 | 93.696 | 32 |
| stationary | warm | 16 | 306.577 | 92.373 | 32 |

All structural guards passed for every sample. Artifact sizes and peak World
working-memory bounds remain as reported above. Browser observations were
Chromium 878.739 ms and Firefox 1006.299 ms. Five fresh-process
recovery observations had median internal time 68.478 ms and median process
time 181.345 ms. The same local measurement limits apply.

## Reproduction

Use the exact dependency lock and the repository's existing owner-delegated setup:

```sh
node tools/agent4/setup.mjs --work-dir "$PWD/.agent4-mobility-inputs"
zig build check-mobility -Doptimize=ReleaseSafe \
  -Dworld-source="$PWD/.agent4-mobility-inputs/inputs/world" \
  -Dworld-runtime="$PWD/.agent4-mobility-inputs/out/world-runtime/runtime" \
  -Dbrowser-tools=/absolute/locked-playwright-tools
export AGENT_MOBILITY_RUNTIME="$PWD/.agent4-mobility-inputs/out/world-runtime/runtime"
node test/agent4/mobility_measure.mjs mobility-measurements.json 10
node test/agent4/mobility_recovery_measure.mjs mobility-recovery.json 5
```

Setup uses authenticated GitHub artifact acquisition and the locked World owner
installer; it never silently builds a substitute kernel. Unavailable pinned
artifacts are a setup blocker. Previously verified inputs support `--offline`.
The build accepts `-Dworld-archive` when supplying an existing authenticated source
archive. Browser tools must contain `playwright-core` 1.63.0 and both installed engines
(the qualified World `test/current/browser-tools` installation is suitable). `AGENT_MOBILITY_BROWSER_MEASURE` can name an append-only
JSONL output when running `check-mobility-browser`. `check-mobility-economy` runs
four warm R16 structural samples separately from the full statistical study.

The historical baseline is preserved as observations, not a second production
implementation. Reproducing its encoding comparison requires the preflight code
at `73f449f` with this harness; ordinary commands measure the current candidate.
No RPC comparator was measured. Locality or missing local authority can motivate
a move, but these results do not establish that migration is universally faster
than remote effects, nor that it moves hidden provider state or prompt caches.
