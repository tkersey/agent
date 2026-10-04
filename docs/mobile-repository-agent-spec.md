# Mobile Repository Agent
## Apply the existing mobility implementation to real repository work
### Complete post–Zig 0.17.0 implementation specification

**Version:** 1.0  
**Date:** October 4, 2026 — America/Los_Angeles  
**Primary implementation repository:** `tkersey/agent`  
**Conditional dependencies:** `tkersey/world` and `tkersey/boundary`, only for demonstrated generic deficiencies  
**Prerequisite:** the completed, qualified Zig 0.17.0 transition of Boundary → World → Agent  
**Delivery:** one coherent application, its supported deployment, tests, measurements, documentation, and implementation PR  
**Status:** implementation instructions; not a claim that this follow-on application or its qualification has already been completed.

> Make mobility useful. Move the actual unfinished repository investigation to authorized capabilities, preserve its continuation and obligations, return to a real person for exact approval, and publish only the exact validated change. Keep credentials, resource authority, and operating-system handles local.

This document is the complete handoff for the **next** task. It does not redirect the Zig migration, reopen completed mobility design decisions, or incorporate earlier specifications as hidden implementation scope. Consume their accepted results; do not implement them again. Requirements expressed as **MUST**, **MUST NOT**, and **REQUIRED** are normative. Proposed names describe implementation targets unless explicitly identified as existing exports.

## Contents

1. Product outcome and selected scope
2. Inspected foundation and migration handoff
3. Architecture and ownership
4. Deployment and trust model
5. Authored application behavior
6. Capability contracts and portable data
7. Placement, continuation, and retained investigations
8. Repository snapshots, candidates, and validation
9. Exact approval and managed-branch publication
10. Human interaction and browser experience
11. Model integration and provider continuity
12. Durable effects, recovery, and cancellation
13. Classification, disclosure, and authority
14. Resource bounds and lifecycle management
15. Configuration, commands, and packaging
16. Required end-to-end witnesses
17. Acceptance matrix
18. Fault injection and bounded models
19. Performance, usefulness, and comparison
20. Implementation sequence and PR discipline
21. Evidence and completion criteria
22. Non-goals and extension boundaries
23. Sources and provenance
24. Direct coding-agent handoff

---

## 1. Product outcome and selected scope

### 1.1 The deciding result

A person opens an authenticated browser application, selects an authorized repository and base revision, and requests a bounded change. An Agent program executes in a browser Worker under a durable origin custodian. When it needs repository/model/test capabilities absent there, it uses the existing typed mobility constructions to relocate to the workspace custodian. It investigates real source, proposes a concrete change, validates that exact candidate, and returns its **actual successor checkpoint** to a fresh browser Worker.

The person sees the exact diff, provenance, limitations, and checks. Approval is bound to that proposal, principal, repository, base, destination, and current task occurrence. The same computation returns to the workspace host carrying the existing private one-shot approval grant. It revalidates current authority and applicability, consumes the grant through the existing approval construction, and publishes the exact candidate to a narrowly authorized **managed Git branch**. It verifies the publication and returns a receipt to the person.

Loss of the original browser Worker, workspace executor, or service process MUST NOT require replaying the task from its initial arguments, reconstructing control from a transcript, or asking the model what the application was doing.

### 1.2 What “delivery” means

The supported mutation in this version is publication to a service-owned branch in a private managed repository. The target is visible before approval. Publication does **not** mean updating the user's active working tree, pushing to a remote, opening an application-created PR, merging, deploying, or modifying `main`.

The user receives an inspectable commit identity, exact patch/artifact, validation record, and publication receipt. Promotion into another checkout or upstream repository is a separate explicit operation outside this version. Do not present a managed-branch commit as an upstream change.

Investigation is allowed to create bounded scratch files, candidate objects, build outputs, and journal records under the run's preauthorized preparation scope. “No write without approval” means **no publication or mutation of the authoritative delivery target without exact approval**, not that compilation, journals, and temporary preparation perform no filesystem writes.

### 1.3 Required modes

| Mode | Required result | Publication authority |
|---|---|---|
| `inspect` | Evidence-backed findings and a truthful account of checked and unchecked claims. | None. |
| `propose` | Exact bounded patch plus validation disposition; download/export without publication. | None. |
| `publish` | The same proposal path followed by explicit human approval, destination revalidation, conditional managed-branch publication, and receipt. | Exact proposal only. |

All three modes use the same authored application and capability owners. Do not create three host-side workflows. `propose` is the initial UI default. A model cannot change the selected mode or grant itself publish authority.

### 1.4 Required capability breadth

The application MUST support bounded, ordinary UTF-8 repository inspection and changes to multiple regular files. Do not restrict the product to the old `session.mjs` or `src/range.mjs` fixture, hard-code a known repair, or require the model to select from a catalog of solutions.

The default candidate supports up to **four changed regular files**, matching the existing repository environment's small writable scope rather than silently widening it. Create, replace, and delete are supported within explicit path grants. Renames are represented as an explicit deletion and creation; binary files, executable-mode changes, symlinks, submodules, and arbitrary Git operations are excluded.

A qualified Zig 0.17.0 repository-check profile is REQUIRED so the application can perform bounded work against admitted snapshots of Boundary, World, and Agent, not merely JavaScript demonstrations. Existing fixture executors remain useful regressions; they are not evidence that arbitrary Zig builds are already isolated or supported.

### 1.5 Product requirements versus execution authorization

The implementation MUST include real provider integration, real authenticated human interaction, and executable two-host qualification. Deterministic tests remain the mandatory unattended default.

This file does not authorize paid model calls, use of production credentials, source disclosure to a provider, mutation of a real user repository, provisioning infrastructure, or contacting an unapproved host. Execute live/deployed qualification only within explicit preexisting or newly supplied operator authorization. Missing credentials or hosts do not justify replacing required functionality with fixtures; implement it, run independent available checks, and report the exact external qualification blocker.

---

## 2. Inspected foundation and migration handoff

### 2.1 What is already implemented

The following are observations of inspected repository sources, not new work requirements to recreate:

| Foundation | Observed implementation | Consequence for this task |
|---|---|---|
| Agent mobility | PR #41 merged October 3, 2026; merge commit `4393e04393b97f018c02df7be995851c1c22bb82`. Typed placement, complete continuation transfer, durable custody, browser/Node handoff, and approval placement are present. [S1–S2] | Reuse the implementation and inherited regression suite. |
| Migration candidate | Agent PR #42, inspected head `0fff382ae65a93811a61b523573f254635a4fde1`, remains a migration candidate, not this task's final dependency pin. Its qualification was reopened following the toolchain-wrapper finding. [S3] | Begin implementation only on the subsequently accepted final stack. |
| Deployable mobility environment | `runtime/mobility/deployment.mjs` verifies the runtime before import and constructs the journal, policy, custodian, peers, and bounded pump. Its inspected adapter loader supports `fixed-reply`, `text-file`, and `text-close`. [S4] | Integrate actual model, repository, test, and human bindings here; do not add another deployment engine. |
| Custodian | `runtime/mobility/custodian.mjs` owns admission, dispatch, current occurrences, resident execution, and publication. The inspected ordinary dispatch waits for reply bytes and marks failed dispatch unknown. [S5] | A real human wait needs a durable deferred-reply seam, not a JavaScript promise retained for hours. |
| Repository leaves | `runtime/repository.mjs` provides scoped list/read/search/test/current/replace; its test executor is explicitly qualified only for the range fixture. [S6] | Reuse contracts and safety owners; add real snapshot/profile support without advertising the fixture as a general runner. |
| Existing delivery | `runtime/repository_delivery.mjs` uses document safety and an isolated-root/cooperative-writer contract for a single file. [S7] | Preserve that behavior for existing consumers; it is not a multi-file repository transaction. |
| Inquiry | Inquiry composition, retained investigations, candidate checking, protected delivery, and an opt-in model-backed CLI exist. [S8–S9] | Reuse the authored pieces and model normalization, not the old CLI's independent driving loop as a second mobility runtime. |

Some narrative documentation at the inspected candidate still refers to earlier BPI2/PST2/PKO2 measurements while executable candidate code uses BPI3/PKO3. Such historical tables are not a license to revive predecessor formats or reuse their numbers as current results. [S8–S9]

### 2.2 Migration admission gate

Before changing production code for this task:

1. Verify the accepted landing/readiness of the migration in dependency order: **Boundary #164 → World #62 → Agent #42**, or explicitly identified successors. Do not assume a closed PR was merged or that a historical “ready” paragraph overrides reopened qualification.
2. Resolve the final Agent source, Boundary source/package, World source/package/archive, runtime manifest, ABI/profile, kernel digest, compiler executable, and standard-library selection using their current owners.
3. Run the actual installed dependency verifier and package-consumer preflight. Reject a mixed tuple, stale archive, unauthenticated kernel, expired-only uncached delivery, or a source ID substituted without rebinding its dependent receipts.
4. Establish that existing mobility, approval, continuation, inquiry, repository, and packaged execution checks pass on this selected tuple. Reuse exact-subject receipts where current workflow permits; rerun when their subject changed.
5. Record the selected tuple in the normal acceptance report and lock owners. Do not add a competing lock file or runtime downloader.

The old mobility kernel hash and the in-flight migration artifact IDs are **not** normative pins in this specification. Final accepted artifacts supersede them. A new kernel is not automatically compatible with an existing running checkpoint merely because its portable bytes look familiar.

### 2.3 No retasking of in-flight work

Do not edit the migration branches to incorporate this application. Do not initiate another Zig upgrade. Prepare fresh follow-on worktrees from the accepted result. If the prerequisite is not complete, finish source analysis/spec placement and other genuinely independent work, report the blocker, and leave migration ownership intact.

---

## 3. Architecture and ownership

### 3.1 One execution model

| Owner | Responsibilities | Forbidden additions |
|---|---|---|
| Boundary | Generic typed computation, effects, ownership/capture checking, compiled image and portable codecs. | Repository workflow, network endpoints, approval UI, custody database, Agent-specific opcodes. |
| World | Generic evaluator, native/WASM execution, admission, resident lifecycle, checkpoint/restore. | Repository scheduler, browser session service, Git adapter, provider clients, workflow state. |
| Agent authored program | Goals, questions, investigation policy, tool selection, placement, budgets, revision, approval composition, outcome interpretation, cleanup. | Credentials or host closures captured in portable state. |
| Existing Agent mobility environment | Durable custody, occurrence fencing, authenticated transport, deferred external replies, dispatch, executor verification. | An `investigate → approve → apply` phase machine outside the image. |
| Environmental adapters | Repository snapshots, provider transport, isolated checks, human answer intake, conditional publication. | Deciding which investigation or application action happens next. |
| Operator | Identities, trust roots, resource grants, code-execution profiles, provider egress, repository mapping, storage and deployment qualification. | Implicit authority inferred from model text. |

A generic journal state such as `WAITING_EXTERNAL` is permissible environmental lifecycle state. A host column such as `next_workflow_phase = 'approve'` that reconstructs application control is not.

### 3.2 Selected topology

Two logical custodians are sufficient:

- **U — interaction origin:** durable origin service, authenticated browser sessions, human reply capability, ephemeral Worker executors. No repository filesystem or model credentials.
- **W — workspace:** durable Node service, managed Git repository, scoped snapshots, isolated check runner, model adapter with locally held credentials, and managed-branch publisher. No ability to invent human approval.

An external model provider is an environmental endpoint, not a third agent host. Do not add a dedicated model custodian to manufacture another hop. Additional placement candidates are admissible only when actual grants, artifact access, and cleanup support make them genuinely substitutable.

### 3.3 Reuse and ablation

Prefer extending the smallest existing owner over adding a new module. New modules are justified where they isolate a concrete invariant, such as snapshot admission or a Git publication boundary; not merely because this document has a corresponding section.

There MUST be one production path for the new mobile application. Reuse model transport/normalization from `runtime/model.mjs`, repository/document safety, inquiry constructions, approval, and `runtime/mobility`. The old inquiry CLI may remain supported for its distinct existing consumer, but the new app MUST NOT embed or copy its `runInquiry` loop, output-directory checkpoint progression, per-invocation budget reset, or broad kernel-limit setup.

Do not create a fourth repository, generic distributed workflow framework, new continuation envelope, new global registry, or a replacement custody protocol. Application data schemas do not constitute a new execution format.

### 3.4 Conditional core repairs

Boundary/World changes require an executable deciding test demonstrating a missing **generic** capability or defect. State the invariant, reproduce the failure, repair its existing owner, and prove the Agent consumer needs that repair. A convenient application-specific shortcut is not sufficient.

Default PR count: **one Agent PR**. If a generic repair is necessary, add only the affected core PRs, link their dependency, and rebind/requalify downstream artifacts in the existing order.

