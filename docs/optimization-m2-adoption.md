# M2 semantic compilation adoption — in progress

This successor preserves cutover PR #39 at `c181ef5`. Boundary authoring is rebound
to `8321156276ef5ffbbaecd618a8cb8412da73d449` (Boundary draft #162). The downloaded
GitHub archive's reconstructed Git tree matches the commit API, and the source,
Zig-managed package and extracted-package inventories have been checked. The World
lock, authenticated runtime and kernel are unchanged; no kernel was rebuilt or
republished for this change.

## Contract and authority

Owned document, inquiry/ReAct, review, repository and parser product emitters select
semantic compilation. Generic `agent.compile` remains structural unless its caller
selects another contract. Both go through the same Boundary implementation and P01.
Agent registry admission still precedes Boundary compilation. Compiled-tool linking
now forwards the complete contract, growth/hard limits, work/round limits and
observations after original interface, role and borrow checks. Open object emission
still defers whole-program compilation to that link.

The parser CLI's documented `--max-quanta` is an image-relative work allowance:
10,000 drives of 100 World work units by default. Its model/check allowances are
separate host counters charged before environmental operations and outside World
rollback. None of those limits is changed. Exhaustion retains the actual checkpoint
and exact pending ingress; no operation is automatically repeated. New images may
reach different private points at the same quantum. Same-image stepping, restore,
capacity handling and interruption remain World obligations. Paid-model consent,
role classification, speculative restrictions, exact-proposal binding, approvals,
locks, cleanup and runtime acquisition retain their existing owners.

## Current evidence and unresolved qualification

At Boundary `8321156`:

- GitHub commit/tree, source archive, extracted package and actual Zig-managed
  package inventories verify. The existing World source/runtime tuple also verifies.
- Managed-package component tools and economy probe: terminal success, 10/10 steps.
- Fresh source emission completes all 18 workloads under unchanged default work
  limits: ten applied, eight legal no-ops, zero work-limit outcomes.
- ReAct image: 49,604-byte structural baseline → 41,021 bytes. Inquiry repair:
  35,591 → 35,257; repeated inquiry: 35,973 → 35,637. Image size does not prove speed.
- Combined authoring/native/integration/economy validation is pending its terminal
  result; it is not credited as passing.

Historical evidence at the initial `517cfb1` pin remains distinct: authenticated
source authoring passed 314/314 build steps and 136/136 Zig tests; managed component
tools passed 7/7 steps. Ten corpus workloads exhausted optimizer limits then.
The new pin includes the edge-demand/capture-lifetime corrections and bounded GVN
work over applicable regions, with independently indexed certificate validation.
Fresh emission above supersedes the budget failure for this corpus; it does not
relabel the earlier checks as new-head evidence.

Native/Node/WASM/browser behavior, separate World admission/execution/memory and
checkpoint costs, package bindings and cumulative C0 comparisons remain pending.
The accepted cutover costs remain in the baseline; no new World regression is
accepted implicitly. No PR is ready to merge and no merge/release is authorized.

## Native admission-memory observation

`conformance/agent4/m2-admission-memory.json` binds all 18 images in three arms:
the original C0 corpus, retained cutover corpus and freshly emitted M2 corpus.
One ReleaseSafe executable uses World `f8a1597` and Boundary `8321156` for every
arm. Twelve admissions per image measure Workspace peak payload and retained
Prepared storage. Timings are omitted because qualification was running.

ReAct peak admission payload falls **1,524,416 → 1,364,714 bytes** versus cutover
(159,702 fewer), and retained storage falls by 129,662 bytes. Two new costs need
resolution: review-model peak **104,388 → 108,166** and retained storage
**91,486 → 95,146**; clarify-first retained storage **281,526 → 294,120** despite
a slightly lower peak. These increases are not covered by the earlier acceptance.

The allocation breakdown identifies growth in the admission analysis set pool:
review-model has 455 → 473 interned nodes, crossing capacity 455 → 692;
clarify-first has 1,559 → 1,623 nodes, crossing capacity 1,580 → 2,379.
Decoded-record storage falls in both cases. This is evidence against using image
size alone as the cost model. Selection/representation repair remains open;
no validation, memory threshold or mandatory P01 requirement has been waived.
