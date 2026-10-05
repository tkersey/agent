# Configure and operate the installed repository application

Use the extracted Agent archive and an authenticated World runtime. The setup
commands use the installed session image and inventory; they do not compile an
Agent program or ask the operator to encode protocol values.

```sh
node runtime/mobility/cli.mjs repository-template setup.json
node runtime/mobility/cli.mjs provision-repository provision.json > provision-receipt.json
node runtime/mobility/cli.mjs qualify-check check.json > qualification.json
node runtime/mobility/cli.mjs configure-repository setup.json configured
```

Fill the explicit placeholders in `setup.json` with approved identities, key and
certificate paths, peer addresses and fingerprints, repository provisioning
receipt, check configuration, qualification result, commit metadata and bounds.
The [setup template](mobile-repository-setup.example.json) contains the complete
input structure. The [check-profile documentation](mobile-repository-zig-profile.md)
describes `provision.json` and `check.json`. All input paths resolve relative to
the file containing them; check-runner paths resolve relative to `check.json`.

The template sets `provider.enabled` to `false`. In that state generation emits
no model binding and no runnable task entry. To enable tasks, supply an explicitly
approved `openai-responses-replay` profile as `provider.profile` and set `enabled`
to `true`. Its owner is the workspace host; its model and parameters become the
immutable task template. Endpoint credentials remain a local environment lookup.
The provider profile, disclosure and allowance fields are documented in
[model integration](mobile-repository-model.md). Template creation and configuration
generation do not contact a model provider or generate/trust certificates.

Generation verifies the selected installed image and schema hashes, reads the
managed repository's actual scope, admits the check manifest, and obtains the
program identity from the installed image under the authenticated runtime. It
writes `origin.json`, `workspace.json`, `initial.bin`, and `cleanup.bin` into a
new directory. Existing output directories are refused. The qualification result
supplies pinned configuration identities; deployment startup independently
qualifies that runner again. Generation is not a certificate that remote hosts
are available or that every operator-supplied path exists on those hosts.

Copy the generated configuration directory to the corresponding hosts. Preserve
its relative `initial.bin` and `cleanup.bin` paths. Installation, runtime, key,
TLS and private-storage paths must exist at the configured host-specific locations.
Keep the issuer's private key at the origin; the workspace configuration refers
only to its own private signing key and the issuer's public key.

Initialize each host's storage explicitly, then use the existing service command:

```sh
node runtime/mobility/cli.mjs validate configured/origin.json
node runtime/mobility/cli.mjs validate configured/workspace.json
node runtime/mobility/cli.mjs init configured/origin.json
node runtime/mobility/cli.mjs init configured/workspace.json
node runtime/mobility/cli.mjs serve configured/workspace.json
node runtime/mobility/cli.mjs serve configured/origin.json
```

Run each `serve` command on its configured host. The browser uses the origin's
configured audience and public origin. Issue a one-use reference login locally:

```sh
node runtime/mobility/cli.mjs login-issue configured/origin.json PRINCIPAL TENANT
```

`validate` reuses startup preparation but never opens a custody journal or session
store. It checks configuration, runtime and installed contracts, signer/key/TLS
bindings, declared limits and local catalogue capabilities. Configured repository
checks repeat their existing runner qualification in temporary scratch; no run,
repository publication or provider call occurs. Its report explicitly scopes
local validation and does not claim remote availability.

After the peers are serving, opt in to their existing authenticated preflight:

```sh
node runtime/mobility/cli.mjs validate configured/origin.json configured/workspace.json --peers
```

The peer configuration supplies expected capability metadata; validation does
not open its remote files or require its private keys locally. It checks the
actual placement requirements and full selected workspace contract against the
running peer. The probe registration is signed but never registered or executed.
Preflight is an observation, not a promise about future availability; normal
dispatch, disclosure, budgets and current authority remain independently checked.

Clarification is an ordinary authenticated question, separate from approval.
Generated origins include its text-answer binding. A question preserves the
unfinished investigation while it visits the person and returns to the workspace.
Each extra round trip uses two moves. `task.moves` defaults to four for compatibility;
an operator can explicitly select up to sixteen (for example, six for a
clarification followed by publication). Model/check allowances remain separate
and cumulative; generation never silently enlarges the supplied model allowance.

Each task also has a 512 KiB working-text allowance. Context, staged edits,
candidate/check records, tool-result text and the full proposal share that budget;
rendered prompts and new query text are admitted before dispatch. Provider replay
has its separate 2 MiB bound. A candidate can meet the individual file/path limits
and still exceed the combined budget. Capacity failure returns the typed
`capacity_exceeded` outcome. The program reserves space for bounded human answers
and publication receipts before requesting them.