---

## 4. Deployment and trust model

### 4.1 Trust boundary

The supported deployment consists of cooperating authenticated hosts running admitted code. Any host that stores or executes a plaintext checkpoint is inside that checkpoint's confidentiality boundary. This design does not protect private source from a malicious admitted custodian, compromised operating system, or compromised signing authority.

The reference installation has distinct host signing keys, distinct TLS keys, pinned peer identities, explicit issuers, a tenant/principal mapping, independent deployment generations, private persistent journal directories, and approved runtime/image identities. Reuse the implemented mobility policy and transport. [S2, S4–S5]

### 4.2 Workspace ownership

The managed repository is private to the workspace service and not the user's normal clone. The service imports an explicitly approved immutable commit through a trusted provisioning operation. Ordinary model/tool calls cannot choose clone URLs, fetch refs, credentials, remotes, hooks, Git configuration, or filesystem roots.

The managed delivery branch is a direct, non-symbolic ref in an operator-authorized namespace. It is never checked out in a user-controlled worktree. The service is its sole authorized writer and advances it only through the conditional publisher. Manual rewind, deletion, force update, shared `.git` mutation, and replacement of its storage under a live identity are unsupported and must cause admission/recovery failure, not heuristic repair.

Source import is outside application execution. A default import captures tracked tree content at an exact commit. Dirty/untracked working-tree content is not silently included. Any later facility for importing such content must explicitly identify and classify the resulting snapshot.

### 4.3 Execution isolation

Repository source, build scripts, test code, and model-generated candidates are untrusted inputs. They cannot access peer/signing/provider/session credentials, journals, the authoritative Git store, or the user's checkout.

Reuse and extend the existing isolation owner where appropriate. The existing inquiry profile is a qualified macOS-specific profile, not portable evidence for arbitrary programs. Its documentation explicitly identifies limited source, runtime, process, and OS assumptions. [S8]

A new bounded Zig profile MUST be qualified with actual malicious/escape probes and pinned runtime inputs before running arbitrary admitted builds. Unsupported platforms return `EnvironmentUnavailable`; no unsandboxed fallback. A JavaScript VM, a cleared environment, and a list of allowed command strings are not by themselves the isolation boundary.

### 4.4 Reference and deployment profiles

The unattended reference profile uses two local custodian processes, isolated fixture repositories, real TLS, and deterministic provider/human fixtures. Browser tests run real Chromium and Firefox Workers.

The deployed profile uses U and W on independently running machines with persistent qualified local storage. W may remain macOS-only for executable repository checks until another isolation profile is independently qualified. U does not need the Zig compiler. A different OS on U does not establish executable-check portability on W.

Real provider use and two-machine execution are distinct qualifications; report them separately.

---

## 5. Authored application behavior

### 5.1 Program, not transcript

Construct the application using public Agent and Boundary APIs. The complete computation includes the outer task/conversation, task generation, owned inquiry or critic state, current hypothesis/candidate, placement intent, outstanding human question, approval composition, and cleanup obligations.

The environment MAY project a bounded status/view from the current typed request and existing custody metadata. It MUST NOT infer a next action by reading narrative logs or restarting at a remembered phase.

### 5.2 Task intake

The browser receives a deployment-authorized repository selector, mode, base selection, admitted scope, and execution profile options. The person supplies the goal and any acceptance expectations. Host authentication binds the real principal; a typed `principal` field supplied by a browser is never authoritative alone.

The program assigns its task generation and rejects stale answers from an earlier task. An ambiguous goal may cause clarification; ambiguity must not be resolved by silently broadening write scope. The model may propose a narrower goal or scope, but expansion beyond the grant requires a new operator/user authorization, not a natural-language assertion.

### 5.3 Investigation

At the first repository requirement, call the existing `agent.mobility.ensure` construction with the required schemas, roles, subject/version constraints, state-export policy, and remaining move budget. After arrival, acquire a frozen repository snapshot and relevant evidence through typed leaves.

Reuse the existing inquiry and/or critic compositions for retained investigations. Keep candidate selection and hypothesis revision in authored code. Do not make the host choose between hypotheses or perform domain retries.

The model can request bounded inspection, suggest experiments, propose edits, ask for clarification, revise its explanation, or stop. Each proposed action must pass the current offered-action contract and program admission. Observations and test outcomes, not confidence language, determine which claims are supported.

### 5.4 Candidate and evidence loop

The program:

1. Constructs a bounded candidate against its exact frozen base and write scope.
2. Requests canonical candidate preparation and the selected independent checks.
3. Distinguishes an actual failing check from environment failure, timeout, malformed output, or missing coverage.
4. Revises or stops within its declared work allowance.
5. Produces an immutable proposal only after the candidate and its validation disposition are known.

`inspect` may terminate without a candidate. `propose` may export a candidate whose checks are unavailable, but MUST label it unvalidated and never present it as eligible for the qualified publish path. `publish` requires the selected mandatory checks to pass; a policy waiver mechanism is not part of this version.

### 5.5 Human review and return

The application requests the human-review capability. If absent locally, its full continuation moves to U. The UI shows the actual typed proposal, including the exact diff and check coverage. The person may approve, decline, ask a question, amend the requested task, or cancel.

Questions that need more repository evidence or model reasoning are ordinary authored work. They can cause another capability-directed trip to W, not an ad hoc server callback into an untracked tool loop. An amendment invalidates the old proposal/approval. A view-only question does not silently mutate the candidate.

### 5.6 Publication and result

Use the existing approval construction's placement hook for the final move. The protected flow retains its private grant across placement, consumes it through the existing owner, and performs destination revalidation before the protected publication operation. Placement failure returns the existing denied/failure result and cannot leave a reusable approval token. [S2]

After a successful publication, the program obtains the delivery receipt and verifies its identity/tree binding. Any post-publication check is identified separately from pre-publication validation. Failed postchecks do not automatically authorize rollback or another edit.

Return to U for the final result when export is permitted. If delivery succeeded but the return is unavailable, the durable status must report **published; presentation pending**, not pretend publication failed or repeat it.

### 5.7 Repeated work

Support more than one task in a conversation/session. Each task has fresh authored generation, candidate/approval occurrences, and explicit budget allocation. Reusing a browser session does not reuse an approval or restore a spent budget. Completion disposes owned investigations/resources while retaining only the explicitly selected ordinary conversation memory.

---

## 6. Capability contracts and portable data

### 6.1 Contract conventions

Reuse existing semantic identities and schemas where their meanings match. Introduce a versioned application contract only where existing contracts cannot express the required repository snapshot/publication semantics. The names below are **semantic interface requirements**, not claims that these exports exist today.

Every environmental dispatch binds the actual run, task generation, current effect occurrence, authenticated tenant/principal, operation identity, full input/output schema, semantic role, resource identity/version, audience, and applicable policy revision. Recheck live authority at dispatch, not just during discovery.

Use existing ordinary Boundary schema/value encoding for application values. Use canonical signed mobility records only through their current protocol owner. Never silently append fields to a closed signed v1 record; a required protocol extension needs explicit version admission and rejection tests.

### 6.2 Minimum operation set

| Capability | Input / output responsibility | Authority and repeatability |
|---|---|---|
| `repository.snapshot` | Resolve an allowed repo/base to an immutable tree manifest and approved resource binding. | Read/preparation authority; no network import. |
| `repository.list/read/search` | Bounded queries over one admitted snapshot; return content hashes, exact paths, provenance, truncation/cursor information. | Read-only, snapshot-bound; no arbitrary paths or remote URLs. |
| `repository.prepare` | Validate an exact bounded edit set; materialize a candidate tree and an immutable candidate identity. | Scratch/object preparation only; not publication. |
| `repository.check` | Execute a named qualified profile on an exact base/candidate with bound limits and dependencies. | External execution/preparation; not speculative purity. |
| `model.respond` | Submit the current admitted model invocation and return normalized proposals plus replay/usage data where supported. | Provider/egress/budget authority; never executes returned tools itself. |
| `human.respond` | Present a bound question/proposal and acquire one authenticated answer. | Human identity and audience; durable deferred reply. |
| `repository.current` | Read the managed target/ref and admissibility relevant to a proposed publication. | Live read; separate from frozen evidence. |
| `repository.publish` | Conditionally advance exactly one managed ref to the approved candidate commit. | Protected mutation, fresh exact approval and current write grant. |
| `repository.publication_status` | Reconcile the exact intent against journal/managed Git evidence. | Read/recovery; never repeats publication. |
| `resource.release` | Release only explicitly owned scratch resources or pins. | Cleanup authority, limited to the original resource identity. |

The existing `resolve`, `relocate`, and `ensure` remain the placement surface. Do not add a `run_repository_workflow` tool whose implementation owns the application.

### 6.3 Ordinary record requirements

These records may be implemented through existing compositions instead of literal structs with these names. Their binding information is mandatory.

**TaskSpec** — task ID/generation, goal, mode, logical repository ID, authorized base selector, read/write scope, permitted check profiles, required checks, provider profile, intended delivery ref, policy revision, and bounded work allowance. Credentials and physical paths are absent.

**SnapshotRef** — logical repository identity, import/provisioning generation, Git object format, base commit and tree OIDs, a canonical SHA-256 manifest digest, allowed path manifest, classification, and resource-owner identity. A Git OID is not reused as a schema or authority identity.

**FileEvidence** — snapshot identity, canonical path, content digest, bounded content/excerpt, exact source range where relevant, and explicit truncation. Evidence from different snapshots cannot silently form one consistent base.

**Candidate** — base snapshot identity, canonical ordered edit set, resulting tree identity and manifest digest, candidate ID, and allowed scope. Each edit includes operation, path, expected old content/mode or absence, exact new content/mode or absence, and resulting content digest. The model cannot mint trusted candidate IDs.

**CheckRecord** — check occurrence, exact candidate/base identity, profile and runner identities, compiler/library/dependency identities, contract digest, outcome, completed required-check set, bounded diagnostics, duration, and applicability scope. A successful subprocess exit alone is not necessarily successful acceptance.

**Proposal** — task/principal binding, repository/base/candidate, exact ordered diff, target ref and expected ref version, check record digests, required check policy, consequence summary, limitations, proposal generation, publication intent ID, and fixed commit metadata. The canonical digest covers all action-relevant fields; an explanation hash alone is insufficient.

**HumanQuestion / HumanAnswer** — current question/approval occurrence, exact payload digest, permitted answer alternatives, task/run context, and authenticated audience. Authentication evidence belongs to the environment; ordinary answer text does not authenticate itself.

**DeliveryReceipt** — exact publication intent/occurrence, proposal digest, logical repo/ref, old/new commit and tree identities, actual delivery disposition, validation references, policy/version information, and recovery provenance. A receipt is not a bearer credential.

### 6.4 Path and edit semantics

Paths are relative logical paths, not OS paths. Reject absolute paths, `..`, empty components where ambiguous, NUL/control characters, `.git` traversal, platform separator aliases, case/normalization collisions on the qualified filesystem, symlinks, and special-file substitutions. Do not normalize an ambiguous path into a more powerful path.

An edit must match the old blob/mode or explicit nonexistence at the selected base. Changes outside the granted scope or unsupported modes reject before staging. The publisher verifies the complete final tree delta against that edit set so unchanged files cannot be smuggled into a prepared candidate.

JSON numbers must not round 64-bit identities, budgets, or epochs. Preserve the repository's existing integer encoding rules; use explicit decimal strings at operator JSON boundaries where necessary.

## 7. Placement, continuation, and retained investigations

### 7.1 Placement is demand-driven

Production U has no remote-tool proxy that makes every workspace effect appear local. W has no synthetic human approver. This makes the itinerary a consequence of actual capabilities rather than a predetermined hop sequence.

Use `ensure` with the immediate capability group needed by the authored computation. Its returned remaining-move value must be threaded through later calls; never reinitialize the default budget at every call. The host independently enforces the registered move ceiling. Local `Here` satisfaction must perform zero transfers. No implicit relocation may be invented because an ordinary leaf is unavailable. [S2]

Co-locate related inspection/model/check work at W when possible. Do not move for each file read, model call, or test. An authenticated capability observation is not permanent authority; dispatch rechecks current bindings after arrival.

### 7.2 Continuation requirements

At least one decisive test must relocate while retaining all of the following simultaneously:

- A non-tail outer caller with task-local values used after the return.
- An owned investigator/critic dialogue that has not finished.
- A candidate/evidence value used on the destination without re-querying the model.
- A cleanup obligation whose captured value is checked when disposed.

The result must depend on the retained values so resetting them cannot accidentally pass. Merely starting the same image with equivalent initial arguments is not mobility.

