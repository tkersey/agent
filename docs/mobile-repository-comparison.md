# Mobile repository comparison

The qualification-only stationary profile grants U real proxy bindings for W's
repository, model and check leaves. The same compiled session image and exact
task bytes run in both profiles. `ensure` observes actual local bindings in the
stationary profile; it is not overridden to return `Here`. Distinct signed
policy revisions identify the profiles. The stationary profile never creates a
second run owner at W.

Both profiles use the production custody journal, policy, model normalization,
snapshot/candidate/check/proposal owners, and authenticated deferred review.
Stationary proxy requests carry the exact binary payload and schema identities
over mutual TLS with pinned peers. Before W I/O, the fixture rechecks the current
U occurrence, attempt, request digest and policy. The one-use admitted request
must match the received metadata and bytes. Model/check charges remain durable
at the current custodian, under an explicit delegated proxy grant with the same
limits. The qualified workload is `propose`; managed publication and live-model
quality are not measured by this comparison.

This is a single-machine qualification harness. U's authority callback is
in-process even when the leaf request crosses HTTPS; it is not a deployable
remote authorization protocol or evidence for a two-machine installation. No
production proxy path or credential forwarding is introduced.

## Commands

Use the authenticated dependency setup and the same source/runtime/prefix flags
as the other qualification targets:

```sh
zig build check-mobile-repository-comparison -Doptimize=safe \
  -Dboundary-source="$PWD/.agent4-mobile/inputs/boundary" \
  -Dworld-source="$PWD/.agent4-mobile/inputs/world" \
  -Dworld-runtime="$PWD/.agent4-mobile/out/world-runtime/runtime" \
  --prefix "$PWD/.agent4-mobile/out"
```

`measure-mobile-repository` with those flags writes
`.agent4-mobile/out/agent4/mobile-repository-comparison.json`. It runs serially:
two warmup pairs followed by thirty measured pairs in each of nine cells, with
alternating topology order. It retains every attempt, including warmups and
failures, and refuses a complete result if an oracle or pairing check fails.
A single `--sample` invocation is only a smoke test, not a qualified latency cell.

## Workload and measurement scope

The exact-content check independently validates an actual immutable Git
candidate. Both profiles have the same goal, input bytes, patch, schemas,
provider replies, model/check counts and allowance limits. All providers and
human responses are deterministic local fixtures. There are no paid calls or
actual-person dwell times.

The base workload runs under cold and warm artifact-cache conditions with local
transport and two declared emulated links: 5 ms one-way / 10 MiB per second, and
25 ms one-way / 1 MiB per second. Three additional warm/local cells vary one
workload input: repository content from 64 bytes to 64 KiB, three extra reads, or
16 KiB of opaque reasoning per model reply. Extra reads necessarily also grow
replay; the opaque-padding cell varies checkpoint size at a fixed call count.

Emulation adds serial service delay after each completed RPC, based on observed
request count and application-protocol bytes. Actual local mutual TLS remains
enabled. This is not packet-level WAN emulation: congestion, loss, retransmission
and remote CPU contention are absent. Reported bytes exclude HTTP/TLS framing
in both profiles. The proxy sends binary values, without base64 payload expansion.

Timing begins at signed run registration and ends at the terminal report.
Process start, provisioning, certificate creation, module import, compilation and teardown are
excluded. First-use TLS setup is included. Warm samples follow a complete task
in the same journals and then register a fresh run; image caching, JIT warming
and retained journal history are not presented as isolated effects.

The report separates kernel-method, journal-transaction and environmental-leaf
spans; those spans may nest and must not be summed as independent costs. First
model dispatch establishes that initial evidence has reached the computation;
leaf completion is reported separately. The proposal timestamp is the durable
human-review boundary. Kernel live memory is sampled at method boundaries;
process resource usage is the Node process's own accounting. Retained storage is
apparent file size, not allocated disk blocks. Full browser/person latency must
not be inferred from these Node-origin measurements; browser verification needs
its separately identified observations.

## Frozen-revision results

