# Bounded Zig repository checks

The mobile repository work adds a macOS specialization of the existing inquiry
isolation owner. It admits finite, deployment-owned Zig module graphs and an
independent host-observed check harness. It does not execute a repository's `build.zig`.
Its current application witness repairs a deliberately incorrect boolean JSON
size bound in an isolated copy of Agent's real `src/model_json.zig`.

Build the two native isolation artifacts with the selected Zig 0.17.0 compiler:

```sh
zig build repository-check-runner -Doptimize=safe --prefix '/tmp/agent check runner'
zig build check-mobile-repository-zig -Doptimize=safe \
  -Dboundary-source="$PWD/.agent4-mobile/inputs/boundary" \
  -Dworld-source="$PWD/.agent4-mobile/inputs/world" \
  -Dworld-runtime="$PWD/.agent4-mobile/out/world-runtime/runtime" --summary all
```

The first command installs `repository-check/agent-check-limit` and
`repository-check/libagent-check-lock.dylib` under the requested prefix. The
qualifier uses the build's actual compiler, library, and helper artifacts.
It fails on an unsupported or ineffective environment; unavailable checks are
not skipped or reported as passing. Direct invocation of the test file explicitly
builds its own helpers as test setup. The runtime adapter never builds helpers.

`createZigRepositorySandbox` takes the existing toolchain owner's selection and
explicit helper paths and SHA-256 identities. Qualification precedes capability
creation. `createRepositoryCheckRunner` admits named profiles once, captures their
module graph, harness digest, expected observation, and reuse declaration, and
accepts only those names on subsequent check requests. Check inputs come from
`checkInputs` on the immutable Git object owner, including independently rebuilt
candidate verification. A truncated read response or live checkout is never a
compiler input.

## Isolation and bounds

Each check receives fresh read-only input files and a fixed-size private APFS
scratch image. A trusted launcher applies fatal active/inactive memory limits to
the final compiler or check process. A pinned dyld initializer installs the
filesystem/network profile before candidate initializers or `main`. Subsequent
exec and fork are denied: an exec must not discard the memory limit. The candidate
also cannot create pthread, Mach, or workqueue threads in the native qualification probes. The trusted compiler runs
with `-j1`; subprocess-dependent compilation is outside this profile.

| Resource | Current binding |
| --- | --- |
| Compiler | Exact Zig 0.17.0 executable, library inventory, non-system dylib closure |
| Compiler memory | 1,024 MiB fatal footprint limit |
| Candidate memory | 64 MiB fatal footprint limit |
| Check execution | One pinned Node subprocess; candidate Wasm imports forbidden |
| Wasm linear memory / module | 16 MiB / 16 MiB |
| Compilation and execution | One shared 30-second deadline by default; positive bounded configuration |
| CPU | Hard per-process limit derived from that deadline |
| Scratch | 256 MiB fixed-size image by default; never a shared cache |
| Output | At most 256 KiB across compilation and execution |
| Open descriptors / core files | 128 / zero |
| Trusted disk provisioning | Each command has a 60-second bound; separately included in observed check duration |
| Network, credentials, source checkout, authoritative Git, journals | Not granted to compiler or candidate |

Qualification probes cover compiler-side assembler file inclusion (positive
admitted read and negative outside read), pre-main candidate initialization,
outside reads/writes, input and executable writes, symlink escape, environment,
network connection, fork, spawn, self-exec, scratch exhaustion, output overflow,
memory exhaustion, pthread/Mach creation, timeout, cancellation, and reaping.
The evaluator checks its own expected observations. A zero exit with missing or
wrong output is not acceptance. The loader acknowledges successful isolation on
a separate bounded pipe and closes it before candidate code runs. A failed
launcher/initializer is unavailable, while the same exit code from an initialized
candidate remains a failed check.

The memory launcher uses the fatal flags declared by Apple's
[spawn interface](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/spawn_internal.h).
The profile uses the kernel's
[server-side Mach routine names](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/mach/task.defs),
not guessed message numbers. Actual local probes decide admission; these source
references alone do not qualify another OS build. Tests exposed ineffective
`ulimit` memory settings, loss of a limit through exec, and a non-enforcing spawn
thread-limit attribute; none is accepted as the corresponding boundary.

## Check-result ownership

The earlier native harness could be fooled by a candidate-defined `exit`
function: a failing assertion called that function, which printed the expected
success marker and exited zero. That route is retired. Repository checks now
compile the admitted module graph to Wasm and execute a fixed observation ABI
in a pinned, resource-limited Node subprocess. The candidate module has no
imports or output channel. The trusted observer returns actual values; only
the parent compares them with the expected results.

