# M2 semantic compilation adoption — in progress

This successor preserves cutover PR #39 at `c181ef5`. Boundary authoring is rebound
to `517cfb1670671f8b9383aa8711b76c30a01f32ad` (Boundary draft #162). The downloaded
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

- Authenticated-source `check-agent4`: terminal success, 314/314 build steps,
  136/136 Zig tests; subordinate Node/negative/installation checks also completed.
- Managed-package `build-component-tools`: terminal success, 7/7 steps.
- The existing World source/runtime tuple verifies with the new Boundary pin.
- The updated economy probe builds and emits the 18-workload corpus. It records
  semantic outcomes and the semantic-optimization phase separately.
- **Ten workloads exhaust semantic work limits** and therefore return the validated
  structural baseline: sharing-64, document-consequence, clarify-first,
  inquiry-repair, inquiry-repeated, inquiry-react, document, review-mid_review,
  review-clarify_first and review-model. They are not credited as optimizer wins.

Boundary follow-up is active: GVN scans unrelated functions/predecessors and the
pipeline's broad reservations reject large real records before useful work. A
larger-corpus probe also exposed a DCE producer still needed by an explicit edge
assignment; candidate admission correctly rejected it. These upstream issues must
be corrected, repinned and the complete corpus requalified before adoption closes.
The initial authoring aggregate does not substitute for that final qualification.

Native/Node/WASM/browser behavior, separate World admission/execution/memory and
checkpoint costs, package bindings and cumulative C0 comparisons remain pending.
The accepted cutover costs remain in the baseline; no new World regression is
accepted implicitly. No PR is ready to merge and no merge/release is authorized.
