# Mobile Repository Agent

The installed application inspects a bounded immutable repository snapshot,
proposes checked edits, or publishes an exactly approved commit to a private
managed Git ref. It does not change the original checkout or push upstream.
The authored program owns the investigation and review; the hosts supply capabilities.

Use an extracted Agent use archive and its authenticated World runtime. The current
native check/publication profile is qualified on Darwin arm64. Unsupported hosts
fail explicitly. Deterministic browser/package checks pass; actual-person,
two-machine and live-provider qualification have not run. See
[acceptance and measurements](mobile-repository-acceptance.md).

## Configure

From the extracted archive:

```sh
node runtime/mobility/cli.mjs repository-template setup.json
node runtime/mobility/cli.mjs provision-repository provision.json > provision-receipt.json
node runtime/mobility/cli.mjs qualify-check check.json > qualification.json
node runtime/mobility/cli.mjs configure-repository setup.json configured
```

Fill the placeholders in `setup.json` with approved identities, key/certificate
paths, pinned peers, provisioning receipt, check configuration/result, commit
metadata and bounds. The [setup template](mobile-repository-setup.example.json)
is the complete input structure. Paths resolve relative to their containing JSON
file; helper paths resolve relative to `check.json`. No protocol encoding or
application compilation is required.

`provision.json` contains:

| Field | Meaning |
|---|---|
| `directory` | New private managed-store directory; existing storage is refused. |
| `sourceGitDirectory`, `base` | Local Git directory and exact commit to import; no fetch or dirty checkout content. |
| `gitExecutable` | Selected Git executable. |
| `repository`, `generation` | Operator-assigned repository and provisioning identities. |
| `managedRef` | The one permitted destination ref, such as `refs/heads/agent/result`. |
| `readPaths`, `writablePaths` | Explicit path arrays; optional `protectedPaths` excludes harnesses from editing. |
| `limits` | Optional per-tree/read/candidate bounds. |
| `storage` | Optional lifetime object limits; default `{"bytes":268435456,"files":65536}`. |

New stores use `agent-managed-repository/v2`. Earlier preview stores without
lifetime limits are refused; preserve them for recovery and provision a new
generation rather than editing their manifest. Object capacity counts regular-file
lengths under `objects.git/objects`, including compressed and abandoned temporary
files. It excludes allocation blocks/directory overhead. Reservations may refuse
an object conservatively near capacity; verified existing objects remain reusable.
Capacity failure never deletes recovery data or advances the ref.

`check.json` contains `sandbox` and `checkProfile`. Copy the JSON object from one
of these packaged manifests into `checkProfile`:

| Manifest under `runtime/repository-profiles/` | Independent contract |
|---|---|
| `boundary.wire-natural.v1.json` | Bounded natural-number encoding/decoding in `src/data/wire.zig`. |
| `world.allocation-budget.v1.json` | Limit, live/peak, free/reuse/reset behavior in `src/interpreter_v2/allocation_budget.zig`. |
| `agent.model-json-bounds.v1.json` | Boolean/integer JSON length bounds in `src/model_json.zig`. |

The sandbox names `zigExecutable`, `libraryDirectory`, `launcher`, `processLock`,
private mode-0700 `scratchRoot`, `timeoutMs`, `maximumOutputBytes` and `scratchBytes`.
Each helper is `{ "path": "...", "sha256": "..." }`; the archive's `SHA256SUMS`
identifies `agent-check-limit`, `libagent-check-lock.dylib` and
`agent-publication-gate` under `examples/native/`. The selected Zig 0.17.0 executable and library are pinned.
Qualification prints the runner/profile identities and fails if isolation is
unavailable. Startup independently qualifies the runner again; it never builds
helpers or substitutes another profile.

These profiles execute a finite portable module graph and protected observation
harness, not the repository's `build.zig` or its whole test suite. A passing narrow
profile cannot validate an unrelated change. The compiler produces import-free
Wasm; a pinned Node observer returns actual values, and the host compares them to
its independent expectations. Candidate-controlled output/exit cannot certify a
pass. No network, credentials, original checkout, authoritative Git or journal
access is granted to the compiler or candidate.

