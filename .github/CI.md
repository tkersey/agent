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
and dependency-lock hash. It does not cache `.agent4` source/runtime inputs or the
external consumer's deliberately isolated caches. Authentication still runs;
a cache hit is not qualification.

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

When changing this grouping, compare discovered named-test multisets and the
complete emitted-file inventory, including byte hashes, on the same authenticated
dependency tuple. Keep per-fixture execution separate where isolation matters.
An extra anonymous import-root test is scaffolding, not new behavioral coverage.