This is logical working-data accounting. Checkpoint encoding and its copies remain
subject to the existing World and journal limits.

After login, the browser offers the authorized repository and defaults to
`propose`. Alternatively, with the local service stopped, list/start a task through
trusted CLI intake; the catalogue encodes the task and signs the registration:

```sh
node runtime/mobility/cli.mjs tasks configured/origin.json PRINCIPAL TENANT
node runtime/mobility/cli.mjs task configured/origin.json PRINCIPAL TENANT repository propose 'Describe the bounded change'
```

The browser drives the same authored computation. Only `publish` requests exact
human approval and may advance the managed ref. Task start, reconnect and export
do not themselves publish.

A completed result can be exported locally as JSON:

```sh
node runtime/mobility/cli.mjs export configured/origin.json PRINCIPAL TENANT RUN_ID > result.json
```

Export checks the run's principal/tenant, current deployment grant, catalogue
audience and whole-state classification. It includes the run, image, program and
outcome identities, the exact typed report (including its proposal and publication
result), and any locally retained publication receipt. It does not execute the
computation. An unfinished run without a retained publication receipt is not a
completed result. Browser download remains available through the same catalogue.

The extracted deployment test fills the shipped template with isolated fixture
resources and uses these commands for all three modes over two local TLS hosts
and the real Chromium UI. It also checks disabled inference, invalid scope/limits,
refusal to overwrite output/storage, and rejection of another principal's export.
This is deterministic qualification, not authorization for live inference or
actual two-machine operation. Application qualification is available through the command below; external
qualification remains subject to its explicit inputs and opt-ins.

## Application qualification

```sh
node runtime/mobility/cli.mjs qualify-application qualification.json evidence-directory
```

The [qualification example](mobile-repository-qualification.example.json) defaults
to the offline lane. Local `offline`, `browser`, and `package` lanes run the
existing fixed repository verifier targets, sequentially, against an explicitly
selected source checkout and Zig distribution. They retain command outcomes and
bounded logs with hashes; source changes during a lane invalidate qualification.
The output directory must be new. Local engineering lanes deliberately require
the approved source checkout; deployed execution has no authoring fallback.

For an external lane, set `source` to `null` and select exactly one of `deployed`
or `live`. Add an `external` object with `origin` (initialized origin config),
`peers` (expected peer config paths), `principal`, `tenant`, and `cases`.
Each case fixes `id`, catalogue `entry`, exact `base`, `mode`, `goal`, and an
independent `expected` object before execution:

```json
{
  "id": "approved-inspection",
  "entry": "repository",
  "base": "REPLACE_WITH_APPROVED_BASE_COMMIT",
  "mode": "inspect",
  "goal": "Inspect the approved repository scope.",
  "expected": { "kind": "completed", "proposalTree": null, "published": false }
}
```

A repair's expected tree must be independently fixed; a publishing case also
requires `published: true`. The matcher checks the typed publication branch and
its exact proposal/commit/tree correspondence, not a success claim in model text.
Expected failures remain recorded as actual failed/cancelled outcomes even when
they satisfy the predeclared contract. Passing selected cases is not a general
model-success rate or completion of the entire acceptance matrix.

```sh
node runtime/mobility/cli.mjs qualify-application deployed.json evidence-directory --deployed
node runtime/mobility/cli.mjs qualify-application live.json evidence-directory --live
```

Opt-ins are checked before opening hosts or creating output. `deployed` requires
deterministic loopback provider profiles; `live` requires an explicitly configured
live profile. Missing opt-ins do not trigger a fallback. A failed selected local
lane prevents a subsequent external lane from starting.

Use a dedicated, initialized origin with no prior runs, stop its ordinary local
service, and start the configured workspace peer separately. The qualifier runs
the normal origin service, preflights the peer and registers corpus cases through
the catalogue. It prints each run ID and browser address. Use an operator-issued
login and the shipped browser UI; the qualifier never supplies answers or approval.
All cases, including those not started, remain in `report.json`.

`maximumSeconds` bounds each local verifier and each external wait. A wait deadline
reports `incomplete` and the durable run ID; it does not cancel, reset or roll back
the run. Use the existing serve/status/cancel commands to handle that run afterward.
The report includes origin metrics. Workspace physical attempt/usage records must
also be retained using the workspace's `metrics` command for a complete live or
two-machine evidence record. No external/live/person qualification is implied by
local verifier success or by the presence of this command.