A profile's immutable harness exports:

```zig
const subject = @import("subject");
pub export fn agent_observe(index: u32) u64 {
    _ = index;
    return subject.maximumToolArgumentsByteLength(bool);
}
```

`expectedStdout` is the canonical JSON observation vector, for example `["5"]`
followed by one newline. The host calls indices zero through vector length minus
one, up to 64 observations. A returned 4 fails against expected 5, even when the
observer process exits normally. Expectations are not sent to the candidate.

The compiler uses Zig's built-in Wasm linker. The observer retains the existing
64 MiB fatal process limit; its managed heap is capped at 16 MiB. Trusted VM
threads are permitted, but candidate code has no thread/process interfaces.
This profile checks declared portable library behavior, not native-only ABI or
operating-system behavior. Unsupported checks remain unvalidated. Wasm is a
repository-check artifact here, not a new Agent continuation format.

## Evidence and current scope

The test prepares an incorrect real-source base and a corrected candidate in a
private Git store. A deployment-owned harness requires the encoded boolean bound
to cover the five bytes of `false`. The incorrect base must fail; the repair must
pass. The source checkout and managed delivery ref must remain unchanged.
Check records bind the occurrence, base/candidate/tree, complete selected input
bytes, profile, runner, toolchain, contract, actual outcome, completed checks,
diagnostics, physical executions, and observed duration. There is no new cache,
workflow owner, or approval authority in this adapter.

For a local machine-readable qualification report, set `AGENT_REPOSITORY_PROOF`
to an explicit output file when running the check target. That report is local
qualification evidence, not a publication authorization or completion certificate.

The deployment loader accepts `repository-check`. Its `store` identifies the
existing managed repository; `checkProfile` is one admitted finite harness;
`sandbox` selects the absolute `zigExecutable`, `libraryDirectory`, pinned
`launcher` and `processLock`, `scratchRoot`, and execution bounds. The binding's
`profile` fixes the owner, repository, generation, manifest, profile and runner
digests, disclosure audience/labels, and attempt/byte/concurrency allowance.
The loader qualifies the selected sandbox before exposing the capability. It
does not compile helpers or substitute another compiler/profile.

Each dispatch charges the existing W-owned custody allowance before execution.
The check reply contains a typed status and the complete canonical record.
Passed, Failed, Unavailable, TimedOut, Cancelled, InvalidOutput and Incomplete
remain distinct. The authored approval composition stops on every non-passing
status; the publisher also checks agreement between the typed status and the
acquired record. The reference approval test uses this same binding and verifies
its retained charge after restart. The real Zig qualifier sends the repaired
candidate through it, independently requiring the incorrect base to fail.

## Operator-selectable profiles

The use archive includes these manifests under `runtime/repository-profiles/`.
Copy the selected JSON object into the deployment adapter's `checkProfile` field;
its admitted digest and qualified runner identity bind the separate `profile`
grant. Repository registration still fixes the base, readable/writable scope and
required profile. A task or model cannot select arbitrary commands or change the
manifest. The package includes inventoried native helpers; it does not download
or compile helpers at dispatch.

| Manifest | Selected source and independent contract | Excluded claims |
|---|---|---|
| [Boundary wire](../runtime/repository-profiles/boundary.wire-natural.v1.json) | `src/data/wire.zig`: u64 boundary values and rejection of overlong, truncated and overflowing naturals | Full data admission, compiler and interpreter behavior |
| [World budget](../runtime/repository-profiles/world.allocation-budget.v1.json) | `src/interpreter_v2/allocation_budget.zig`: limit rejection, live/required/peak counts, freeing, reuse and reset | OS memory limits and other interpreter semantics |
| [Agent JSON bounds](../runtime/repository-profiles/agent.model-json-bounds.v1.json) | `src/model_json.zig`: bool, u8, i8, u64 and i64 maximum encoded lengths | Arbitrary schemas and model/provider behavior |

These standalone modules import only the authenticated Zig standard library.
The inspected post-migration build graphs put Boundary's wire tests under
`check-data`, World's allocation contracts under `check-storage`, and Agent's
JSON support under its authoring tests. The manifests extract narrower explicit
contracts; they do not claim to run those whole targets. The normal dependency
verifier authenticates the selected Boundary and World sources before profile
qualification. The exact module bytes, standard library, protected harness and
runner are included in check identities. No network dependency acquisition is
needed in the candidate process.