Default bounds are a shared 30-second compile/execute deadline, 256 KiB output,
1,024 MiB compiler and 64 MiB observer footprint limits, and 16 MiB Wasm memory/module
limits. Scratch uses four durable slots, each with a default 256 MiB private APFS
image. Process death or uncertain detach retains its slot; only successful
post-reap cleanup releases it. Legacy `agent-zig-*` directories block allocation
until their processes/mounts are reconciled. There is no age-based deletion.
Four default slots conservatively reserve at most 2.5 GiB of file content; the
1 GiB image ceiling permits at most 8.5 GiB. These are content reservations,
not physical disk-allocation measurements. Journal quotas remain independent.

## Select the provider

The setup template has `provider.enabled: false`. It emits no model binding or
runnable catalogue entry in that state. To enable tasks, explicitly supply
`provider.profile` and set `enabled: true`. There is no default live model/key.
This example is a local fixture profile, not a live-provider authorization:

```json
{
  "kind": "openai-responses-replay",
  "owner": "W",
  "mode": "loopback-fixture",
  "endpoint": "http://127.0.0.1:9000/v1/responses",
  "credentialEnv": null,
  "model": "fixture-model",
  "parameters": { "maxOutputTokens": 1024, "temperature": null, "reasoning": null },
  "timeoutMs": 1000,
  "maximumRequestBytes": 2097152,
  "maximumResponseBytes": 2097152,
  "disclosure": { "audience": "fixture-provider", "policyRevision": "p1", "labels": ["shared"] },
  "allowance": { "attempts": 8, "request_bytes": 16777216, "output_tokens": 8192, "concurrent": 1 }
}
```

`openai-live` requires the exact HTTPS OpenAI Responses endpoint, an approved
model/parameter selection, disclosure grant, positive budget and selected local
credential environment variable. A present key is not authorization to spend or
disclose source. Keys stay at W and are read only at dispatch. Loopback fixtures
reject credentials; redirects, streaming and background provider jobs are unsupported.
Configuration generation itself makes no provider call or trust-store change.

The model leaf preserves complete supported replay items and tool/result pairing
using `store: false`, without a provider conversation or previous-response ID.
Missing/unsupported continuity or capacity overflow fails explicitly. Replay remains
subject to whole-state classification. Attempts, request bytes and reserved output
tokens are charged before dispatch and survive restart; ambiguous calls are not
repeated or refunded. Usage observations are not a dollar-cost estimate.

## Start and use

Generation writes `origin.json`, `workspace.json`, `initial.bin` and `cleanup.bin`
into a new directory. Copy the configurations and relative binary inputs to the
corresponding hosts. Host-specific runtime, key, certificate and private-storage
paths must exist there. Keep the issuer private key at the origin; W gets its own
private signing key and only the issuer's public key.

Initialize storage explicitly, then run each service on its configured host:

```sh
node runtime/mobility/cli.mjs validate configured/origin.json
node runtime/mobility/cli.mjs validate configured/workspace.json
node runtime/mobility/cli.mjs init configured/origin.json
node runtime/mobility/cli.mjs init configured/workspace.json
node runtime/mobility/cli.mjs serve configured/workspace.json
node runtime/mobility/cli.mjs serve configured/origin.json
```

`validate` checks runtime/contracts, keys/TLS, limits and local catalogue bindings
without opening custody/session stores or starting a task. Native runner checks
use temporary qualification scratch. Once peers are serving, verify their live
capabilities through authenticated preflight:

```sh
node runtime/mobility/cli.mjs validate configured/origin.json configured/workspace.json --peers
node runtime/mobility/cli.mjs login-issue configured/origin.json PRINCIPAL TENANT
```

Preflight does not register a run, contact a provider or promise future availability.
Issue a login only for an existing deployment grant. Deliver its one-use credential
privately; the person enters it at the printed origin's `/login` page, not in a URL.
It expires after ten minutes; the authenticated session lasts eight hours and is
checked on every request. Login issuance can run while the service is active.

The browser shows the person's authorized repository, base, scope, check profile
and allowances. It defaults to `propose`. The person supplies a goal and mode,
starts the task, and uses Continue to advance/check progress. Source, questions
and complete diffs are rendered as text. Clarification resumes the retained
investigation. A review question permits inspection; an amendment discards the old
candidate/check and requires fresh checking and approval. Reconnect after a service
restart preserves the pending question; conflicting or stale answers are rejected.

A task stages at most four files within its granted scope. Context, edits,
candidate/check records, tool results and complete proposal share a 512 KiB
logical working-text allowance; designated provider replay has a separate 2 MiB
bound. World encoding/memory and journal limits remain separate. Individual file
limits do not guarantee that the combined proposal fits. Typed `capacity_exceeded`
stops before further checking/approval as appropriate. Human-answer and publication
receipt space is reserved before requesting them.