Use the existing World/Agent image, saved state, request/reply, and outcome formats. The exact successor must come from actual World execution and existing journal publication. A browser report is independently verified by the custodian's admitted runtime before it becomes authoritative. [S2, S5]

### 7.3 Host-affine resources

Do not capture processes, open files, sockets, locks, JavaScript closures, provider clients, browser objects, or OS handles. Finish and reap check processes before returning their observation or requesting relocation.

Temporary execution scratch is environmental and cleaned by its owning operation. Immutable snapshots/candidate objects are identified by content and retain explicit environmental pins; they are not live process resources disguised as portable handles. Their identifiers confer no authority by themselves.

Before moving, the complete cleanup manifest must be satisfiable at the destination. A retained investigation may use ordinary portable cleanup supported at both hosts; it may not hide a W-only open resource in a child capture. If an actual obligation is host-pinned, close it through authored cleanup or refuse the move. Do not silently add a general remote-cleanup escape hatch.

Missing immutable artifacts at W can be reconstructed only from available authenticated base/candidate bytes with exact digest verification. Reconstructing an artifact is not reconstructing application control. Never rerun a model to recover an approved candidate.

### 7.4 Scheduling and progress

Reuse the existing bounded pump and yield behavior. Worker detach is executor loss, not semantic cancellation. Service restart restores the current committed checkpoint and saved control input. A yielded computation resumes using the existing yield control, not a fabricated relocation reply. [S2, S5]

A genuine missing capability, export denial, unsettled operation, runtime mismatch, or exhausted budget produces a typed stop/refusal or remains durably blocked as appropriate. No timeout-based custodian takeover, infinite re-resolution, or hidden host retry loop is permitted.

---

## 8. Repository snapshots, candidates, and validation

### 8.1 Immutable view

The workspace adapter resolves a preprovisioned logical repository/base into immutable object/tree content. List, read, search, candidate preparation, and checks reference that same snapshot. A live branch moving after capture does not rewrite the frozen evidence.

Bind the relevant source tree, admitted path/mode manifest, toolchain/profile, and dependencies into each check identity. A changing live branch is checked separately at publication. Never mix frozen reads and live reads without identifying that distinction.

Pagination is REQUIRED for admitted path sets larger than one response. Cursors bind snapshot, query, and position, not mutable directory order. Report truncated excerpts and omitted results explicitly. A truncated scan cannot establish “no other occurrence exists.”

### 8.2 Candidate construction

Prepare candidates in a fresh bounded scratch area or through Git plumbing over controlled objects. Do not edit the authoritative branch or a user's checkout to test a proposal.

Verify every edit's preimage. Reject duplicate/overlapping conflicting edits, unexpected mode changes, changed mandatory check harnesses, and out-of-scope files. Compute the complete resulting tree, not just a patch string. The exact final tree delta must equal the admitted edit set.

The application may propose changes to ordinary project tests when granted, but candidate-controlled tests cannot redefine the independent mandatory acceptance contract. A profile may run project tests as one source of evidence while a protected harness supplies independent checks.

### 8.3 Qualified execution profiles

A profile is a deployment-owned declarative binding, not arbitrary shell text supplied by the model. It includes:

| Field | Required meaning |
|---|---|
| Profile ID/digest | Stable name and exact canonical profile content. |
| Runner identity | Qualified executable, loader, sandbox implementation/profile, platform/build, and relevant helper identities. |
| Toolchain | Exact Zig 0.17.0 executable and selected standard-library identity; any required linker/runtime executables. |
| Inputs | Read-only candidate/base snapshot, authenticated read-only package/dependency inventory, protected harness. |
| Command contract | Fixed executable/argument templates and an explicit finite set of admitted build/check targets. No interpolated shell. |
| Writable scope | Fresh per-check scratch, cache, temporary outputs; never the original checkout or shared production cache. |
| Network | Denied during repository code execution. Dependency acquisition is separate trusted provisioning. |
| Limits | Deadline, output bytes, scratch capacity, process-tree/resource limits supported by the qualified platform. |
| Verdict | Required observations/checks, exit conditions, coverage, and how incomplete execution is distinguished from failure. |

For the Zig profile, exercise builds that spawn compiler/linker/test descendants. All descendants must remain under the same filesystem/network/credential isolation boundary. Permission to execute a compiler must not confer access to the parent service's secrets or authoritative Git repository.

Qualification probes MUST attempt out-of-scope reads/writes, network access, environment/credential access, symlink/alias escapes, child-process escape, input/harness modification, output overflow, and process survival after timeout/cancellation. The trusted evaluator remains outside candidate control. Fail closed when the qualified profile cannot be reproduced.

### 8.4 Application to Boundary, World, and Agent

Provide operator-selectable profile manifests for bounded checks against admitted snapshots of these repositories on the final Zig stack. Discover their actual post-migration build graphs and authenticated dependencies; do not copy old target spellings as unquestioned truth.

Profiles must be useful for narrowly scoped code or documentation changes without requiring a full three-repository rebuild on every model turn. The selected mandatory final checks must still match the changed invariants. A formatting-only profile cannot certify a semantic interpreter change.

If a profile cannot execute a necessary check within its approved limits, report the candidate as unvalidated/blocked for publication. Do not increase resources, enable networking, or remove isolation merely to get a green result.

### 8.5 Evidence and applicability

Every check result distinguishes at least `Passed`, `Failed`, `Unavailable`, `TimedOut`, `Cancelled`, `InvalidOutput`, and `Incomplete`. Record what physically ran and which required checks completed. Unexpected process termination cannot become a passing test because no failing assertion was received.

Reuse an observation only under the existing inquiry broker's exact applicability rules. Reuse requires the same content/profile/dependency/contract/input identity and an explicit deterministic/reusable contract. Network-dependent tests, nondeterministic outputs, unknown prior delivery, or changed runner inputs are not silently cached as deterministic evidence. [S8]

A changed base, candidate, required check set, profile, compiler/library, or relevant dependency invalidates the corresponding validation and proposal approval. Re-running checks may preserve a tree but changes its evidence; bind the final required evidence set before issuing the final proposal.

### 8.6 Post-publication verification

Read the managed ref and verify the exact published commit/tree. Run selected postchecks against the published tree in the same isolation profile when required. Distinguish `PublishedVerified` from `PublishedVerificationFailed` and `PublishedVerificationUnavailable`.

Publication is not automatically undone by a later check failure. A compensating commit, rollback, or revised candidate requires a new authored proposal and approval. Preserve the original receipt and failure evidence.

---

## 9. Exact approval and managed-branch publication

### 9.1 Why a new publication leaf is necessary

The inspected repository replacement adapter is single-file and explicitly relies on a cooperative isolated-root writer contract. It must not be relabeled as an atomic multi-file transaction. [S7]

For this application, represent the complete candidate as an immutable Git tree/commit and make **one managed ref update** the visibility boundary. Git documents compare-with-old-value ref updates; this is the primitive used here, not a claim of a transaction across Git, SQLite, every filesystem path, and external tools. [S10]

Reuse the existing repository/delivery owners for common path, scope, proposal, and result admission. Implement only the missing managed-repository preparation/publication semantics. Existing single-file consumers need not migrate to Git.

### 9.2 Nonrecursive proposal construction

Avoid a digest cycle between proposal, commit, and approval:

1. Construct an immutable **proposal core** containing repository/base/tree, exact edits, required validation records, principal/task/generation, target/ref precondition, publication intent ID, and fixed commit metadata. The core does not contain its own digest or the candidate commit OID.
2. Hash the canonical core.
3. Construct a commit with the exact candidate tree, exactly one parent equal to the approved base commit, fixed author/committer/message metadata, and a binding to the core digest and intent ID. Git's `commit-tree` is an appropriate primitive for building a commit from an existing tree and explicit parent. [S11]
4. Record the candidate commit OID and a SHA-256 digest of its exact bytes.
5. Construct the final proposal from the core, its digest, and this exact commit identity; hash that final proposal.
6. Issue an approval challenge for the final proposal digest and complete human-readable action.

Commit authorship must be explicitly configured and truthful; do not impersonate the approving person. Git signing is not required by this version and must not trigger credential prompts or introduce a hidden execution dependency. Mobility message signatures remain independent.

### 9.3 Approval rules

Use Agent's existing protected approval construction and its private grant. Do not create a public `approved: true`, expose a grant constructor, serialize an environmental credential, or add an unbound split approve/commit API. [S2]

An approval binds the exact task/run occurrence, authenticated principal/tenant, proposal bytes/digest, destination/ref, expected base, candidate, validation policy/evidence, and current authorization context. A challenge nonce is fresh and environmental. Two proposals with identical prose do not share approval.

Any amendment to action-relevant data requires a new proposal and approval. An old browser tab, a resumed old task, a repeated provider ID, or a screenshot of approval has no authority. Presentation must not silently omit changed files or unvalidated consequences while still enabling approval.

Preserve the existing effect restrictions: the approval placement function performs only mobility operations, and final revalidation remains read-only. Do not run checks, prepare commits, write files, or obtain another approval inside either restricted function. If validation must be refreshed, exit that approval path and author a new candidate/proposal cycle. The publisher verifies an admitted protected request from the approved image/current occurrence; it does not reconstruct or inspect a public grant field.

### 9.4 Destination gate

Immediately before the ref update, verify under the publisher's serialized local admission gate:

- Current execution custody, incarnation, revision, and exact effect occurrence are authorized.
- No winning cancellation or revocation under the gate's documented ordering prevents the operation.
- The current tenant/principal still has this exact repository/ref/path capability.
- The protected request corresponds to the exact approved proposal and consumed private grant.
- The prepared commit's full bytes, tree, parent, fixed metadata, core binding, and complete delta match the proposal.
- Mandatory validation is complete and applicable under the current profile/policy.
- The target is a direct managed ref in the approved namespace, not `HEAD`, a symbolic ref, another repository, or a user worktree branch.
- The target's actual value equals the approved expected base.

The single ref compare-and-swap is the publication linearization point. A preliminary read followed by an unconditional update is forbidden.

### 9.5 Git execution boundary

Use a qualified Git executable with argument arrays and controlled configuration. The authoritative store is private to the trusted adapter. Repository-supplied hooks, filters, external diff/textconv tools, credential helpers, global configuration, object replacement, implicit fetch, and user-selected executables must not run in preparation or publication.

Inspect/build raw controlled objects rather than invoking ordinary checkout/add flows that may execute repository attributes. Validate object format and full OIDs; do not assume every repository uses 40-character identities. Ref names are generated from a bounded trusted namespace, never pasted from model text.

The authoritative publication branch is append-only under this adapter: each new commit has its observed old target as parent. No automatic rebase, reset, deletion, merge, force-push, or history rewriting. Rebase may be used for **implementation PR maintenance**; it is not a way to salvage an already approved application proposal whose base changed.

### 9.6 Publication and journal crash window

Do not claim Git and the custody journal commit atomically together.

Persist an exact publication intent in the existing occurrence/delivery storage **before** dispatch. It binds the proposal, old/new commit identities, managed ref, task/run occurrence, and source execution version. Do not duplicate this into a second workflow database.

A local multi-process publication gate serializes the same managed ref and coordinates current dispatch/cancellation/revocation admission. A JavaScript `Set` alone is not sufficient across service restarts. The qualified gate must prevent recovery or another writer from racing a still-running prior Git child. On timeout/crash, fence and reap the old operation or retain uncertainty; elapsed time and a reused PID are not proof it stopped.

After the Git operation, record the result as the acquired reply before World consumes it. If the process dies between Git publication and reply acquisition, reconcile **without executing publication again**:

| Reconciliation observation | Required result |
|---|---|
| Exact intended commit is the current managed ref; its bound bytes/parent/core match the saved intent. | Recover `Published` for that intent, without a new ref update. |
| Managed ref advanced through the exact intended commit under the enforced append-only contract. | Recover the historical publication with its original intent; report the later current head separately. |
| Old operation is demonstrably fenced/finished, intended commit was not published, and ref remains the old base. | Record a definitive not-applied result. A new attempt requires a fresh authored authorization path; do not silently retry. |
| Old operation is demonstrably finished, intended commit is absent from the controlled history, and another allowed publication changed the base. | Return definitive conflict/not-applied for this intent. |
| Evidence is missing, storage may have rolled back, a writer violated the managed contract, or a prior operation may still act. | Remain `Unknown`; no redispatch or source takeover. |

A matching tree alone is insufficient to attribute a write. The exact commit/core/intent and durable occurrence binding are required. Preserve evidence across later task generations. Do not rely solely on a reflog that may expire.

### 9.7 Cancellation and policy ordering

Document the local ordering point at which a cancellation/revocation is observed relative to publication. If it wins before publication admission, do not publish. If the ref update wins first, report publication and then cancellation of remaining work; cancellation is not rollback.

