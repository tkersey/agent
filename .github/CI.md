# CI feedback and focused qualification

`Zig 0.17 qualification` separates source accounting, external installation,
authoring contracts, and native/runtime contracts into visible jobs.
Only tests reached by these routine lanes are retained.

## Gates and reruns

The source job runs `installations.mjs --scan-only` before any Zig installation,
package acquisition or compilation. It uses the **same `authoringFiles` scanner**
as the actual installation. `builtin` is admitted as a compiler-provided module;
unknown named imports, escaping source imports and unaccounted embedded inputs
still reject. The full installation also scans before selecting the compiler or
creating its work directory. A scan pass is not an installation pass.

After source accounting succeeds, the three independent qualification jobs run.
Routine runs use matrix fail-fast: a failed job cancels unfinished siblings.
Manual `collect_all=true` permits independent jobs to continue even after a
source failure; all failed outcomes remain failures. This is explicit diagnostic
collection, not relaxed qualification. Fail-fast applies between jobs, not to
arbitrary failure-like text inside a running Zig command.

The existing `native` check name is retained as an all-lanes result gate. It
requires source accounting and the entire selected qualification matrix to pass.
A manually selected single lane does **not** publish that all-lanes gate. All
lanes are mandatory on push and pull-request runs. No path filter skips tests.

For the exact same commit, use GitHub's **Re-run job** on the failed lane. For a
corrected commit, use a new run or select a manual `lane` (`source`, `installation`, `authoring`, or `native`) against that ref. Re-running an old job does
not pick up a fix committed later. Existing branch protections are not changed.

## Local completion: focused checks, five minutes total

Select checks for the changed behavior. Local verification shares one 300-second
wall-clock deadline, including setup, compilation and retries. Terminate the
command and descendants at that deadline; report incomplete verification, never
success. Documentation-only changes need diff/link review.

The mobile-repository package/deployment, native sandbox and mutation suites,
parser strategy/selection campaigns, long packaged parser journeys and redundant
source-package rebuild have been deleted. Focused regressions preserve only part
of their coverage; the suites are not relocated behind another target or gate.
Product execution and runtime sandbox enforcement remain intact.

Runtime custody, publication-binding, journal, configuration and session regressions
run in the existing authoring/native lanes on every pull request. Optional browser,
full-application, source-free multi-engine and model-exploration campaigns have
been deleted. The slow economy lane and its collectors are also removed. Small
journal tests retain publication receipt transfer, cancellation, restart, signature
and binding coverage. Product examples and runtime enforcement remain.

The commands below describe retained CI lanes, not a local completion checklist:

```sh
# No Zig or dependency setup required.
node test/agent4/installations.mjs --scan-only

# Only the external package consumer.
zig build check-authoring-installation -Doptimize=safe
# The direct driver is even cheaper: no outer build graph compilation.
node test/agent4/installations.mjs --output /tmp/installation-authoring.json

# No duplicate installation check.
zig build check-authoring-core -Doptimize=safe

zig build check-native -Doptimize=safe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime/runtime"
```

The native lane provisions its additional pinned SQLite C/header inputs with
`node tools/agent4/setup.mjs --native`. Pure authoring and installation do not
acquire SQLite. Native framing/value/occurrence/storage tests run with the native
module as an explicit test root: Zig does not collect a named dependency module's
tests from the authoring test root. The existing shared authoring root exercises
integration with real authored programs; `check-native-host` selects the final
example's independent subprocess peer. No existing native or custody check is removed.
When the product target is runnable on the host, runtime unit tests use that
product environment too, including Linux musl rather than only the host's glibc ABI.

The protocol subprocess peer checks the published protocol schemas. Its
independent Draft 2020-12 validator runs through
`uv run --no-project --no-config --python 3.12 --with jsonschema==4.23.0`.
This qualification dependency is not acquired by pure authoring/installation
and is never a launch dependency of the copied executable.

