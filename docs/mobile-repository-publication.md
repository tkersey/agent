# Managed publication boundary

This is the W5 publication composition, not full application qualification.
The complete investigation application and installed delivery remain open in
[the acceptance report](mobile-repository-acceptance.md).

Preparation writes immutable candidate and commit objects before human approval.
The proposal core binds the complete candidate, check records, task/run and
principal/tenant, authorization and validation policy, target/base, intent and
fixed commit metadata and complete ordered before/after content. The exact raw commit contains the core digest and intent;
the final proposal adds its Git OID and full-byte SHA-256. Verification rebuilds
these identities and reads stored objects without writing new objects.

The private managed repository has a persistent, inode-bound `publication.lock`.
On the qualified macOS profile, `agent-publication-gate` acquires an exclusive
nonblocking `flock`, reports acquisition, and waits for one command byte. After
admission it uses `execve` to become the pinned Git executable, retaining the
lock descriptor. There is no separate Git child that can outlive a lock holder.
EOF before execution means no write; a timeout kills and reaps the still-owned
process. Recovery never uses elapsed time or a saved PID as evidence of death.
The actual pinned Git was tested with a prepared transaction stopped across
parent death: a contender remained excluded until Git finished.

While holding the gate, the store verifies the exact proposal and every managed
ancestor back to the provisioned base against saved intents. Previously acquired
Published receipts must remain in that history. Unknown commits, missing intent
history and witnessed rewinds fail closed. A stale base returns Conflict without
publication admission. Git performs one `update-ref --no-deref` with the exact
old-value precondition. There is no retry or automatic rebase.

The deployment adapter `repository-publication` requires exact admitted image
and program identities, the existing store manifest, the pinned helper, current
authorization/validation identities, required profile and runner digests, and
the repository-check result schema. It rechecks current policy while holding
the gate. Validation must exactly match results acquired by the current run's
existing custody journal; self-consistent proposal hashes are insufficient.
The check contract is `{ status, record }`: an enum distinguishes all seven
runner outcomes while the canonical record retains the exact validation binding.
The authored composition returns a check failure before preparing a proposal or
asking for approval unless the status is Passed. Publication rejects disagreement
between that typed status and the acquired canonical record.
Only the compiled protected approval construction may expose this operation in
an admitted production image. The image allowlist is an operator trust decision,
not a dynamically inferred proof that arbitrary images use approval correctly.
It also supplies the read-only `agent.repository.publication-current.v1` leaf.
The commit result uses the approval owner's four-way outcome contract:
Published, Conflict, NotApplied, or uncertain. An unsettled environmental write
stays in custody rather than manufacturing an uncertain reply and continuing.

The existing occurrence transaction stores the exact publication intent before
Git starts. This is the local cancellation/revocation admission ordering point.
Cancellation that wins beforehand prevents admission; later cancellation does
not discard a publication result or authorize rollback. The acquired reply and
publication receipt are stored together. Receipts include proposal, destination,
tree, validation references, policy, original admission, disposition and recovery
provenance. A later current head is distinct from the published commit.
An already admitted intent or exact commit cannot be admitted again through a
new occurrence. A definitive nonapplication requires a fresh proposal/intent
and approval before another publication attempt.

On restart, the custodian invokes only the binding's read-only reconciler for an
uncertain publication occurrence. It does not call its publication handler again.
The gate excludes a surviving old writer. Exact historical presence yields
Published; proven absence yields NotApplied or Conflict. Missing/malformed
history remains an error and the occurrence stays uncertain. Revocation can
prevent new writes without erasing a previously admitted write's result.

Build and exercise this seam with:

```sh
zig build repository-publication-gate check-repository-publication-gate \
  -Dworld-source=/path/to/world -Dworld-runtime=/path/to/runtime
zig build check-repository-approval -Dworld-source=/path/to/world \
  -Dworld-runtime=/path/to/runtime -Dbrowser-tools=/path/to/locked-browser-tools
```

The helper installs under `repository-publication/agent-publication-gate`.
Non-macOS publication is unavailable. The runtime package includes the JavaScript
adapter; native-helper package acquisition remains part of W6. Tests distinguish
actual Git exclusion/history, real SQLite ordering, and adapter service doubles.
The separate compiled approval witness uses the real private-grant construction,
two custodians, actual successor checkpoints, SQLite and Git. Its independent
content check and human response are deterministic fixtures, not live-model or
actual-person qualification. It covers stale answers, wrong principals, and
restart after publication with a lost reply without repeating the protected leaf.

`repository-approval-issuer` binds its fresh nonce to the current occurrence.
`repository-approval-human` uses the existing deferred-answer journal and session
authentication; `principalIds` maps admitted principal names to the image's
ordinary numeric identity. The reply contains the exact retained challenge and
authenticated principal. It never exposes the private grant. The browser shows
the destination, exact base/commit/proposal identities, checks, and complete
before/after source using inert text. Approve requires an explicit selection.
Chromium and Firefox cover authenticated login and complete proposals exceeding
64 KiB. Pending question artifacts are bounded at 2 MiB; answer limits remain
unchanged. Ordinary free-text deferred questions retain their existing behavior.

## Application composition

The full mobile program uses the same private approval construction. A portable
region cell retains the placement hook's returned move allowance for the final
return; the hook's boolean result cannot reset the caller's budget. The cell carries
no external handle or approval token.

`repository-proposal` accepts the exact candidate and check record with task and
generation. It requires that the configured profile/runner record was acquired by
this signed run before preparing the canonical proposal. Its commit identity and
metadata are explicit deployment selections. Preparation never updates a ref.
The runtime loader also exposes `repository-prepare` for bounded staged edits and
`repository-release` for the journaled disposal of the portable investigation;
physical check children and scratch remain owned by the check runner.