No architecture can retroactively undo an already linearized write by declaring the user's later click earlier. Do not claim instantaneous global revocation across unrelated external systems. The relevant verified policy version and admission ordering must be visible in the receipt.

---

## 10. Human interaction and browser experience

### 10.1 Usable reference application

Ship a runnable browser application, not a test page that always supplies predetermined approvals. Reuse the existing mobility browser client/origin bridge. The UI must support repository/mode selection, task entry, current status, questions, proposal review, explicit approval/decline, cancel, reconnect, and final artifact/receipt access.

This is not a generic workflow dashboard or a chat product rewrite. The screen is a projection of the current typed request and durable custody state.

### 10.2 Authentication

Continue using the bridge's explicit `authenticate(request)` seam. Provide a complete reference operator-issued session integration so running the application does not require inventing an identity provider. An existing deployment SSO/session integration may implement the same seam.

For the reference integration, a privileged local provisioning command issues a bounded, one-use login credential for an already authorized principal/tenant/audience. The credential is delivered out of band, expires, and is redeemed only through an authenticated-origin TLS POST. Store a verifier, not plaintext credentials, in environment-owned protected storage. A default principal, public token-mint endpoint, query-string bearer credential, or trusted identity header from an untrusted client is forbidden.

The resulting browser session uses an appropriately scoped Secure/HttpOnly/SameSite cookie, explicit expiry, and the bridge's existing origin/CSRF checks. Credential/session lifecycle state is environmental; it is never inside World state. Cookies need not be available to the Worker or application JavaScript. Operator grants and session authentication are distinct from proposal approval.

### 10.3 Deferred human reply

Add the smallest generic deferred-leaf seam to the existing custodian/journal if the current implementation still requires immediate byte replies. Preserve existing immediate-binding compatibility. A conceptual internal result is:

```text
LeafStart = Reply(canonical_reply_bytes)
          | Awaiting(exact_pending_external_binding)
```

This is an adapter lifecycle result, not a new portable World outcome or application opcode. Use actual existing state names where applicable; do not rename `SETTLED_REPLY` or other states merely to match this document.

The human question, payload digest, answer schema, allowed alternatives, current occurrence, and identity/audience binding must be durably registered before displaying it as answerable. The service releases its run lock while awaiting human input. It does not retain a suspended HTTP request, callback, promise, or Worker as the only place that knows how to continue.

Submission atomically verifies the still-current pending question, authenticated identity, exact request digest, and answer schema; it acquires at most one canonical reply. Existing World execution then consumes that saved reply. A second identical submission can return the already acquired result; a different second answer is a conflict, not an amendment after approval.

A crash while waiting restores the same question. A crash after answer acquisition but before World progress consumes the saved answer once. Cancellation and answer acquisition have an explicit serialized winner. A cancelled, departed, superseded, or completed question cannot acquire another answer.

### 10.4 UI integrity

Render source, diff, logs, model text, filenames, and explanations as untrusted content. No active HTML, unsafe Markdown execution, terminal escape interpretation, implicit command links, or executable artifacts in the UI.

Show the selected base, target, all changed paths, exact patch, check results, missing coverage, and proposal generation. Large displays may be paginated, but the complete approved action must remain available and its digest must match the proposal. Do not approve an omitted/changed candidate merely because a summary remained the same.

A click on “Approve” submits an answer to the exact current challenge. It does not directly call Git. Browser devtools cannot bypass the protected program path by submitting a ready-made World reply or choosing another pending occurrence.

### 10.5 Reconnect and honest status

After a move, retire the old Worker assignment. Reconnecting creates a fresh assignment for the current compatible checkpoint only. Old tabs cannot publish a successor to a later epoch/incarnation.

Distinguish at least: working locally, moving, awaiting human input, awaiting a capability, unknown transfer custody, unknown external delivery, cancelled/cleanup pending, published/presentation pending, and terminal. A departed host's last-known destination is not global proof of the current custodian after later moves.

Application/model progress text is non-authoritative UI data. Do not show success before the relevant durable receipt exists.

---

## 11. Model integration and provider continuity

### 11.1 Reuse the existing provider boundary

Use `runtime/model.mjs` and existing model invocation/schema normalization. The inspected inquiry CLI already calls `decodeModelInvocation`, `encodeOpenAIResponsesRequest`, `performModelInvocation`, and `admitModelEndpoint`; do not replace this with a second agent SDK/runtime loop. [S9]

Integrate a real configured model adapter into the mobility deployment loader. Model, reasoning configuration, endpoint, credential lookup, disclosure policy, and spend/work limits are explicit operator selections. Do not silently choose a cheaper/different model or infer permission to send repository data from the existence of an API key.

The default reference provider profile uses the OpenAI Responses API as an ordinary leaf. No OpenAI Agents API, Agents SDK orchestration, provider-hosted tool execution, MCP server, or provider conversation store is a prerequisite.

### 11.2 Typed proposals, not delegated authority

Request only the actions offered by the current Agent model contract. Use strict supported schemas where the provider supports them and still perform local semantic admission. OpenAI's strict function calling constrains the schema; it does not authorize repository access, certify candidate correctness, or execute the returned call on behalf of this application. [S12]

The adapter must return normalized proposals to the program. It must not execute tool calls, choose the next tool, repair malformed actions silently, turn a refusal into approval, or keep a private phase loop. Handle malformed output, unknown tools, unoffered alternatives, incomplete responses, and provider refusal distinctly.

Repository files, build output, and retrieved text are untrusted evidence. Instructions embedded in them cannot override task mode, scope, budgets, deployment policy, or approval requirements. A repository `AGENTS.md` may be supplied as scoped task guidance where the application deliberately chooses; it is not environmental authority.

### 11.3 Stateless restart contract

The deciding model witness must resume with provider/session process memory discarded and without requiring `previous_response_id` or a provider conversation ID. The next request is reconstructed from the authored model context and ordinary durable data, not from an SDK object kept in a host map.

When using a provider's multi-turn replay profile, preserve the complete supported replay items, call/result pairing, ordering, and opaque continuation fields in bounded ordinary data. Do not reduce the state to `output_text`. Reuse the current provider contract's representation; add a bounded replay-data field there only if necessary, rather than a separate control format.

Current OpenAI documentation states that stateless requests (`store: false` or ZDR) return encrypted reasoning content by default, and the legacy `include: ["reasoning.encrypted_content"]` is not required. Client-managed continuation still requires retaining and replaying the returned items. This default is not automatic durable storage by Agent. Reverify the selected API/model contract at implementation time. [S13–S14]

Encrypted reasoning is opaque provider data. Never decrypt, inspect, display, or claim to summarize it. Treat it with the classification of the context that produced it; encryption is not a declassification policy. If an item is lost, unsupported, or over budget, report the capability limitation or take an explicit authored context-reduction path—never silently claim preserved reasoning.

### 11.4 Provider safety and budgets

Credentials stay only in W's credential environment; code-execution children and the browser never receive them. Endpoints come from deployment configuration, not model output. Validate URLs, TLS, redirects, payload bounds, and allowed egress; never forward credentials to another endpoint.

Every physical attempt is durably charged before dispatch to the authorized run budget. W is the single model-spend authority in this version, avoiding a new distributed billing ledger. Another workspace host cannot mint a fresh allowance for the same run. The logical application allowance also travels in the continuation and cannot reset on browser reconnect or service restart.

Usage diagnostics must distinguish requested limits, observed provider usage, cached-input measurements if returned, and unknown cost. Do not invent dollar savings or refund budget after an ambiguous call.

### 11.5 In-flight calls

A streaming connection is environmental progress, not movable World state. A normal move occurs only after the full admitted reply has been acquired and the program reaches its next settled mobility request. Partial tool arguments never execute.

On transport ambiguity, use the existing unknown-occurrence discipline. No automatic repeat of a possibly billable request unless the selected provider contract proves it was not accepted or an explicit supported reconciliation policy authorizes that behavior. The conservative reference behavior remains blocked with its charged attempt and late-response fencing. A cancelled/abandoned provider operation must not later resume another task or manufacture a write grant.

---

## 12. Durable effects, recovery, and cancellation

### 12.1 Preserve the existing custody protocol

The source freezes durably with its exact offer/outbox before delivery. Destination admission, acceptance/refusal, exact retries, withdrawal, receipt reconciliation, source retirement, and returning-host behavior remain owned by the existing mobility implementation. `Unknown` never becomes an ordinary refusal or an arrival reply. [S2, S5]

HTTP success alone is not custody acceptance. HTTP failure, timeouts, lost acknowledgments, and malformed replies are not definitive refusals. Never resume the source merely because the destination is currently unreachable.

### 12.2 Distinguish three uncertainty classes

| Class | Meaning | Permitted recovery |
|---|---|---|
| Custody uncertainty | Transfer may have been accepted elsewhere. | Existing signed status/receipt/withdrawal reconciliation; source stays frozen. |
| External-effect uncertainty | A current leaf may have acted, but its result is not durably acquired. | Exact operation-specific evidence/reconciliation; no blind repeat. |
| Deferred interaction | A known durable question is awaiting an answer and no answer is acquired. | Restore the same question, accept one authenticated answer, or cancel it. |

A deferred human wait is not a failed network request. Conversely, declaring an external operation “awaiting” must not erase the possibility that it already acted.

### 12.3 Dispatch lifecycle extension

The minimum environmental lifecycle remains: admitted current request → durable dispatch/wait identity → acquired canonical reply → World consumption → committed successor. Retain existing occurrence IDs and version fencing. Extend the current journal only where it lacks durable deferred registration/settlement or publication intent evidence.

Do not hold a per-run execution mutex across human waiting or arbitrary network latency. Claim work durably, release the scheduling lock, perform the external operation under its own bounded context, then reacquire and validate the exact occurrence/version before recording a reply. Prevent a second dispatcher from claiming the same work.

The short managed-ref publication gate in Section 9 is a resource-specific serialization boundary, not permission to hold the entire service hostage. Unrelated runs must progress while one run waits, fails, or reconciles.

### 12.4 Recovery table

| Crash/loss point | Required behavior |
|---|---|
| Before a leaf is admitted for dispatch | Restore the same pending World request; dispatch may occur once after fresh admission. |
| During a check/model operation | Determine physical operation status; kill/reap where appropriate; retain uncertainty rather than inventing a result. |
| After reply acquisition, before World consumption | Reuse saved canonical reply; do not call provider/tool again. |
| After World execution, before durable successor publication | Restore committed predecessor plus saved control and recompute only the pure World step; no external redispatch. |
| While a human answer is pending | Restore exact question and binding. |
| After human answer acquisition | Consume acquired answer once; do not solicit a replacement answer. |
| After source freeze | Existing exact transfer reconciliation; no source execution. |
| After destination acceptance, before receipt delivery | Destination owns the run; source remains frozen until it reconciles. |
| After Git publication, before reply storage | Reconcile saved intent with controlled Git evidence, never repeat the mutation. |
| After publication, before returning to U | Recover published status and successor; presentation failure is not delivery failure. |

### 12.5 Cancellation

Cancellation is a durable intent bound to the run. It is not tab close, HTTP disconnect, task budget exhaustion, or arbitrary process termination.

Before dispatch, cancellation prevents ordinary work and drives existing cleanup. During known human waiting, cancellation wins or loses atomically against answer acquisition. During transfer uncertainty, use the existing withdrawal/accepted-owner forwarding rules. During publication, use Section 9's ordering. During a running check, terminate and reap its process tree before releasing scratch or reporting completed cleanup.

Already acquired replies remain evidence even when cancellation wins subsequent control. Unknown external writes remain unresolved; cancellation cannot rewrite them as not performed. Retain bounded operator-visible unresolved obligations.

### 12.6 Storage and identity loss

Continue the existing private-directory, explicit-initialization, deployment-generation, and no-timeout-GC policies. The previous mobility work qualified local process-crash behavior, not all power-loss or rollback scenarios. [S2]

Missing storage, mismatched trusted generations, corrupted artifacts, and a known restoration of old storage under a live identity fail closed. A self-consistent old backup cannot reveal its own rollback from its contents alone: deployment generation/fencing must come from an independent trusted source. Do not run `init` as a recovery shortcut. An operator must fence/reconcile before replacing identities/storage. Session renewal or key rotation is not custody takeover.

## 13. Classification, disclosure, and authority

### 13.1 Whole-state export

A placement payload that looks public does not make its surrounding continuation public. Classification includes retained source, evidence, candidate bytes, model replay data, owned children, and cleanup captures. Keep the existing conservative joins and destination admission before disclosure. Do not lower the run label by deleting a visible text field or clearing a UI view. [S2]

The normal mobile-review deployment explicitly authorizes both U and W to receive the relevant whole checkpoint. U includes its durable journal/origin service, not just the person's screen. This is an operator-approved disclosure boundary, not a default assumption about every browser.

