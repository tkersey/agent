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