The qualifier runs each unchanged module and a compiling semantic mutation in
an isolated managed snapshot: accepting an overlong natural, allowing allocation
past the byte limit, or undercounting `false`. The base must pass and the mutation
must fail after compilation and execution, with both source checkout and managed
ref unchanged. It uses the same qualified sandbox and resource limits as the
application. For direct test invocation, supply `AGENT_PROFILE_BOUNDARY_SOURCE`
and `AGENT_PROFILE_WORLD_SOURCE` from the authenticated setup.

These profiles are useful only when their independent observations cover the
requested change. A passing narrow profile cannot authorize an unrelated semantic
change; the operator must provide a matching mandatory contract or leave that
candidate unvalidated. Documentation edits can use the relevant profile as a
regression check, but prose correctness still requires independent review.

## Installed operator commands

The extracted archive exposes the same owners through the mobility CLI:

```sh
node runtime/mobility/cli.mjs provision-repository provision.json
node runtime/mobility/cli.mjs qualify-check check.json
```

`provision.json` contains `directory`, `sourceGitDirectory`, an exact `base`
commit, `gitExecutable`, logical `repository` and `generation`, `managedRef`,
`readPaths` and `writablePaths`. Optional `protectedPaths` and `limits` retain
the repository owner's existing bounds. Paths resolve relative to this JSON
file. Import reads the selected commit's tracked tree; it does not fetch or
include dirty checkout content. Existing destination storage is never replaced.
The command prints the resulting manifest receipt. Optional `storage` is
`{"bytes":268435456,"files":65536}` by default; either positive limit may be
lowered at provisioning. These are lifetime managed-object limits, separate from
per-tree and journal quotas. The byte count is the sum of regular-file lengths
under `objects.git/objects`, including compressed objects and abandoned Git
temporary files; the file cap also bounds filesystem metadata overhead. Allocation
blocks and directory overhead are not reported as object bytes.

New stores use `agent-managed-repository/v2`. Earlier application preview stores
without these limits are refused; preserve them for recovery and provision a new
generation rather than editing their manifest. Generated prepare/proposal bindings
now name the same pinned native helper as publication. Direct trusted adapter
callers pass `writeHelper: {path, sha256}` to open a writable store; omitting it
permits read-only operations. The process gate spans quota observation and the Git
writer, including parent death. Admission reserves the [zlib default deflate
bound](https://github.com/madler/zlib/blob/v1.3.1/deflate.c) for both temporary and
final names before a new object; Git can retain both names if interrupted between
[link and unlink](https://github.com/git/git/blob/v2.51.0/object-file.c).
This can conservatively refuse a compressible object close to capacity. Reusing
an already verified object allocates nothing. Partial failed preparations remain
charged, and no quota failure deletes recovery data or changes the managed ref.
`storageUsage()` reports the current object byte/file account to trusted callers.

Check scratch requires an explicit private directory (mode 0700) as
`scratchRoot`; there is no shared system-temporary-directory default. It uses
four atomic directory slots per root.
The runner contract records this capacity. A slot remains occupied across process
death or uncertain setup, and only successful post-reap volume detach/cleanup
releases it. Repeated failures therefore exhaust capacity instead of creating
unbounded new directories. There is no age-based cleanup. Legacy `agent-zig-*`
directories outside the four slots block new allocation until the operator has
reconciled their processes/mounts and preserved any required evidence.

Qualification also reserves its small canary directory from these slots. A check
slot contains one fixed-size image, at most 128 MiB of admitted
input, and at most one image-sized binary copy. At the default 256 MiB image size,
four homogeneous slots account for at most 2.5 GiB of file content, plus bounded
filesystem metadata. Sharing a root with profiles of different sizes uses the
largest profile's bound; the admitted 1 GiB image ceiling gives an absolute
8.5 GiB content ceiling across four slots. These are conservative reservations,
not observed physical allocation. Use independent explicitly provisioned roots
when operators intend independent capacity. Existing journal quotas are unchanged.

`check.json` contains `sandbox` and the selected manifest as `checkProfile`.
The sandbox fields are the same as the deployment adapter: `zigExecutable`,
`libraryDirectory`, `launcher`, `processLock`, `scratchRoot`, `timeoutMs`,
`maximumOutputBytes`, and `scratchBytes`; each helper has `path` and `sha256`.
Qualification prints the runner contract, probe results and admitted profile
identity. An unavailable profile exits unsuccessfully. Helper paths are resolved
to their physical files before identity admission, including macOS temporary
path aliases. These commands do not start a task, invoke a provider or publish.