### 13.2 Restricted-state route

Include a required negative profile in which repository data is W-only. Before acquiring data whose known classification would make the intended return impossible, the authored placement/read policy must identify that restriction and refuse or select a supported nonpublishing stop. If a stricter classification is discovered only after acquisition, preserve it and refuse export.

Do not launder restricted state into a “safe summary,” reconstruct a reduced continuation at U, silently proxy the human approval to W, or silently declassify the whole run. A separately designed authorized redaction/declassification or remote-human application is outside this version. The UI can show bounded non-sensitive custody/status metadata without exposing the protected checkpoint.

### 13.3 Leaf disclosure

Mobility export policy does not by itself authorize sending data to a model provider, writing a log, exporting a patch, serving a diff, or launching a test process. Each adapter checks its own disclosure audience and data scope before side effects.

Validate the model request's complete actual payload against its egress grant, including replay items and tool descriptions that may contain source. Host-local credentials do not imply data-sharing authorization.

### 13.4 Least authority

Grant read and write scope independently. A read grant to a repository is not a write grant; a publish grant to one managed ref does not allow branch creation elsewhere, remote push, Git configuration, source import, or a shell.

A trusted peer certificate is not permission to register an arbitrary principal. Preserve the explicit issuer binding. Logical resource IDs and content hashes identify resources but are not bearer capabilities. Schemas, roles, subject versions, audiences, and current grants must match actual dispatch.

### 13.5 Secret handling and observability

Keep provider, signing, TLS, and session secrets out of compiled images, checkpoints, typed payloads, diffs, reports, package archives, logs, and browser storage. Use environment-owned secret lookup only at the dispatch owner.

Required sentinel tests scan actual test credentials against emitted/package/state/transport/report artifacts. These tests supplement architectural separation; they do not prove a universal secret detector. Logs default to IDs, digests, bounded reason codes, counters, and timing. Source/model payload capture is a separate explicit sensitive-data option with retention and access rules.

---

## 14. Resource bounds and lifecycle management

### 14.1 Initial application defaults

These are bounded application defaults, not permission to increase World, journal, or deployment ceilings. The effective limit is the strictest applicable runtime, registered-run, deployment, adapter, and application limit.

| Resource | Initial default / required policy |
|---|---|
| Moves | Existing 16-move ceiling; thread remaining moves through the whole task. |
| Placement attempts | Existing three-attempt default per explicit resolution episode, bounded by the library's actual candidate cap; no hidden reset loop. |
| Admitted paths | At most 4,096 explicit paths, paginated in at most 32 entries per response. |
| Changed paths | At most four distinct regular-file paths in the write grant. |
| File content | At most 32 KiB per admitted editable file; reject unsupported larger files rather than truncate writes. |
| Candidate replacement bytes | At most 128 KiB total across the four paths. |
| Retained source/evidence text | 512 KiB per task, excluding explicitly separately bounded provider replay data. |
| Provider replay data | At most 2 MiB; lower runtime/contract limits take precedence. |
| Model attempts | At most 32 physical attempts per task, with a separately explicit live token/spend authorization. |
| Candidate revisions | At most eight validated candidate generations per task. |
| Check requests | At most 16 physical check executions per task; profile-internal prescribed cases are separately measured. |
| Owned investigations | At most eight; default three when the selected inquiry composition uses a population. |
| Check output | 256 KiB combined bounded diagnostics; truncation is explicit and cannot erase required verdict observations. |
| Check duration/scratch/process resources | Explicitly positive profile-specific limits; no unbounded defaults. |
| World image/outcome/working memory | Preserve the final qualified inherited ceilings. Do not copy a CLI path that raises them to the physical maximum. |
| Journals/artifacts/records | Preserve the existing enforced deployment quotas; count external Git/scratch storage as well. |
| Live inference | Disabled without explicit provider, disclosure, and positive budget configuration. |

A more permissive supported configuration needs validation against emitted schemas, working-state growth, and the selected execution profile. Changing a JSON number does not enlarge a compile-time or protocol contract.

### 14.2 Budget ownership

The program owns logical work policy. Environmental adapters own physical attempts and resource use. Both are enforced. Charge physical attempts before dispatch; retries, failures, and uncertain provider calls do not become free by restarting or moving.

The W-owned model/check/publication allowance record binds run/task authorization, not an invocation-local counter. Reconnecting, changing browser assignments, or opening a new service process must not reset it. The task's portable allowance and environmental receipts must be reconciled conservatively; a contradiction blocks further spend.

Wall-clock deadlines require a declared time source and restart semantics. Human review time is not charged as active computation time by default. Elapsed time never authorizes custody takeover or resolves an unknown write.

### 14.3 Artifact lifetime

Preserve snapshots, exact candidate/commit bytes, acquired replies, proposals, publication intents, and receipts needed for recovery. GC cannot delete artifacts referenced by an active run, open offer, unknown operation, pending human answer, or publication reconciliation.

Temporary check scratch is removed only after its process tree has exited. Immutable object pins may be released when the owning environment has authenticated terminal/release evidence; otherwise retain conservatively and enforce quotas. A departed host's lack of recent activity is not terminal evidence.

Retain the small terminal decisions and occurrence bindings required for replay prevention. Reuse existing artifact GC and accounting. Do not add a generic archival platform or a timeout that erases permanent decisions.

### 14.4 Repeated-session growth

Test repeated completed tasks and reconnects. Owned continuations, pending human questions, Worker assignments, process handles, scratch directories, and temporary candidate pins must not grow after their declared lifetimes. Retained ordinary conversation memory, immutable delivery history, and permanent replay-prevention metadata may grow within explicit quotas; report them separately rather than claiming constant total storage.

---

## 15. Configuration, commands, and packaging

### 15.1 One supported front door

Extend the existing `runtime/mobility/cli.mjs` and deployment/browser owners. A thin application command group is permitted. It must not create a second scheduler, checkpoint directory convention, or host-driven workflow.

The implementation MUST ship executable help and examples for:

| Command responsibility | Required behavior |
|---|---|
| Validate deployment | Read-only verification of config schema, runtime/image/contracts, keys/peers, scope, limits, and required capability coverage. No secret output. |
| Initialize storage | Explicit new-storage operation; preserve existing `init` refusal/recovery rules. |
| Provision repository | Privileged import of an approved immutable base into a new managed store; no model-selected network access. |
| Qualify check profile | Run actual isolation/runner probes; emit profile identity and pass/fail evidence. |
| Issue reference session | Local privileged issuance for an existing authorized principal/audience; no implicit approval. |
| Start task | Validate typed task/mode/scope, create one signed run registration, and start only at its initial custodian. |
| Serve application | Run existing peers/pump and authenticated browser bridge appropriate to this host. |
| Status / reconcile / cancel | Use existing custody/occurrence owners; never thaw ambiguity or reset state. |
| Export result | Export authorized proposal/patch/commit receipt with exact bindings; no hidden publication. |
| Qualify application | Execute offline, browser, packaged, deployed, and live lanes with explicit opt-ins and evidence. |

Do not make the user hand-encode Boundary values, discover compiler outputs, collect kernel files, or manually edit run-registration signatures. Trusted CLI operations should encode/sign using existing owners and approved config, while keeping authority explicitly local.

### 15.2 Local configuration versioning

The existing v1 deployment loader has a closed field set. If this implementation adds an `application` block or other new local fields, introduce an explicit local configuration version, for example `agent-mobility-deployment/v2`, and retain deliberate compatibility for existing v1 consumers. Do not silently accept unknown fields in v1. This is a **local configuration** change, not a new custody wire protocol.

Reuse the existing host fields: `hostId`, `trustDomain`, `revision`, `worldRuntime`, `directory`, `deploymentGeneration`, `execution`, `keys`, `signer`, `peers`, `tls`, `deployments`, `bindings`, `labelDestinations`, and `revoked`. The existing example already binds image/program, tenant/principals/issuers/hosts, export policies, cleanup, and move/image/outcome limits. [S15]

The application configuration adds the following explicit responsibilities without duplicating the authoritative host grants:

| Application field | Required semantics |
|---|---|
| `image` / `contracts` | Installed approved artifact identities resolved through the existing inventory, not arbitrary imports. |
| `repositories` | Logical ID → private managed store/provisioning generation, permitted base/target refs, read/write manifests, initial classification. |
| `checks` | Qualified profile IDs/digests and immutable dependency/toolchain inventories. |
| `provider` | Enabled flag, exact model/reasoning/endpoint profile, local secret lookup, egress grant, physical attempt and token/spend limits. |
| `interaction` | Exact origin/audience, configured authentication integration, session expiry and reference issuance policy. |
| `limits` | Bounded application limits, no greater than inherited/registered ceilings. |
| `delivery` | Allowed managed ref namespace, configured commit identity, required check policy, publication/reconciliation owner. |

A config's physical paths resolve relative to that config under the existing trusted loader rules. Physical paths, endpoint credentials, and key material must not be copied into task arguments or checkpoints.

### 15.3 Setup and startup checks

Setup must fail usefully for missing runtime delivery, wrong image/schema, unavailable check profile, stale source/library selection, unprovisioned repository, missing trust mappings, invalid audience/origin, or infeasible state export. Explain the missing binding without leaking secrets.

Generate complete deployment templates with disabled live inference and explicit placeholders for operator-controlled identity/credentials. Do not ship fabricated working certificates or auto-trust unknown peers. Test provisioning may create isolated temporary keys and stores without altering system trust.

Once configured, a minimal run must be possible through the CLI/browser without application source or a compiler used to rebuild the Agent image. Startup qualification is evidence, not a replacement for authority checks on every dispatch.

### 15.4 Proposed build targets

Names below are required implementation targets unless an existing target already provides the same complete behavior; then use and document that target rather than adding an alias solely for this document.

| Target | Scope |
|---|---|
| `check-mobile-repository` | Compiler/authoring contracts, deterministic application, snapshot/candidate/publication, deferred replies, fault/model tests. |
| `check-mobile-repository-browser` | Chromium/Firefox, real reference authentication, fresh Workers, UI negatives, durable human answers. |
| `check-mobile-repository-package` | Extract actual use archive and run without application authoring sources; authenticated runtime acquisition. |
| `check-mobile-repository-zig` | Qualified Zig 0.17.0 profile and bounded admitted repository tasks. |
| `measure-mobile-repository` | Controlled non-live comparisons, resource/custody measurements, matched workloads. |

Deployed/live qualification is opt-in through the application qualifier, not hidden inside ordinary CI/build. Integrate offline checks into the current aggregate without duplicate execution. Preserve the current Node test-environment handling, custom output directory support, package-store path correctness, and compiler/library propagation.

Representative commands after implementation, with real authenticated paths:

```sh
set -eu
: "${ZIG017:?absolute path to the selected verified Zig 0.17.0 executable}"
: "${WORLD_RUNTIME:?absolute authenticated final World runtime path}"
: "${WORLD_SOURCE:?absolute authenticated final World source path}"
: "${WORLD_ARCHIVE:?absolute authenticated final World source archive}"
: "${BROWSER_TOOLS:?absolute qualified browser-tool installation}"
[ "$("$ZIG017" version)" = "0.17.0" ]

"$ZIG017" build check-mobile-repository check-mobile-repository-browser \
  check-mobile-repository-package check-mobile-repository-zig \
  -Doptimize=safe \
  -Dworld-runtime="$WORLD_RUNTIME" \
  -Dworld-source="$WORLD_SOURCE" \
  -Dworld-archive="$WORLD_ARCHIVE" \
  -Dbrowser-tools="$BROWSER_TOOLS"
```

Retain the final migration's actual safe optimization spelling and build options. The command is a required successor interface template, not a claim that these new targets exist at the inspected head. The implementation must verify its documented commands against the installed artifact and include custom output paths/spaces in tests.

### 15.5 Package contents

Extend the existing use archive with the compiled mobile application, ordinary schemas, UI assets, required production adapters, CLI support, config templates, and concise runbook. Keep one generic independently authenticated World runtime acquisition path. Do not bundle a second or unauthenticated kernel.

The deployed archive must not contain application authoring sources, fixture solution catalogs, private keys, session tokens, provider credentials, or oracle imports in production code. Test oracles may exist in test packages but must be removable for the source-independent lane.

“Source-independent application execution” means no Agent emitter/compiler/application source is required to resume. The workspace naturally contains the **target repository's** source, and its explicitly installed Zig compiler may run repository checks. That is not permission to rebuild the Agent image during restore or conceal a source dependency in a deployment script.

---

## 16. Required end-to-end witnesses

### 16.1 Deterministic full application witness

Use a real temporary Git repository with at least two admitted source files and a protected independent acceptance harness. The model fixture supplies typed but non-authoritative proposals; the candidate is not selected by a host phase counter.