All 576 attempts passed: 36 retained warmups and 540 measured samples, giving
30 matched pairs per cell. Measurements executed from detached revision
`0d90b8032fc01ae83c8f4723e20399828aa7d3c2` on Apple M2 Pro / arm64,
Darwin 27.2.0, Node v26.10.0. The image was
`d75155bfd55548a5f42e96154f7538795c303d81fc7eb8e42b6e66d4a8df70de`;
the authenticated World kernel was
`e6a982f3f13790e3dec7a5e26770549a6be8d0cb5e97a25cd97cead993f2b394`.

| Cell | Mobile p50 ms | Stationary p50 ms | Paired difference p50 ms | Protocol bytes, mobile / stationary |
|---|---:|---:|---:|---:|
| base / cold / local | 1513.4 | 1177.0 | +335.7 | 89053 / 40296 |
| base / cold / metro | 1685.2 | 1291.0 | +392.2 | 89053 / 40296 |
| base / cold / wide | 2450.3 | 1757.7 | +692.6 | 89053 / 40296 |
| base / warm / local | 1451.6 | 1202.7 | +249.9 | 49703 / 40296 |
| base / warm / metro | 1594.2 | 1342.2 | +257.4 | 49703 / 40296 |
| base / warm / wide | 2290.0 | 1839.6 | +471.5 | 49703 / 40296 |
| repository / warm / local | 1443.6 | 1179.5 | +261.6 | 49703 / 40296 |
| reads / warm / local | 2337.0 | 2168.6 | +177.5 | 54138 / 97326 |
| checkpoint / warm / local | 1469.0 | 1203.6 | +265.1 | 98858 / 187757 |

Mobility was slower in all tested cells. It transferred less data for the
extra-read and opaque-replay workloads, but those byte savings did not offset
its execution/custody cost under these conditions. Cold mobile runs sent the
33,728-byte image; warm runs sent no image bytes. The larger-repository cell
adds admitted but unread context content; it does not establish whole-repository
build scaling. These results do not justify a performance optimization or a
claim that mobility makes the full browser/person workflow faster.

The [compressed raw report](measurements/mobile-repository-0d90b80.json.gz)
retains every attempt, all phase observations, p95/min/max summaries and paired
differences. Its uncompressed SHA-256 is
`585a8e53ada6a010dd1d0a3a75b6f555584fed0b2b50bda384279404ada89e4a`.
Quantiles use nearest rank; thirty samples do not give a precise tail guarantee.
The raw process-resource counters cover each whole child process, including
setup and any warmup, and must not be attributed solely to the timed task.

Browser-verification and restart attribution, actual UI operation counts, and
final acceptance reconciliation remain open. This is a scoped mechanics result,
not full reference, deployment or live qualification.

## Supplemental browser and recovery attribution

`measure-mobile-repository-attribution` uses the same source/runtime/prefix flags
plus `-Dbrowser-tools`. Run measurement targets serially. It writes
`agent4/mobile-repository-attribution.json` under the selected prefix and retains
two warmup pairs followed by thirty measured pairs per cell.

The browser cells restore the actual parked W-to-U relocation outcome from the
full session program, then drive it without a reply and require byte-identical
outcome bytes before retirement. Chromium and Firefox receive identical captured
inputs, with alternating engine/workload order. The base and opaque-replay
workloads produce different checkpoint sizes. Each sample has a fresh production
Worker; module/kernel HTTP loading, preparation, restoration and message cloning
are included. Browser/context creation, page setup, fixture generation and
Playwright transport are excluded. Browser services and connections are warm.
Host `WorldAdmission.parked` verification is reported separately with runtime and
kernel bytes already loaded; it is not an equivalent browser-latency baseline.

Recovery cells start after a real publication whose reply is deliberately lost.
They compare reconciliation with the current custodian against executor retirement
and journal close/reopen followed by the same reconciliation and authored return.
Both must retain the exact published commit, invoke the publisher once, and finish
with identical tool-work counts. The measurement excludes fixture creation,
whole OS-process startup and native check-runner qualification. Source and helper
hashes must remain unchanged during collection. No state bytes, keys or credentials
are included in the report.

The full installed deployment test can additionally write actual UI/CLI operation
counts with `AGENT_REPOSITORY_OPERATOR_PROOF=OUTPUT.json`. These count the automated
driver, including its 50 ms Continue polling and qualification-only negative CLI
checks. They do not measure human dwell or establish a minimum number of required
human gestures. An unchanged-state Continue is a before/after observation, not a
claim that another click caused progress.