Native verification reuses the minimal application's emitted image for the
public World API probe; the former N0-only emitter is removed. The probe retains
output-capacity rollback, checkpoint/restore, yield, and terminal-close checks.
Both native examples now use the existing shared fixture compiler and the public
helper's asset writer, removing two standalone compiler invocations.
On Linux x86_64, build-time emitters and contract-test executables select Zig's
self-hosted backend while retaining the requested optimization/safety mode.
Shipped application binaries and the public native API/HTTPS probe keep their
normal production backend. Their copied-binary witnesses still run in full.
SQLite and the native C shim are compiled once per target ABI into a static
library, with the same flags and dependency admission, then linked by consumers.
Locked dependency bytes are cached separately from compiler outputs. Setup still
authenticates their archives, inventories, package hashes and runtime bindings
on every run; the installation lane still provisions its own fresh inputs.
The durable-owner test compiles its one image once for both direct and captured
acquisition recovery. It also retains the inbox contract-conflict and message-ID
checks formerly split into a separate inbox fixture. `native_repository.mjs`
is the single repository application witness: an offline launch smoke check and
one controlled HTTPS investigation with native reads, clarification, queued
follow-up, forced restart, frozen evidence, and retained budgets. It uses the
existing TypeScript client, replacing its repeated minimal-task conversation in
`native_host.mjs`. Transport fault cases, raw-capture recovery, storage failures,
protocol faults and native/WASM correspondence retain their existing witnesses;
the application happy path does not replace those distinct boundaries.
The object-and-receipt transaction test also retains the former SQLite smoke
test's binary round-trip, single-connection and heap assertions; the duplicate
raw SQL transaction fixture is removed. Namespace recovery retains its seal-gap
and post-recovery publication checks without repeating the receipt fixture.

`check-agent4` and `check` still include the external installation and all
previously retained authoring obligations. The native lane also runs the retained custody and deployment regressions.
Splitting jobs can still repeat some shared compiler work; lower wall-clock time
or runner-minute savings are not assumed without measuring new runs.

## Measured, non-destructive caching

The old action's post hook erased the entire cache when it exceeded its limit.
Run `37223670750` reported 2,365,145,010 bytes against a 2,147,483,648-byte limit,
then uploaded a 187-byte archive. This demonstrates lost cache retention, not
the cause of all the elapsed build time.

Compiler setup still caches its compiler download, but its automatic compilation
cache restore/save is disabled. Explicit Actions restore/save handles `.zig-cache`
with a versioned namespace per OS, architecture, Zig version, qualification lane
and dependency-lock hash. A separate lock-keyed cache retains dependency source,
package and runtime bytes; setup authenticates all restored inputs on every run.
The external consumer's deliberately isolated caches remain fresh. A cache hit
is not qualification.

Version 2 uses the action's stable tool-cache installation path and passes
fixture selection as an explicit command argument. Previously, changing compiler
paths and inherited CI run IDs changed generated-output locations; native run
`37576438055` reached 8,865,601,430 cache bytes and correctly skipped saving.
The new namespace leaves that older cache intact and retains the same 8 GiB cap.

The Linux products use Zig's self-hosted backend in the selected `safe` mode;
non-debug products strip debug information. The API/HTTPS probe retains LLVM:
its self-hosted experiment compiled faster but failed the existing 100 ms held
request classification, so that experiment was reverted without changing the
deadline or assertion. Both delivered products passed their complete existing
process witnesses with the selected backend.

Measured full Linux workflows on GitHub's Ubuntu 24.04 runners:

| Head | Result | Wall time |
| --- | --- | --- |
| `f07e157` initial consolidation | passed | 12m27s |
| `bfef3f2` fresh compiler-cache namespace | passed | 5m49s |
| `bfef3f2` restored-cache rerun | passed; still recompiled | 8m31s |
| `d435e51` self-hosted products | passed | 5m19s |
| `b121ced` stripped products | passed | 4m41s |

