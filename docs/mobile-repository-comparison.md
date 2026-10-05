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

The correctness and cold/warm cache smoke tests pass. Thirty-pair measurements,
browser-verification attribution and the final comparative findings are pending.
No speedup is claimed from the smoke tests.