The witness must:

1. Start at U with a real Worker, task generation, and retained non-tail caller.
2. Move to W because repository/model/check bindings are absent at U.
3. Inspect actual immutable source, retain an owned investigation, propose an initially invalid or failing candidate, observe its actual rejection, and produce a different valid bounded multi-file candidate.
4. Validate the exact candidate, then move its actual checkpoint back to a fresh Worker at U.
5. Present the exact proposal, acquire a human-shaped authenticated response, and retain the private grant through the final move to W.
6. Revalidate, conditionally publish one managed ref, verify the result, complete cleanup, and return an exact receipt to U.
7. Prove the user's/fixture's original checkout was unchanged, the managed tree equals the approved candidate, and no provider/model fixture invoked Git directly.

Physically terminate the original Worker before delivering its transfer. Restart W at a selected durability boundary. Remove transient provider/application host memory before resumption. Record actual request ordering and independent final expectations.

### 16.2 Browser and actual-person witness

The same shipped UI must work with a real authenticated person, not only a test-created reply. Exercise a question, explicit proposal inspection, decline or amendment, and approval of a later exact proposal. Authenticate through the supported reference/deployment flow.

A person is not required for unattended CI. Record human qualification separately; a test fixture impersonating the input shape cannot be reported as actual human approval.

### 16.3 Zig repository witness

Run the qualified Zig 0.17.0 profile against an admitted snapshot in the Boundary/World/Agent ecosystem. Choose a small legitimate code change whose correctness has an independent deciding check. Use an isolated managed copy, not the active migration checkout. At least one positive witness must include a real failing or changed expectation and passing candidate, not only `zig fmt` or a documentation edit.

Provide read-only/inspection profile examples for all three repositories, and profile-specific validation for any repository advertised as writable. Do not claim the entire codebase is supported from a single tiny fixture test.

### 16.4 Two-machine witness

Run U and W on distinct independently controlled machines or existing explicitly approved hosts. Use actual mutually authenticated network transport, not loopback processes described as remote. Demonstrate W restart, U/browser loss, a dropped acceptance response, and successful receipt recovery.

Record OS/runtime/toolchain/profile identities, real network topology, link conditions, exact artifact hashes, operation trace, and recovery result. No requirement to purchase cloud resources. When authorized hosts are absent, the launcher and tests must still be implemented, and this lane remains explicitly not run.

### 16.5 Live-model usefulness witness

With explicit model/data/budget authorization, run at least one operator-supplied legitimate task against an admitted repository snapshot using the actual provider adapter and actual human review. Preserve malformed proposals, failed checks, and revisions. Verify a delivered result independently; a persuasive explanation alone is not success.

Also run a bounded holdout set described in Section 19 to characterize usefulness. Do not tune fixtures to a known model answer, compile a repair catalog into the image, or discard failed live tasks from the report.

## 17. Acceptance matrix

Each row requires deciding evidence. Existing tests may satisfy rows when they exercise the actual successor and binding; one well-designed test may cover several rows. Do not create 96 superficial wrappers merely to match this table. The final report maps every ID to executed evidence, a failed result, or an explicit external blocker. A skip is not a pass.

### 17.1 Foundation and architecture

| ID | Required deciding assertion |
|---|---|
| MR-001 | Final migration tuple authenticates; a mixed Boundary/World/kernel/source tuple rejects before application execution. |
| MR-002 | Exact Zig compiler and inherited library propagate through nested builds and independent consumers; conflicting selections reject. |
| MR-003 | Existing mobility, approval, inquiry, repository, and source/package regressions retain their required behavior on the final tuple. |
| MR-004 | New application compiles through public Agent/Boundary APIs and runs with the unchanged generic World evaluator. |
| MR-005 | No host-side domain phase machine or transcript-reconstructed control is required; deleting reports does not prevent checkpoint resumption. |
| MR-006 | Production deployment loads real adapter kinds without importing provider fixture/solution catalogs. |
| MR-007 | Config v1 remains closed; deliberately supported successor config validates fields and rejects unknown adapter/profile identities. |
| MR-008 | New image/contracts are bound by the installed inventory; mismatched schema/image/program rejects before dispatch. |
| MR-009 | Source-independent execution uses the acquired runtime; no hidden build/emitter fallback exists. |
| MR-010 | One existing custodian/journal owns the new run; no second workflow checkpoint or authority store controls its progress. |
| MR-011 | A missing generic core capability is demonstrated before a core repair; absent such evidence, Boundary and World remain unchanged. |
| MR-012 | Custom output directories, spaces, nondefault package storage, and inherited Node test context work without skipping required checks. |

### 17.2 Application and mobility

| ID | Required deciding assertion |
|---|---|
| MR-013 | Full U→W→U→W→U application trace completes from actual successor checkpoints with the approved final tree and receipt. |
| MR-014 | Local `Here` capability satisfaction performs no transfer and consumes no move budget. |
| MR-015 | Removing a required local binding causes authored placement or typed failure, never an invented reply or hidden RPC fallback. |
| MR-016 | Placement requirements/schema/role/subject/version mismatch rejects even when a host advertises a similar operation name. |
| MR-017 | A retained non-tail caller value affects the final result after two or more moves. |
| MR-018 | An owned investigator remains parked across a move, then resumes at its original call site without reinitialization. |
| MR-019 | Cleanup uses its original captured value exactly once after transfer; another retained child is not accidentally disposed. |
| MR-020 | A host-affine open resource or unsupported cleanup manifest prevents relocation; no resource is serialized by handle. |
| MR-021 | Worker A1 is physically terminated before delivery; a fresh Worker A2 resumes the returned continuation. |
| MR-022 | `Yielded`, ordinary progress, requested effects, and cancellation use their existing distinct controls across restore. |
| MR-023 | Move/attempt exhaustion is bounded across repeated ensures and reconnects; resetting per call cannot pass. |
| MR-024 | `inspect`, `propose`, and `publish` differ only by authored policy/authority; inspect/propose cannot publish through adapter shortcuts. |

### 17.3 Repository and validation

| ID | Required deciding assertion |
|---|---|
| MR-025 | Reads/searches bind an immutable snapshot; a later live branch change cannot silently alter frozen evidence. |
| MR-026 | Pagination covers more than 32 admitted paths with a bound cursor; query/snapshot cursor substitution rejects. |
| MR-027 | Truncated searches/excerpts are marked and cannot prove exhaustive absence or become truncated replacement content. |
| MR-028 | Absolute/traversal/symlink/special-file/case-alias paths and `.git` escapes reject before access or preparation. |
| MR-029 | Valid bounded create/replace/delete across multiple regular files yields exactly the canonical admitted tree delta. |
| MR-030 | Wrong preimage, duplicate conflict, unauthorized path/mode, binary input, and candidate tree smuggling reject without publication. |
| MR-031 | Candidate preparation and checks leave the managed target ref and original checkout unchanged. |
| MR-032 | Mandatory independent harness cannot be modified or forged by candidate source or changed project tests. |
| MR-033 | Actual Zig 0.17.0 code/check execution succeeds under the qualified profile; a selected incorrect candidate fails independently. |
| MR-034 | Escape probes for files, network, credentials, descendants, input mutation, and scratch/output limits fail under the profile; no unsandboxed fallback. |
| MR-035 | Timeout, cancellation, missing observations, invalid output, and unavailable environment are distinct from a failing check and from a passing check. |
| MR-036 | Changed compiler/library/dependencies/profile/candidate invalidate evidence reuse; only exact explicitly reusable observations are shared. |

### 17.4 Approval and publication

| ID | Required deciding assertion |
|---|---|
| MR-037 | The actual private approval grant survives relocation and is consumed through the existing protected owner before publication. |
| MR-038 | Wrong principal/tenant/audience, old occurrence, forged boolean approval, and direct environment bypass cannot publish. |
| MR-039 | Changing any approved action field—including target, base, edits, checks, mode, or commit metadata—requires new approval. |
| MR-040 | The UI's exact diff and the publisher's verified tree/commit match the same proposal digest, with no circular digest construction. |
| MR-041 | A live managed-ref conflict rejects the approved candidate without rebase, merge, overwrite, or silent reapproval. |
| MR-042 | Two concurrent approved publications against one old ref yield at most one update; the loser has a definitive conflict or honest uncertainty. |
| MR-043 | Publication updates one authorized direct ref only; symbolic refs, `HEAD`, other namespaces, and user worktree targets reject. |
| MR-044 | Git hooks/filters/credential helpers/global configuration/replacement objects and implicit fetch cannot execute through publication preparation. |
| MR-045 | A crash after the ref update but before reply acquisition recovers the same publication receipt without a second update. |
| MR-046 | Equal tree content without the exact saved intent/commit binding cannot be claimed as this operation's successful publication. |
| MR-047 | A prior still-running Git child prevents a new publication/recovery writer from acting; stale processes cannot publish after fencing. |
| MR-048 | Failed/unavailable postchecks preserve the published receipt and do not trigger unapproved rollback or another mutation. |

### 17.5 Human and browser interaction

| ID | Required deciding assertion |
|---|---|
| MR-049 | Real reference session issuance/redeeming works for an already granted principal; there is no default or remotely mintable identity. |
| MR-050 | Wrong origin/port, CSRF token, expired/revoked session, and wrong audience fail before acquiring an answer or exposing state. |
| MR-051 | A pending human question survives origin-service restart without a live promise/HTTP request/Worker retaining control. |
| MR-052 | Crash after answer acquisition resumes with the exact saved answer once, without asking again. |
| MR-053 | Duplicate identical answer is idempotent; conflicting second answer cannot replace the acquired one. |
| MR-054 | Old-tab/old-generation/old-incarnation answers and successor submissions cannot affect the current task. |
| MR-055 | Browser content injection through source, filenames, diff, logs, or model prose renders inert and cannot execute or alter approval binding. |
| MR-056 | A declined proposal performs no publication; an amended task causes a new proposal generation and independent checks/approval. |
| MR-057 | A real question can trigger further authored investigation and return; the host does not select the next tool. |
| MR-058 | Cancellation races with answer acquisition have a serialized outcome; losing/stale answers cannot resume normal work. |
| MR-059 | Chromium and Firefox run the shipped UI and actual Workers using the extracted package and authenticated runtime. |
| MR-060 | At least one actual-person qualification is recorded separately from synthetic-human CI; lacking one is reported as not run. |

### 17.6 Models, privacy, and authority

| ID | Required deciding assertion |
|---|---|
| MR-061 | Real provider adapter is configurable through the deployment loader; absent provider authorization leaves live inference disabled. |
| MR-062 | Unoffered tool calls, malformed values, provider refusal, incomplete output, and model-supplied approval cannot gain authority. |
| MR-063 | A resumed model turn works after clearing host/provider session memory without requiring a last-response/conversation ID. |
| MR-064 | Supported replay items, opaque reasoning fields, call IDs, and ordering survive exactly; retaining only text fails the deciding test. |
| MR-065 | All physical model attempts are charged durably; restart/move/unknown transport cannot reset or refund their allowance. |
| MR-066 | Endpoint redirection, model-supplied URLs, and wrong egress audience cannot receive credentials or unauthorized repository data. |
| MR-067 | W-only evidence prevents whole-state return to U before artifact disclosure, including when only a public-looking summary is pending. |
| MR-068 | Restricted data in a child/cleanup capture or provider replay record also prevents export; clearing a UI field cannot lower classification. |
| MR-069 | UI diff/artifact export and model egress enforce their own disclosure grants rather than reusing custody authorization blindly. |
| MR-070 | Actual test-secret sentinels remain absent from images, checkpoints, offers, receipts, logs, archives, and browser persistence. |
| MR-071 | Peer trust alone cannot register an unapproved issuer/principal or impersonate a host/operation/resource binding. |
| MR-072 | Prompt injection in repository content cannot expand scope, enable publication, bypass checks, or select arbitrary test commands. |

### 17.7 Recovery, cancellation, and capacity

| ID | Required deciding assertion |
|---|---|
| MR-073 | Lost transfer acceptance response leaves the source frozen and reconciles the original signed decision without duplicate execution. |
| MR-074 | Returning-host reconciliation cannot reactivate a departed epoch or ignore a previously unresolved cancellation. |
| MR-075 | Saved acquired model/check replies survive a crash without physical redispatch. |
| MR-076 | Unknown model/check/publication operations remain distinct; a timer cannot transform them into safe repeats. |
| MR-077 | A pure World step can be recomputed from committed predecessor plus saved input without repeating an external effect. |
| MR-078 | Cancellation during custody ambiguity uses withdrawal/owner forwarding and never starts cleanup at two custodians. |
| MR-079 | Cancellation before publication admission prevents publication; after publication it preserves the receipt and does not claim rollback. |
| MR-080 | Timeout/cancel kills and reaps all check descendants before cleanup; one failed run does not block unrelated runs. |
| MR-081 | World/artifact quota exhaustion preserves the last committed checkpoint and any acquired reply; no limit inflation or data loss. |
| MR-082 | Repeated tasks/reconnects release owned state, pending UI records, Workers, process handles, and scratch within their declared lifetimes. |
| MR-083 | Missing/corrupt storage, known rollback, and trusted generation mismatch fail closed without reinitializing a live identity; no self-detection claim is made for a consistent old backup. |
| MR-084 | GC retains every artifact needed for active/offered/unknown/human-pending/publication recovery and never uses timeout as proof of terminal state. |

