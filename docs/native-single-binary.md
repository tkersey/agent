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

Executed on macOS arm64 with Zig 0.17.0, safe optimization: **9/9 build steps
passed**, including the native run. A copy ran from an unrelated directory
containing spaces and Unicode, with `PATH=/nonexistent`. Binary inspection
reported Mach-O arm64 and `/usr/lib/libSystem.B.dylib`. This establishes an
embedded consumer launch, not the full source-denied deployment qualification,
Linux execution, persistence, protocol, TLS, or live-provider acceptance.

The initial build rejected an authored addition without its required overflow
failure value. The corrected program supplies that value through the existing
source primitive contract; the expected result and native assertions are unchanged.

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
* Remaining native work includes the public build helper, embedded schemas and
  manifest, exact handler admission, durable task/occurrence owner, authored
  inbox, bounded stdio protocol and client, native HTTPS and snapshot tools,
  and the useful fixed-profile authored repository analyst.
* Qualification still requires public downstream installation, cancellation and
  crash/restart, real TLS, protocol fault/control cases, native/WASM/native state
  transfer, both final platform artifacts, and separated measurements. Live
  inference requires separate explicit authorization and operational inputs.

The [acceptance matrix](native-single-binary-acceptance.md) tracks every v1.2
obligation. Supporting N0 evidence is not a completed product acceptance row.
No native-core, protocol, reference, target, or live-qualified product claim is
made at this stage.
