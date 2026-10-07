# Native reference qualification

This records executed reference subjects, rather than a claim that every later
commit inherits their result. The exact delivery head, current checks and serial
review disposition are maintained on [PR #45](https://github.com/tkersey/agent/pull/45).
The [acceptance map](native-single-binary-acceptance.md) identifies the source and
witness for each v1.2 obligation; the [runbook](native-single-binary.md) describes
building, launching, operating and recovering the applications.

On October 7, 2026, the user retired macOS builds and tests in CI and locally.
Current qualification runs on Linux CI; macOS observations below remain
historical evidence for their named subjects, not qualification of later changes.

## Executed subjects

| Subject | Observation |
|---|---|
| `592483bcca02eef3663afe32fbd178df2294647d` | [Full Linux CI](https://github.com/tkersey/agent/actions/runs/37604386166): source accounting, external installation, authoring and native checks passed in **4m44s**; 92 native tests and 100 protocol-schema cases. |
| Same subject | [Linux native/manual](https://github.com/tkersey/agent/actions/runs/37605483683) and [macOS arm64 native/manual](https://github.com/tkersey/agent/actions/runs/37605479994): isolated applications, public downstream recipe with network denied, native API/HTTPS, archive/parity and build campaign passed. |
| `d7b7a4db6a8c09a521459bdc73968879577730f7` | [Full Linux CI](https://github.com/tkersey/agent/actions/runs/37607986892) passed in **3m43s**, including the added held-provider cancellation/unknown-recovery phase. Cancellation acknowledgment was **6.12 ms**; the four-call investigation remained independently asserted. |

The two manual runs retain tar archives for 14 days:
[Linux x86_64](https://github.com/tkersey/agent/actions/runs/37605483683/artifacts/11475411562)
and [macOS arm64](https://github.com/tkersey/agent/actions/runs/37605479994/artifacts/11475710697).
Each contains `repository-agent`, the minimal example, their observed build
manifests, a runbook, repository-example instructions and the optional TypeScript
client. Copy only the chosen executable for deployment. These are CI build
artifacts, not a signed/notarized release. Their recorded subject is `592483b`;
consult the PR for newer delivery artifacts.

| Target at `592483b` | Minimal executable | Repository executable | Deployment observation |
|---|---:|---:|---|
| `x86_64-linux.5.10...7.2-musl` | 28,385,866 bytes | 41,784,949 bytes | Ubuntu 22.04 runner; static ELF, no dynamic loader/NEEDED libraries; private user/mount/PID namespaces and 67 traced application launches. |
| `aarch64-macos.15.7.9...15.7.9-none` | 3,530,984 bytes | 4,236,944 bytes | Native macOS 15.7.9 arm64 runner; only `/usr/lib/libSystem.B.dylib`; verified ad-hoc signature; OS file-read/executable restrictions. |

Final file hashes for those archives:

| Artifact | SHA-256 |
|---|---|
| Linux minimal | `776354f5de19e4061be0a1eeff4b3a63b3bfbc472aead5542b487453917f423a` |
| Linux repository | `19f416a144a68de6afffd81f480cd7f795d04c9e026fd81c4849b9317688342d` |
| macOS minimal | `ad1be12506ca572701b584f05435be994d01b8050e9a571cb2c8380063091a9e` |
| macOS repository | `0bd3fecc5a7fce6501fc4ecdb22af8702eda44e28f3e4b8bf9321a056c24f8f9` |

The manifests identify Zig 0.17.0, its executable/library digests, unchanged
World `35f11b811b03fcaa2d696265ff8d9b9c92c8fc95` and Boundary
`c49f743382257c7cf5512934ae3a2d0f56d4d4c0`, SQLite 3.53.4, safe optimization,
the selected target, embedded assets and `agent-native-state/7`. The reference
TLS runs use an explicit ephemeral DER root; actual live operation may instead
use the declared OS trust roots. The native file hash is independent of the
WASM runtime hash and does not authenticate its own executable.

## What the runs exercise

Both copied applications execute without access to a source checkout, build
cache, Node/Python/Zig/npm, loose image/schema files or a WASM engine. Controllers
and fixture TLS servers remain outside that boundary. Linux process traces reject
unexpected executable launches; macOS prevents them through its allowlist.
Ubuntu 24.04 rejected even untraced namespace admission, so Linux deployment uses
22.04 with its default security policy. No OS security setting was weakened.

The native public-API consumer covers child/retained continuation, yield, bound
reply, output-capacity rollback, checkpoint restore and close. The process peer
covers actual CLI/stdio negotiation, typed admission, durable questions, lost
acknowledgments, stable retries, cancellation, event replay/subscriptions,
ownership exclusion, bounded partial/output stalls, archives, expired cursors,
public schema chunks and independent JSON Schema validation. The shared owner
fixture reconstructs a large result from authorized chunks and rejects revoked
artifact access.

The repository investigation performs native list/read, asks a client question,
queues a Unicode follow-up during held provider I/O, survives SIGKILL/restart,
uses its frozen snapshot after external mutation and produces an independently
checked report. Its settled archive revalidates provider projections/replay
objects; omission of a replay object fails and valid retry succeeds. Recorded
question/inbox/model-v5 replies resume that exact image through three WASM and
two native steps, with equal canonical outcomes. The later cancellation fault
phase acknowledges while I/O is held, preserves unknown delivery across restart,
recovers original receipts and refuses unsafe resume without another request.

The HTTPS peer uses real TLS verification and independently supplied wire bytes:
trusted success, HTTP failure, refused redirect, wrong chain/host/expiry,
oversize, fixed-length/chunked truncation, encoding policy, plaintext rejection
and a 100 ms held-response deadline. Provider acquisition, strict interpretation,
replay closure and the compatible JS v3 intersection have separate witnesses.

## Measurements

The bounded manual build campaign uses the public minimal recipe and new compiler
caches containing only provisioned package sources. Network access is denied.
It performs one cold build, one unchanged build (binary equality required), and
one embedded-resource edit (binary inequality required), then restores the source.
It does not run on PRs or modify packaged reference binaries.

| `592483b` sample | Linux x86_64 | macOS arm64 |
|---|---:|---:|
| Cold recipe build | 242.594 s | 246.568 s |
| Identical warm build | 2.474 s | 4.669 s |
| Resource-edit build | 86.798 s | 110.207 s |
| Minimal `describe-build` wall time | 198.72 ms | 35.08 ms |
| Minimal durable offline demo wall time | 370.03 ms | 109.67 ms |
| Demo command RSS high-water report | 3,670,016 bytes | 40,419,328 bytes |
| Three held-I/O ping samples | 2.64 / 3.55 / 3.35 ms | 0.64 / 0.70 / 0.31 ms |
| Three held-I/O status samples | 6.78 / 5.65 / 5.71 ms | 0.38 / 0.93 / 0.37 ms |
| Paired WASM in-process continuation, two steps total | 18.64 ms | 23.07 ms |
| Paired native-process continuation, same two steps total | 15.74 ms | 20.97 ms |

These are individual observations, not percentiles. RSS is the OS command
high-water report, including isolation/controller processes; it is not summed
simultaneous RSS or allocator payload. Native continuation timing includes
process launch, input read, preparation/restore and output decode. Neither
continuation column includes provider time or durable host storage. The provider
fixture is deliberately held, so its elapsed time is not a network/model latency
benchmark. Native/WASM host throughput equivalence and a native speedup are not
claimed. The build summaries separately record compiler invocations, phase times,
MaxRSS and actual cache reuse.

Later runs also report program/checkpoint/frozen-resource bytes, launch-to-first
provider-request and investigation wall time. Each recorded native continuation
reports fresh preparation, start/restore, prepared drive/checkpoint time, World
work counters and the outer allocator's peak requested bytes. Those samples enable
World statistics, exclude allocator backing metadata, and keep their scope
distinct from RSS and full process time. Investigation time includes the deliberate
hold, client actions and forced restart; it is not live-provider latency.

Declared limits are separate from measurements: 64 MiB host allocation budget,
16 MiB SQLite heap, 256 MiB state namespace, 1 MiB protocol frame, 4 MiB retained
outbound payload, at most 16 outstanding calls/subscriptions/nonterminal tasks,
bounded World quanta and explicit provider request/response/deadline caps.

Earlier Linux-only observations (including 4m50s at `82bff12`, 4m44s at
`592483b`, and 3m43s at `d7b7a4d`) do not establish the current complete-workflow
5m30s target. At `2415f66`, the Linux-only workflow took 5m00s from its
start to GitHub completion; the earlier 4m49s report omitted its final gate.
Complete separate platform runs took 6m27s on Linux and 9m19s on macOS.
The PR workflow now requires Linux qualification, clean deployment, the downstream
recipe and artifact packaging. Its complete measured pass below 5m30s
remains unproved. Other observed Linux runs took 6m39s–8m31s; cache restore
success did not always mean compiler object reuse.
The earlier 4m41s result at `b121ced` was also a single observation. There is no
five-minute hosted-runner SLA. Necessary checks remain selected; the gains do not
come from lowering safety, extending deadlines or adding runners to disguise
work. Large Linux files were inspected: the earlier 28.2 MB minimal ELF contained
no `.debug*` sections; its size must not be attributed to unstripped debug data.

## Limits and delivery posture

Native core, stdio and provider-backed reference integration are implemented.
The linked runs establish their stated reference/target observations, not live
provider qualification. No actual model/data/spend approval or credentials were
supplied for a live call. An operator must provide the approved fixed profile,
credential file, task/repository inputs, writable state and network access;
changing an old task's frozen profile is refused. No model switching, skill
load/unload, remote custody or mobile Git publication is added.

Process-crash recovery is exercised. Whole-volume malicious rollback, arbitrary
administrator writes and power-loss guarantees beyond the selected filesystem's
fsync semantics are not claimed. The reference history policy is namespace-bounded
retention without automatic pruning; valid imported suffixes disclose their floor.

The task's cumulative **300-second local build/test allowance is exhausted**.
Further compilation/execution qualification, including review follow-up checks,
must use CI. Source inspection, formatting and artifact inspection are separate.
Required serial review remains governed by the exact PR head and its current
evidence; do not infer completed review from this report or an older run.
