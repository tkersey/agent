# Bounded Zig repository checks

The mobile repository work adds a macOS specialization of the existing inquiry
isolation owner. It admits finite, deployment-owned Zig module graphs and an
independent executable harness. It does not execute a repository's `build.zig`.
Its current application witness repairs a deliberately incorrect boolean JSON
size bound in an isolated copy of Agent's real `src/model_json.zig`.

Build the two native isolation artifacts with the selected Zig 0.17.0 compiler:

```sh
zig build repository-check-runner -Doptimize=safe --prefix '/tmp/agent check runner'
zig build check-mobile-repository-zig -Doptimize=safe --summary all
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
also cannot create pthread, Mach, or workqueue threads. The trusted compiler runs
with `-j1`; subprocess-dependent compilation is outside this profile.

| Resource | Current binding |
| --- | --- |
| Compiler | Exact Zig 0.17.0 executable, library inventory, non-system dylib closure |
| Compiler memory | 1,024 MiB fatal footprint limit |
| Candidate memory | 64 MiB fatal footprint limit |
| Candidate processes / threads | One / one |
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

This slice does not yet supply the full Boundary/World/Agent profile catalog,
production deployment loader, durable check dispatch, publisher, or complete
mobile UI. The use archive includes the JavaScript adapters; automatic acquisition
and inventory binding of the native runner in the complete application package
remain part of the package work. A single JSON-bound repair does not certify
arbitrary edits elsewhere in Agent.