Logical steps, up to eight candidate generations, up to sixteen checks and physical
host allowances remain bounded across review/restart. A clarification adds two
moves. `task.moves` defaults to four; an operator can select up to sixteen, such
as six for clarification followed by publication. Generation never silently widens
grants. Repeated sessions contain at most sixteen tasks with fresh investigation
state and cumulative host charges. Changing the base or scope requires a new
explicitly authorized session.

Only `publish` can advance the configured managed ref. Approval binds the exact
commit, base, diff, checks, principal and policy. Git uses the old-value precondition
under the pinned writer gate; stale/conflicting history is not rebased or retried.
The durable intent precedes dispatch. Cancellation before admission prevents the
write; later cancellation preserves its result. Lost replies use read-only
reconciliation, never another publication attempt. Unknown results remain paused.

Confirmed publication remains `Published` even if subsequent verification fails or
is unavailable; the receipt distinguishes `PublishedVerified`,
`PublishedVerificationFailed` and `PublishedVerificationUnavailable`. A failed
return can leave presentation pending without undoing the commit. Postchecks verify
Git ref/object identity, not additional program behavior. Nothing here changes the
original checkout, `main`, an upstream branch or a GitHub PR.

With the local custody service stopped, trusted CLI intake can list/start the same
catalogue tasks. These local identity arguments are not remote authentication:

```sh
node runtime/mobility/cli.mjs tasks configured/origin.json PRINCIPAL TENANT
node runtime/mobility/cli.mjs task configured/origin.json PRINCIPAL TENANT repository propose 'Describe the bounded change'
node runtime/mobility/cli.mjs export configured/origin.json PRINCIPAL TENANT RUN_ID > result.json
```

Export checks identity, grants, audience and whole-state classification. It returns
the exact typed report/proposal and any retained publication receipt with run,
image, program and outcome identities. Export does not execute or publish. Browser
download is available through the same catalogue.

## Qualification

```sh
node runtime/mobility/cli.mjs qualify-application qualification.json evidence-directory
```

An offline input has this shape; paths must identify the approved source/toolchain:

```json
{
  "format": "agent.repository.qualification/v1",
  "lanes": ["offline"],
  "maximumSeconds": 1800,
  "source": {
    "directory": "/approved/agent",
    "commit": "EXACT_COMMIT",
    "zigExecutable": "/approved/zig",
    "libraryDirectory": "/approved/zig-lib",
    "boundarySource": "/approved/boundary",
    "worldSource": "/approved/world",
    "worldRuntime": "/approved/world-runtime",
    "browserTools": "/approved/browser-tools",
    "prefix": "/new/qualification-output"
  },
  "external": null
}
```

Local `offline`, `browser` and `package` lanes run fixed verifier targets serially
and retain bounded logs/outcomes with source/artifact hashes in a new output
directory. Source changes invalidate a lane. These engineering lanes require source;
the installed application's execution has no authoring fallback.

For exactly one external `deployed` or `live` lane, set `source: null` and supply
`external` with initialized `origin`, expected peer configuration paths in `peers`,
`principal`, `tenant` and predeclared `cases`. Each case fixes `id`, catalogue
`entry`, exact `base`, `mode`, `goal` and an independent `expected` object, for example
`{"kind":"completed","proposalTree":null,"published":false}` for inspection.
A repair needs an independently fixed expected tree; publication also requires
`published: true`. Matching model text is not proof of success.

```sh
node runtime/mobility/cli.mjs qualify-application deployed.json evidence-directory --deployed
node runtime/mobility/cli.mjs qualify-application live.json evidence-directory --live
```

Opt-ins are checked before host/output access. Deployed fixtures require loopback
providers; live requires an explicitly authorized live profile. Use a dedicated
initialized origin without prior runs, stop its ordinary service, and start W
separately. The qualifier serves the origin, preflights W and registers cases. It
prints run IDs/browser addresses but supplies no human answers or approvals.

A wait deadline records `incomplete` and leaves the durable run active. Use the
normal serve/status/cancel commands afterward; there is no rollback or restart from
initial inputs. Keep W's physical attempt/usage metrics alongside the origin report.
Unstarted/failed cases stay visible. Passing fixtures does not establish live-model
usefulness, actual-person behavior, two-machine qualification or a general success rate.