### 17.8 Delivery, usefulness, and evidence

| ID | Required deciding assertion |
|---|---|
| MR-085 | Actual extracted use archive runs the full application without application authoring sources, fixture oracles, or an emitter/compiler fallback. |
| MR-086 | The same pinned generic runtime executes required native/WASM boundaries; independent expected results supplement byte agreement. |
| MR-087 | Two-machine execution uses real authenticated network peers and survives selected machine/service/browser failures; local tests are not mislabeled. |
| MR-088 | Live-model task uses explicit operator model/data/budget authorization and records an independently judged result, including failure when it fails. |
| MR-089 | Controlled stationary-remote-tool comparison uses matched workload, checks, authority, and provider replies; all failure samples remain visible. |
| MR-090 | Report separates compilation, pure World, custody/journal, network, tool/model, and human-delay costs; no end-to-end gain is inferred from one phase. |
| MR-091 | Cold/warm artifact traffic and continuation bytes include real image-cache behavior and browser verification overhead. |
| MR-092 | Required mutants break an invariant and are caught by independent oracles; bounded model results are not represented as an unbounded proof. |
| MR-093 | Installed help/config/start/serve/status/cancel/export examples execute and fail usefully on missing inputs; user need not hand-encode protocol data. |
| MR-094 | Receipt names the managed repository/ref/commit accurately and never claims the user's checkout, upstream PR, or `main` was changed. |
| MR-095 | Current exact-head evidence maps every acceptance ID to pass/fail/not-run/blocked, with truthful limits and external prerequisites. |
| MR-096 | Implementation PR is current, assigned to `tkersey`, and includes actual dependency order and qualified artifacts; no unauthorized merge/release/live action occurred. |

---

## 18. Fault injection and bounded models

### 18.1 Reuse existing machinery

Run the inherited custody models and fault tests against the successor. Extend the production-adjacent model and journal tests at the actual new seams: deferred human answers, application budgets, candidate/approval binding, and publication reconciliation. Do not replace the existing model with a disconnected simplified rewrite merely to produce another proof artifact.

### 18.2 Required injected boundaries

Inject deterministic failures immediately before and after:

- Durable human-question registration and answer acquisition.
- Dispatch claiming, external action, reply acquisition, and World successor publication.
- Source freeze, destination acceptance/refusal, receipt delivery, and returning-host reconciliation.
- Publication intent persistence, Git process launch, ref compare-and-swap, delivery reply persistence, and result return to U.
- Cancellation/revocation admission and each relevant winner/loser boundary.
- Artifact creation/pinning/collection and storage/quota failures.

Use real subprocess termination for selected journal/publication points, not only thrown exceptions. Retain the actual storage/runtime/platform profile. Process crash tests do not establish power-loss durability.

### 18.3 Required invariants

The independent oracle checks:

1. At most one conforming logical custodian authorizes the next ordinary effects of a run.
2. A committed World successor corresponds to its actual predecessor and saved control input.
3. Each question occurrence acquires at most one effective answer.
4. Every published tree/commit matches an exact approved proposal and current ref precondition.
5. An ambiguous operation is never repeated merely because a timer or process restart occurred.
6. A reply from a retired task/epoch/incarnation cannot enter a later continuation.
7. Classification and spent allowances do not decrease through moves/restarts.
8. Cleanup does not erase unresolved write/transfer evidence or execute twice under two owners.

Model explicit concurrency histories: two publishers from the same base, late human reply after cancellation, transfer accepted while cancellation requests withdrawal, and a returning host with unresolved previous custody.

### 18.4 Mutation checks

The suite must detect deliberate mutants that:

- Treat timeout as custody refusal/takeover.
- Drop child/cleanup state or rebuild initial arguments at a hop.
- Accept a stale human occurrence or replace an already acquired answer.
- Approve only a summary hash rather than the complete action.
- Remove the ref old-value check or repeat publication after lost acknowledgment.
- Treat a matching tree as sufficient proof of this occurrence's publication.
- Drop opaque provider replay data while claiming stateless continuity.
- Ignore whole-state labels, reset budget at restart, or count incomplete checks as passing.

Mutants are test-only and removed/disabled in production. State explored bounds, omitted assumptions, and counterexamples. No numerical review/test count substitutes for a deciding invariant witness.

---

## 19. Performance, usefulness, and comparison

### 19.1 Questions to answer

The report must answer whether this application benefits from mobility in the measured workloads, what it costs, and which advantages are architectural rather than speedups. No predetermined performance victory is required.

Measure: useful task completion, transferred bytes, remote round trips, time to first useful evidence/proposal, time excluding human dwell, actual tool/model work, journal overhead, browser verification overhead, state/image size, maximum live memory under the measured definition, restart/reconciliation time, retained storage, and operations required from the user.

### 19.2 Matched stationary baseline

Use the same authored application/control and task contracts in a **qualification-only stationary origin configuration** whose authorized bindings proxy the same repository/model/check leaf operations to W. It has the same schemas, scope, mandatory validation, approval, and external execution restrictions. It is not permitted to disable durability or authority checks just to look faster.

The baseline's proxy bindings legitimately satisfy local capability requirements for that experimental deployment; do not fake `Here` when its actual bindings/constraints are not met. Use distinct signed deployment grants identifying this comparison profile. The proxy may transport an already authorized leaf request but cannot reconstruct workflow, issue a different request, or create a second run owner.

Do not ship this as an unexplained second production path. Keep the comparison harness small and isolated. If exact same-image comparison requires different explicit runtime arguments, record that difference and preserve shared authored control; never label different agent strategies as a pure mobility comparison.

An additional stationary-workspace/remote-human baseline is useful only if it can share the same semantics without expanding this implementation. It is not a prerequisite or an excuse to build another product.

### 19.3 Controlled measurements

Use deterministic matched provider replies to isolate mechanics. Vary admitted repository working-set size, number of leaf requests, and whole-checkpoint size independently where possible. Measure both cold image admission and warm authenticated image-cache hits.

For reported latency cells, collect at least 30 matched pairs in randomized or alternating order after declared warmup. Record all attempts, failures, refusals, and exclusions with reasons; do not silently discard slow/failing pairs. Report distributions and paired differences, not just a favorable single sample. Do not present a 30-sample p95 as a precise tail guarantee.

Include local transport and at least two explicitly declared emulated network delay/bandwidth conditions. Emulation is not a WAN deployment; keep the actual two-machine measurements separate. Record whether TLS setup, image cache, runtime preparation, database sync, and browser verification are included in each measurement.

### 19.4 Attribution and fairness

Separate authoring/compilation from deployed execution. Separate model latency/cost from pure placement mechanics. Exclude human review dwell from one clearly labeled computational latency view, but also report full task elapsed time.

Use identical admitted inputs, task goals, checks, model fixture replies, tool execution counts, resource ceilings, and final expected outcomes when claiming a mechanical speed/traffic difference. If mobility changes the model trajectory or evidence strategy, report a complete application comparison instead of attributing the difference solely to transport.

Do not claim saved tokens from reduced checkpoint bytes. Do not claim avoided data export when the same source is retained in a checkpoint or sent to the provider. Record unfavorable results and workload regimes where mobility transfers more bytes or takes longer.

### 19.5 Live usefulness

Use an operator-approved holdout corpus with task IDs, exact base revisions, allowed scope, and independent acceptance criteria fixed before model execution. Include successful repairs, already-correct/no-change tasks, insufficient-information tasks, stale-base conflicts, and tasks outside the configured capability/profile.

Record model/reasoning/profile, per-task physical attempts/usage, candidate revisions, actual checks, human amendments, final status, and whether the result met the independent contract. A single successful task establishes an integration witness, not a general success rate. Report every holdout task, including abstention/failure.

A live comparison may use the same configured provider/model but cannot promise identical samples. Distinguish model variance from runtime mechanics. Never run extra paid trials merely to obtain a favorable report.

### 19.6 Performance disposition

Preserve inherited production limits and correctness. Flag new unexplained material regression in unchanged local/resident paths and investigate before acceptance. Do not inflate budgets to conceal it or keep unused optimization alternatives in production.

The application may be worth delivering even without a speedup because its execution survives origin loss or stays near authority. State that conclusion only for the demonstrated behavior. Measurements decide any later automatic placement-cost tuning; no scheduler/optimizer project is required here.

---

## 20. Implementation sequence and PR discipline

### 20.1 Work packages

These are implementation slices within one coherent task, not separately optional projects.

| Slice | Work and deciding exit |
|---|---|
| W0 — consume the foundation | Verify final migration tuple, establish inherited mobility/application regression baseline, inspect current repository/workflow instructions. Exit: accepted subjects and real blockers recorded. |
| W1 — authored skeleton | Add the independent mobile repository consumer, typed contracts, modes, bounded inquiry/critic state, placement calls, and negative admission tests. Exit: public authoring works and a deterministic non-tail round trip runs on the existing runtime. |
| W2 — repository capability | Reuse scoped repository safety; add immutable snapshots, pagination, exact bounded candidate trees, and qualified check profiles. Exit: independent checks distinguish valid/invalid candidates without target mutation; Zig isolation probes pass on the qualified platform. |
| W3 — durable human seam | Extend the existing journal/custodian minimally for deferred questions and answer acquisition; integrate real session-authenticated UI. Exit: restart/duplicate/stale/cancel races pass with fresh Workers. |
| W4 — model integration | Connect the existing provider owner to deployment bindings, durable attempt limits, disclosure checks, and replay-data preservation. Exit: deterministic transport/restart/negative tests pass without a host tool loop. |
| W5 — protected publication | Compose approval placement, canonical proposal/commit binding, conditional one-ref publication, reconciliation, and postcheck outcomes. Exit: stale/conflict/crash/concurrency tests prove exact publication and no blind retry. |
| W6 — complete application | Join the slices; run inspect/propose/publish, repeated tasks, cleanup, denied-export route, full browser round trip, and installed commands. Exit: full application works from the extracted archive. |
| W7 — qualify and measure | Run acceptance matrix, inherited regressions, cross-engine witnesses, faults/models/mutants, comparisons, and authorized deployed/live/person lanes. Exit: truthful exact-head report with no hidden omissions. |
| W8 — close out | Remove displaced scaffolding and dead paths, update documentation/package inventory/PR, rebind changed artifacts, complete current review workflow. Exit: requested deliverables and remaining external blockers are explicit. |

### 20.2 Likely repository owners

Validate actual paths at implementation time. Prefer these existing owners:

| Area | Starting owner |
|---|---|
| Application authoring | `test/consumers/` public consumer pattern; add a named mobile repository consumer and reuse inquiry/review/document compositions. |
| Placement / approval | Existing `agent.mobility`, protected approval placement, and their source/test owners. |
| Repository tools | `runtime/repository.mjs`, `runtime/repository_delivery.mjs`, `runtime/document.mjs`, existing snapshot/test helpers. |
| Isolation | `runtime/inquiry_sandbox.mjs` and current repository execution owner; add a qualified Zig profile rather than a parallel sandbox framework. |
| Model transport | `runtime/model.mjs`; reuse normalization/endpoint admission from existing consumers. |
| Host lifecycle | `runtime/mobility/custodian.mjs`, `journal.mjs`, `policy.mjs`, `deployment.mjs`, CLI, and existing browser bridge/client. |
| Package/build | Current `emit-agent4`, build graph, use-archive inventory, installed command tests, dependency verifier. |
| Evidence | One application acceptance document plus machine-readable results in the existing evidence/artifact pattern. |

Do not force these paths when post-migration code has a better existing owner. Changing a filename to match the spec is not a deliverable.

### 20.3 PR handling

Read current repository instructions and the installed `$actuating` workflow first. Use the user's selected model and reasoning configuration for implementation and review; this spec adds no model comparison or arbitrary review quota.

Create one draft Agent PR after the first substantive semantic/test commit, assign it to `tkersey`, surface its URL, and update the same draft after meaningful slices and before ending a session with changes. Do not wait until all tests are green to expose the work. Do not create a docs-only ceremonial PR merely to satisfy this paragraph.

