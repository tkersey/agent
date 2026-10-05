# Managed publication boundary

This is the W5 storage and adapter seam, not full application qualification.
The authored proposal/approval composition and installed application remain
open in [the acceptance report](mobile-repository-acceptance.md).

Preparation writes immutable candidate and commit objects before human approval.
The proposal core binds the complete candidate, check records, task/run and
principal/tenant, authorization and validation policy, target/base, intent and
fixed commit metadata. The exact raw commit contains the core digest and intent;
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
Only the compiled protected approval construction may expose this operation in
an admitted production image. The image allowlist is an operator trust decision,
not a dynamically inferred proof that arbitrary images use approval correctly.

The existing occurrence transaction stores the exact publication intent before
Git starts. This is the local cancellation/revocation admission ordering point.
Cancellation that wins beforehand prevents admission; later cancellation does
not discard a publication result or authorize rollback. The acquired reply and
publication receipt are stored together. Receipts include proposal, destination,
tree, validation references, policy, original admission, disposition and recovery
provenance. A later current head is distinct from the published commit.

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
```

The helper installs under `repository-publication/agent-publication-gate`.
Non-macOS publication is unavailable. The runtime package includes the JavaScript
adapter; native-helper package acquisition remains part of W6. Tests distinguish
actual Git exclusion/history, real SQLite ordering, and adapter service doubles.
None of the doubles establish the application's private-grant witness.
