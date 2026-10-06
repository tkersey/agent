# Native single-binary applications

Implementation in progress against **Native Single-Binary Agentic Systems v1.2**
(October 6, 2026). The required product is `repository-agent`, with a shared
human CLI and `agent-host/1.0` stdio interface. It is not implemented yet.
The fixed-profile native application precedes the separate adaptive application.

## N0: consumer audit

The starting Agent revision is `a59e250be2a85dab1661fdad012c82fa18b5c546`.
Its unchanged dependency lock selects World
`35f11b811b03fcaa2d696265ff8d9b9c92c8fc95` and Boundary
`c49f743382257c7cf5512934ae3a2d0f56d4d4c0`. Setup authenticates their source
archives, complete inventories, Git trees, Boundary package, and existing WASM
runtime bundle. Source identity and WASM artifact identity remain distinct.

The first independent consumer is `test/consumers/native/`. Its host emitter
uses `agent.system` and `agent.compile`; the deployed executable imports only
`world` and `boundary_data`, and embeds the resulting BPI3. It uses public
`Prepared` and `Resident` APIs, with an explicit 4 MiB allocation domain.

```sh
node tools/agent4/setup.mjs
zig build check-native-consumer -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
./zig-out/bin/agent-native-consumer
```

The independent expected result is `41`: the authored caller retains `20`,
calls a child that requests a native increment (`21`), yields, and adds the
retained value after restoration. The consumer also supplies an insufficient
output buffer, checks unchanged checkpoint bytes, and then supplies the same
reply successfully. Closing the completed restored resident rejects later use.
This witness is included once in `check-native`, sharing the existing fixture
emitter compilation. It is not a production host or application policy loop.

The initial N0 commit also passed the complete existing CI matrix on Linux:
[run 37518433037](https://github.com/tkersey/agent/actions/runs/37518433037).
That run predates the build-helper and protocol changes below.

Executed on macOS arm64 with Zig 0.17.0, safe optimization: **9/9 build steps
passed**, including the native run. A copy ran from an unrelated directory
containing spaces and Unicode, with `PATH=/nonexistent`. Binary inspection
reported Mach-O arm64 and `/usr/lib/libSystem.B.dylib`. This establishes an
embedded consumer launch, not the full source-denied deployment qualification,
Linux execution, persistence, protocol, TLS, or live-provider acceptance.

The initial build rejected an authored addition without its required overflow
failure value. The corrected program supplies that value through the existing
source primitive contract; the expected result and native assertions are unchanged.

## N1 implementation under qualification

`build.zig` now exports `addNativeSystem`. The helper runs
`tools/native/emit.zig` on the build host, using the application's `agent.system`
definition. It emits one canonical image plus application schemas, declared
capabilities and immutable resources. The target imports only the native
environment, World, Boundary data, ordinary Agent codecs, and the application's
compiled handlers/types. A separate build-time tool binds compiler/library,
dependency, target, resource and license metadata without embedding private
build paths or a circular executable hash.

The reusable application asset value includes its type source. Supplying an
already emitted application for another target cannot silently ignore a second
definition or separately substitute a type mapping. Set
`application = .{ .emitted = first.assets }` on the second target build to share
the same generation step. Target manifests remain distinct.

The complete example source is in `examples/native-minimal/`: `types.zig`
declares its client values, `definition.zig` authors the computation and assets,
and `environment.zig` declares three static typed native handlers. The example
retains its input over an increment, yields, asks for a label and performs
authored cleanup before returning. The explicit offline demo supplies a
deterministic label and reports that it is nondurable.

```sh
zig build native-example -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
./zig-out/bin/agent-native-example --help
./zig-out/bin/agent-native-example describe-build
./zig-out/bin/agent-native-example demo --offline
./zig-out/bin/agent-native-example serve --transport stdio --offline
```

For a downstream build, use the example's own `build.zig` and `build.zig.zon`,
with the Agent dependency pointing to the admitted package. Supply the same
authenticated `-Dworld-source` and `-Dworld-runtime` inputs used by Agent setup.
The helper installs the executable through the caller's normal prefix and
executable directory. Linux's host-default product target is x86_64 musl;
macOS's supported product target is arm64. Explicit other product targets reject.
The native consumer audit still uses its platform's native ABI independently.

The native client mapping is `agent-client-values/1.0`: bounded text is a JSON
string, bounded bytes use unpadded canonical base64url, 64-bit integers use
canonical decimal strings, smaller integers use JSON integers, products use
closed named objects, and sums use `{tag,value}`. Optional values use JSON null.
Provider v3/v4 JSON schemas retain their existing numeric meaning. Runtime
admission checks the embedded client and wire schemas against the actual types.

The new framing/parser and static registry have focused negative tests. The
independent subprocess peer exercises the copied final example executable,
offline demo, fragmented Unicode/CRLF, coalesced input, malformed/duplicate JSON,
negotiation, discovery, notification suppression, batch correlation and truncated
or oversized input. These changes are **not yet qualified** by the N0 CI run.

Durable task execution, real client question/answer delivery, timeouts,
backpressure and shutdown/recovery are still being implemented. Discovery
reports task execution/events/message input as disabled and task calls reject
with `UnsupportedCapability`; accepting a JSON line is not claimed as protocol
reference qualification. The nondurable demo driver will be wired through the
same persistent task owner as the CLI and protocol before N1/N2 acceptance.

## Existing owners and remaining gaps

* World already supplies native `Prepared`, `Resident`, transactional drive,
  checkpoint/restore, and terminal close. N0 demonstrates no generic World
  deficiency. No World or Boundary change is currently needed.
* `src/model_invocation.zig` and `runtime/model.mjs` already own additive
  `agent.model.invoke.v4` replay records, alongside unchanged v3. Reuse and
  qualify that owner; the inline replay representation still needs assessment
  against v1.2's bounded artifact references, exact provider grammar, and native
  transport requirements. Do not create another native-only model contract.
* `src/responders.zig` already supplies checked replay interpretation against
  the offered actions. Native normalization cannot replace that admission.
* `runtime/mobility/custodian.mjs`, `journal.mjs`, and their core own dispatch
  admission, attempt charging, acquired replies, deferred questions, unknown
  delivery, and checkpoint successor semantics. The standalone native adapter
  must preserve those semantics without opening a live multi-host database.
* The build/embedding/discovery slice above is under qualification. Remaining
  product work includes the durable task/occurrence owner, authored inbox,
  complete stdio protocol and client, native HTTPS and snapshot tools, and the
  useful fixed-profile authored repository analyst.
* Qualification still requires public downstream installation, cancellation and
  crash/restart, real TLS, protocol fault/control cases, native/WASM/native state
  transfer, both final platform artifacts, and separated measurements. Live
  inference requires separate explicit authorization and operational inputs.

The [acceptance matrix](native-single-binary-acceptance.md) tracks every v1.2
obligation. Supporting N0 evidence is not a completed product acceptance row.
No native-core, protocol, reference, target, or live-qualified product claim is
made at this stage.