Prefer rebase for branch maintenance and preserve unrelated work. Do not reuse or rewrite another agent's in-flight branch. Current failing, passing, and not-run checks must remain visible with their actual subjects; do not erase failed history when a scoped recovery succeeds.

If conditional core repairs are necessary, the only merge dependency order is **Boundary → World → Agent** for those repositories actually changed, followed by final runtime/source/artifact rebinding. No no-op core PRs.

### 20.4 Permission boundary

Implementing from this handoff authorizes normal scoped source edits, tests against isolated fixtures, and requested draft PR preparation subject to the current tool/user permissions. It does not authorize merge, auto-merge, ready promotion, release publication, force-push over unrelated work, production data changes, provider spending, remote source disclosure, trust-store changes, or infrastructure provisioning.

Document preparation itself performs none of those actions. Implementation agents must perform available work in the current task and report actual results; do not promise background monitoring or later delivery without an available authorized automation.

---

## 21. Evidence and completion criteria

### 21.1 Required retained deliverables

Deliver the compiled application and all runtime/UI/config/CLI integrations; bounded repository and Zig profiles; deferred human lifecycle; protected managed publisher; deterministic and browser/fault/package tests; comparison harness; executable deployed/live qualification; and concise runbook.

Retain one acceptance report with machine-readable rows containing at least:

```text
acceptance_id
status: passed | failed | not_run | blocked | not_applicable_with_reason
source_commit_and_tree
dependency_runtime_compiler_profile_identities
command_or_scenario
expected_observation
actual_observation
evidence_artifact_or_digest
platform_and_storage_scope
blocker_or_limitation
```

The report may reference existing artifacts; do not duplicate every log into Git. Hash/retain the small decisive records and use the normal durable evidence location. Machine-generated reports are not application control state.

### 21.2 Exact-head qualification

Evidence must identify the source and artifacts actually executed. Dirty-worktree measurements must say so and identify the constructed source where possible. A later code change invalidates affected claims until requalified; a documentation-only change does not magically invalidate unrelated exact-binary evidence, but correspondence must be explicit.

Run relevant inherited and new aggregates with source-independent dependency pre/postflight. Verify installed commands, archived artifacts, UI, and actual runtime acquisition—not just source-tree unit tests. Cross-engine byte agreement supplements, rather than replaces, independent expected outcomes and authority tests.

### 21.3 Completion states

Use these distinctions in the final implementation report:

| State | Meaning |
|---|---|
| Implemented | Required source, UI, adapters, commands, package integration, and test/qualification harnesses exist. This alone is not qualification. |
| Reference-qualified | Mandatory unattended application, authority, isolation, fault, browser, package, and regression checks passed on identified profiles. |
| Deployment-qualified | Actual two-machine behavior passed with recorded hosts/network/storage identities. |
| Live-qualified | Actual authorized provider and actual-person workflow passed its independent task acceptance. |
| Complete | Required implementation and reference qualification are done, the requested deployed/live/person lanes have passed, evidence is current, and no unresolved accepted correctness/security defect remains. |

Missing authorized hosts, credentials, human participation, or qualified OS facilities may leave specific external lanes blocked. Report a useful reference-qualified implementation with those exact gaps; do not call it fully complete or equate a fixture with the missing lane. Conversely, an external blocker does not excuse omitting the implementation or deterministic tests for that lane.

### 21.4 Final user-facing implementation summary

State what the person can now do, how to launch the installed application, where the managed branch/result lives, actual PR URLs and merge order, exact qualification subjects, measured benefits/costs, and genuine remaining blockers.

Do not conclude with only a list of files changed, “tests pass” without scope, an unverified performance claim, or instructions that make the user reconstruct the deployment from scattered internal notes.

---

## 22. Non-goals and extension boundaries

This version does **not** require a new effect calculus, new World evaluator/ABI/state format, transparent arbitrary process migration, movement of an in-flight socket/stream/tool process, multi-custodian active execution, timeout takeover, decentralized consensus, a capability marketplace, automatic global placement optimization, or a cloud/Kubernetes control plane.

It does not add arbitrary shell execution, general network-enabled builds, production mutation of the user's checkout, remote pushes, automatic GitHub PRs from the application, merges/deployments, unapproved rollbacks, unbounded multi-file refactoring, binary/symlink/submodule changes, or arbitrary provider-hosted tools.

It does not claim power-loss durability, protection against a malicious trusted host, general storage-rollback detection, universal exactly-once effects, automatic secret detection, arbitrary browser/platform support, broad live-model correctness, or guaranteed speedups.

A future extension may add another qualified execution profile, larger admitted scope, remote-human behavior for W-only state, new capability placement policies, or explicit upstream publication. Each needs its own authority/semantic contract and deciding tests. None is a prerequisite to delivering this application, and none may be smuggled in as a workaround for a failed required invariant.

## 23. Sources and provenance

Repository observations were inspected on October 4, 2026. Source links below are evidence for the starting implementation, not alternative task instructions. Immutable code references use the inspected Agent candidate `0fff382ae65a93811a61b523573f254635a4fde1` or the merged mobility baseline. The final post-migration tuple must be discovered and qualified under Section 2.

**S1 — Merged mobility implementation.** [Agent PR #41 — Add durable effect-directed agent mobility](https://github.com/tkersey/agent/pull/41). The merged record establishes the delivered foundation; historical body sections and earlier qualification counts must not override its later exact-head closeout.

**S2 — Mobility construction and deployment contract.** [Effect-directed mobility guide at merged baseline](https://github.com/tkersey/agent/blob/4393e04393b97f018c02df7be995851c1c22bb82/docs/effect-directed-mobility.md). Source for `resolve`/`relocate`/`ensure`, approval placement, durable custody, whole-state admission, browser execution, cleanup, recovery, and stated qualification limits. Historical “in development” prose is not a claim that the subsequently merged work must be reimplemented.

**S3 — In-flight migration and dependency order.** [Agent PR #42](https://github.com/tkersey/agent/pull/42), with prerequisite [Boundary PR #164](https://github.com/tkersey/boundary/pull/164) and [World PR #62](https://github.com/tkersey/world/pull/62). Agent status was rechecked for this specification; these mutable PR pages must be rechecked at implementation, not treated as permanent completion receipts.

**S4 — Existing deployment loader.** [runtime/mobility/deployment.mjs](https://github.com/tkersey/agent/blob/0fff382ae65a93811a61b523573f254635a4fde1/runtime/mobility/deployment.mjs). Source for authenticated runtime loading, supported adapter kinds, policy/custodian setup, and generic pump ownership.

**S5 — Existing dispatch and executor owner.** [runtime/mobility/custodian.mjs](https://github.com/tkersey/agent/blob/0fff382ae65a93811a61b523573f254635a4fde1/runtime/mobility/custodian.mjs). Source for resident lifecycle, saved control, current-occurrence dispatch, immediate byte-reply handling, unknown failures, and browser successor verification.

**S6 — Scoped repository leaves.** [runtime/repository.mjs](https://github.com/tkersey/agent/blob/0fff382ae65a93811a61b523573f254635a4fde1/runtime/repository.mjs). Source for list/read/search capability bounds, four-path write scope, and the explicit fixture-only repository test qualification.

**S7 — Existing single-file delivery boundary.** [runtime/repository_delivery.mjs](https://github.com/tkersey/agent/blob/0fff382ae65a93811a61b523573f254635a4fde1/runtime/repository_delivery.mjs). Source for proposal admission, exact preimage checking, uncertainty results, and the cooperative isolated-root contract. The managed Git publication protocol in this specification is a proposed application extension, not existing functionality asserted by this source.

**S8 — Inquiry composition and qualification limits.** [docs/resumable-inquiry.md](https://github.com/tkersey/agent/blob/0fff382ae65a93811a61b523573f254635a4fde1/docs/resumable-inquiry.md). Source for retained investigations, exact experiment applicability, candidate validation, protected delivery, repeated use, existing live entry, and macOS isolation caveats. Historical performance/image tables are not current application measurements.

**S9 — Existing live integration seam.** [runtime/inquiry_cli.mjs](https://github.com/tkersey/agent/blob/0fff382ae65a93811a61b523573f254635a4fde1/runtime/inquiry_cli.mjs). Source for provider function reuse and limitations of simply copying the independent CLI's driving/budget/checkpoint behavior.

**S10 — Git reference update primitive.** [git-update-ref documentation](https://git-scm.com/docs/git-update-ref), checked October 4, 2026. Supports the compare-with-old-value primitive. It does not establish cross-system crash atomicity, application authorization, or the correctness of the proposed publisher.

**S11 — Git immutable commit construction.** [git-commit-tree documentation](https://git-scm.com/docs/git-commit-tree), checked October 4, 2026. Supports construction from an exact tree and explicit parents. Application binding and approval ordering are specified here, not supplied by Git itself.

**S12 — Provider function schemas.** [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), checked October 4, 2026. Source for strict supported schema behavior; local admission and resource authorization remain this application's responsibility.

**S13 — Stateless reasoning continuation.** [OpenAI reasoning models](https://developers.openai.com/api/docs/guides/reasoning), checked October 4, 2026. Source for stateless encrypted reasoning defaults and preservation/replay guidance. Reverify with the selected provider/model at implementation.

**S14 — Client-managed conversation state.** [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state), checked October 4, 2026. Source for manually retaining/replaying conversation items; not a substitute for World continuation custody.

**S15 — Existing deployment schema example.** [docs/mobility-deployment.example.json](https://github.com/tkersey/agent/blob/0fff382ae65a93811a61b523573f254635a4fde1/docs/mobility-deployment.example.json). Source for current host, issuer, peer, image/program, cleanup, export, and quota configuration responsibilities.

The earlier `effect-directed-agent-mobility-spec.md` and `boundary-world-agent-zig-0.17.0-upgrade-spec.md` were consulted for continuity and sequencing. Their old implementation backlogs are not imported into this task; current accepted repository behavior and the complete requirements above govern this follow-on.

---

## 24. Direct coding-agent handoff

Use this entire file as the goal supplied to the current `$actuating` workflow. The following instruction is complete only together with the specification above; no previous conversation is needed.

```text
Implement the Mobile Repository Agent described in this file.

This is the follow-on AFTER the accepted Zig 0.17.0 migration of Boundary,
World, and Agent. Do not redirect the migration branches. Verify the final
source/package/runtime/compiler/library tuple and inherited qualification
before changing production application code. Do not pin the historical
candidate hashes or artifact IDs merely because they appear in this file.

Start from the already merged effect-directed mobility implementation.
Keep one World execution model and one existing mobility custody/occurrence
owner. The program owns investigation, action selection, placement, revision,
approval composition, and cleanup. Hosts own actual capabilities, authority,
durable external replies, and protocol mechanics—not application phases.

Build a real authenticated browser-to-workspace repository application with
inspect, propose, and exact-approval publish modes. Reuse inquiry/review,
model normalization, repository/document safety, approval placement, the
existing mobility environment, package inventory, and dependency verifier.

Deliver immutable repository snapshots, bounded multi-file candidates,
independent candidate validation, a qualified Zig 0.17.0 check profile, real
provider integration, stateless replay continuity, durable human questions,
and a usable browser UI. Preserve non-tail state, owned investigations,
cleanup captures, budgets, and whole-state classification across moves.

Publish only the exact approved commit to one narrowly authorized managed
Git ref using its old-value precondition. Leave the user's active checkout
and upstream branches untouched. Persist exact publication intent before
dispatch. Reconcile lost acknowledgments; do not repeat an uncertain write.
Do not expose an approval grant or replace it with a boolean/host assertion.

Use isolated fixtures by default. Keep real model/data/spend, actual-person,
and two-machine qualifications separately authorized and explicitly reported.
Implement their launchers and tests even when the required external inputs
are not currently available. Do not mislabel a fixture as a live result.

Open one draft Agent PR after the first substantive semantic/test slice,
assign it to tkersey, surface the URL, and keep it updated. Add Boundary/World
PRs only after a deciding test demonstrates a generic deficiency. Use the
current repository instructions and selected model/reasoning configuration.
Prefer rebase, preserve unrelated work, and follow the installed review
workflow without inventing a new quota or governance framework.

Work through W0–W8, map MR-001 through MR-096 to actual evidence, run inherited
and new qualification on exact subjects, execute installed/package commands,
retain unfavorable measurements, and remove displaced scaffolding. A test
skip, an expired artifact, or a missing live credential is not a pass.

Return the actual PR(s), dependency order, launch instructions, qualified
artifacts, measured results, and exact remaining blockers. Do not merge,
promote, publish releases, spend on providers, alter trust, or mutate real
user repositories without the separate applicable authorization.

Deliver the application, not another mobility mechanism or a host-side
workflow engine.
```

**End of specification.**