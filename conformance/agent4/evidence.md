# Agent qualification evidence

The current source/runtime tuple is authoritative in
[dependencies.lock.json](dependencies.lock.json). Current executed results,
limitations and open work are reported in
[the successor status](../../docs/compositional-execution.md). The commands are
`check-agent4` for authoring and the runtime/tool/browser/integration commands
listed there, using authenticated immutable inputs. `emit-agent4` produces the
source-independent use archive; its actual contents and commands are tested.
Functional economy checks do not establish timing acceptance.

## Current proof surfaces

| Obligation | Owning executable evidence |
| --- | --- |
| Source, archive, package and runtime authentication | `test/agent4/dependencies.test.mjs`, `setup.test.mjs`, `consumer_build.test.mjs`; pre/post dependency guards |
| World-free authoring and installed module authentication | `test/agent4/installations.mjs`, `test/agent4/consumer_build.test.mjs` |
| Source-independent execution and documented commands | `test/agent4/bridge.test.mjs`, `package_commands.test.mjs`, `inquiry_cli.test.mjs` |
| Authored order, typed responders, scoped offers and model custody | `test/agent4/review_runtime.mjs`, `decision_scopes.zig`, `model_custody.zig`, `model_admission.zig` |
| Owned child futures, delayed resume/disposal and retained alternatives | `test/agent4/dialogue_runtime.test.mjs`, `multi_runtime.mjs`, inquiry scenario/application runners |
| Live evidence, exact approval, amendment and conditional replacement | `test/agent4/observation.zig`, `approval.test.mjs`, `document.test.mjs`, `document_runtime.mjs` |
| Malformed/stale replies, repeated occurrences, cancellation and cleanup | `test/agent4/bridge.test.mjs`, `runner.test.mjs`, `independent.mjs` |
| Native/Node/Wasmtime agreement and real browser tool transfer | `test/agent4/native.zig`, `independent.mjs`, `text_browser.mjs` |
| Independent effectful components and client reuse | `test/agent4/component_runtime.mjs`, `text_tool_runtime.mjs` |
| Bounded retained control and matched fresh/resident replay | `tools/agent4/economy.mjs` |

This is a coverage index, not a substitute for the exact-input command results.
The kernel stays generic across applications. Returned request display data is
not authoritative control; snapshots can be copied and replayed. Finite tests do
not prove malicious-handler truth, global exactly-once effects, distributed
locking, universal model reliability or live-model usefulness.

## Historical measurements

The pre-successor Agent 4 milestone used Agent baseline
`151c683de871e3df819a1a666fcdf41bff3e391f`, source-input fingerprint
`952ec0a51a9e5144567157fa192567e4633da18a15695fb749bb6758c9b104d6`,
Boundary `7a4d10ec656cf70bbab99281dd71e3ec493daa0c` and World
`699a3147088274d2bf742c6ecb4cb70a5faea631`. Its ABI 2 kernel was 388,453 bytes,
SHA-256 `9d1cc7b8f2895a25034a5074413da646ae038dfc00b3d80563e71698c630f9a4`.
Zig was 0.16.0, Node 26.8.1, and the kernel build used ReleaseSmall.

Those historical observations remain bounded to their original inputs:

- Minimal direct/Agent images were byte-identical at 119 bytes.
- Retention-8 conversations parked at 100/156/156/156 bytes after 1/8/64/1024
  turns; post-window states matched and retained no old resources or futures.
- The 1/8/64-alternative examples had maximum parked states of 249/418/1,762 bytes.
- Controlled cold/warm/client-edit builds took 19.011/0.211/13.645 seconds.
- One warmed direct/facade comparison measured 3,000 ns of facade authoring
  overhead, including 1,125 ns of Agent admission. Emission differed by -24,792 ns
  between equivalent paths; this was a finite observation, not a speedup claim.
- Later model-template checks added 378 bytes to each model-backed review image
  and 387 bytes to the document image. Subsequent consuming-build authentication
  was not measured as free. Earlier timing observations do not qualify those changes.

Later predecessor tuples included Boundary 2.0.1 / World 5.0.1 and released
Boundary 2.0.2 / World 5.0.2, the latter checked on September 15, 2026 with
Node 26.8.2. They are historical qualification, not the current dependency graph.
The original inventories, image hashes, review chronology and generated-log paths
remain recoverable from this file at Agent
`ec6827e0ab4bbfde60cf5ee24a9ffca9c1c570a0`. Current raw performance observations,
including regressions, remain under `docs/measurements`.

## Preserved regression history

Earlier reviews exposed the following families. Their fixes and executable
regressions remain in the current code; removing repeated status/log narratives
neither removes the cases nor grants new review credit.

- Custom abort reasons, zero-call provider policy, model-template/result bounds,
  and unsupported streaming/background policies: model adapter/admission tests.
- Scoped live-evidence approval, wrong evidence, hidden or forwarded speculative
  effects, private resource escape, and shallow futures resumed under multi-shot
  successors: protected admission, observation and approval tests.
- File modes under restrictive umask, bounded reads including file growth,
  oversized documents, conflicts and uncertain delivery: document tests and
  application runtime checks.
- Recursive rendering and display-capacity exhaustion preserving canonical
  requests: runner/bridge tests.
- CLI aliases, absent `import.meta.main`, import safety and path containment:
  shared CLI tests and actual packaged-command execution.
- Alternate immutable inputs, Git-free authoring, cached source-override exports,
  falsy callback rejections and inherited `NODE_TEST_CONTEXT`: dependency,
  consuming-build and launcher regressions.

The historical proof did not qualify complete Windows or Node 20 execution.
It retained exact POSIX modes instead of weakening inventories to force a match.
One old diagnostic `zig build --help` omitted isolated-cache flags; shared-cache
non-mutation for that invocation was unestablished. Dependency inventories stayed
unchanged and acceptance builds used isolated caches. These historical limits
are not claims about unexecuted current lanes.