The last run is [37580297873](https://github.com/tkersey/agent/actions/runs/37580297873):
148 native build steps, 91 native tests, both copied application witnesses,
controlled HTTPS, authoring and installation passed. Its minimal executable
was 26,980,021 bytes and `describe-build` took 891 ms; held-I/O repository control
took 4.15 ms. These are observed runs with runner variability, not a latency SLA
or proof that restoring a cache alone improves compilation. Later changes need
their own measurements.

Manual runs can select `platform=macos-arm64` on GitHub's standard `macos-15`
runner. They check the actual architecture and run `check-native-product`;
Linux's full `check-native` still includes the existing mobility JavaScript
regressions. The first broad macOS run passed all 91 native tests and both
applications, but the pre-existing mobility JavaScript checks failed with TLS
certificate and digest errors. Those failures are not relabeled as native
product passes or repaired as part of this platform addition.

Both application peers use one shared deployment controller. Linux checks ELF
linkage and launches the copied executable inside private user/mount/PID
namespaces, tracing process/file access. The mounts contain that executable,
chosen user data, and the qualification tracer with its declared OS libraries.
The tracer starts after namespace admission and rejects every child executable
other than the copied application. macOS checks Mach-O linkage and code-signature validity, then
uses an OS file-read/executable allowlist. Controller code, CA signing keys,
source trees and build caches stay outside the application boundary. These are
qualification boundaries; the delivered executable does not install a sandbox.
Linux qualification requires `bubblewrap` and `strace`; no OS security setting
is disabled to admit it.

Successful manual native runs retain a 14-day CI artifact containing the two
executables, their observed build manifests, the runbook and optional TypeScript
client. A tar archive preserves executable permissions. This is build-artifact
delivery, not release signing, notarization or a published release.

Before and after each applicable lane, `.github/scripts/zig-cache.mjs` records
the restored key, logical file bytes, file count and top-level bucket sizes
(`o`, `h`, `z`, temporary/other directories). The build's `--summary all` records
actual Zig cache reuse separately. A prefix restore can be useful even when the
Actions exact-key `cache-hit` value is false.

Only nonempty caches containing object bytes, no unsupported entry types, and
at most **8 GiB** are saved, including after a completed failing check. An
oversized cache is **not cleared**: upload is skipped and the previous remote
entry remains available. Empty/metadata-only caches never replace useful ones.
Cancellation does not publish an in-progress cache. Cache infrastructure failures
are diagnostic and cannot convert a failing test into a pass. No pruning policy
or higher size limit is introduced without new content/restore measurements.

## Incident and acceptance

The reported October 4, 2026 UTC run started at 18:14:45, reported the scanner
failure at 18:18:48 and returned failure at 19:14:26: 55m38s after detection.
Its final `434/438` build result had one failing check and `222/222` passing test
executions. The fix is source accounting and scheduling, not native-test deletion.

The preflight regression covers compiler `builtin`, unknown imports, source
escape, dynamic imports and embedded data using a deliberately unavailable Zig
executable and no usable dependency checkout. Cache admission checks empty,
metadata-only, within-budget, oversized and aliased inputs without changing them.
The workflow graph gates all routine compilation on that source result. Full
success remains specific to the exact executed commit and selected platforms.

## Shared authoring compilation

The authoring aggregate shares 20 compatible fixture constructors across
`test/fixture_driver.zig` and `test/application_driver.zig`. The build supplies
`AGENT4_FIXTURE` as an explicit execution input; changing the selected constructor
does not create another compiler/module graph. Each invocation remains a fresh
process and calls the original fixture `main` with its original arguments,
standard input and standard output. Existing output paths and focused image
targets are unchanged. Negative harnesses receive the same selection explicitly.

The aggregate also imports compatible public contracts through
`test/authoring_tests.zig`, instead of compiling a test executable per feature.
The original focused targets keep their narrow roots. The private root,
alternate-module admission/dialogue roots, native policy roots and external
installation witness remain independent. No test body or oracle is replaced.

The dialogue and multi-shot tools retain their deliberately different module
identities. Both the installed parser linker and transported text linker remain
standalone: a source-free linker witness must not accidentally carry its fixture
producer. These are assurance boundaries, not arbitrary sharding preferences.

No optimization mode changes: the existing `safe` selection applies to both
shared drivers and retained runtime checks. Shared drivers may repeat across CI jobs; no cross-job linkage or previously
passing test result is reused as correctness evidence.

Backend parity now belongs to the integrated repository witness. Its actual
question checkpoint and recorded native replies cross WASM and the existing
native API probe, comparing every continuation's canonical output and the final
independently checked report. This replaces the narrower minimal-example WASM
continuation and its extra terminal export; the minimal CLI and API witnesses
retain their native leaf, yield, question, cleanup and lifecycle assertions.

When changing this grouping, compare discovered named-test multisets and the
complete emitted-file inventory, including byte hashes, on the same authenticated
dependency tuple. Keep per-fixture execution separate where isolation matters.
An extra anonymous import-root test is scaffolding, not new behavioral coverage.
