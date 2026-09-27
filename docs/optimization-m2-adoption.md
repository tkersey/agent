# M2 semantic compilation adoption — in progress

This successor preserves cutover PR #39 at `c181ef5`. Boundary authoring is rebound
to `e82386e2a2a7446b87bfa0b7a2409f2c88a00ada` (Boundary draft #162). The downloaded
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

### Owned-consumer policy audit

Source inspection at `fb8478d` covers the deliberately selected semantic emitters
and their actual host boundaries. This is a policy finding; final execution and
cost qualification remain separate.

| Consumer/boundary | Protected policy and owning source |
| --- | --- |
| Every Agent compile and compiled-tool link | `src/authoring.zig` verifies the original registry/module before either lowering or linking. `src/compiled_tool.zig` binds imported role, nominal identity and borrows before forwarding the complete compilation selection. Model effects cannot enter the read/simulation tool profile. |
| Inquiry/ReAct | `runtime/inquiry_cli.mjs` enforces invocation-wide model, request-byte, experiment and elapsed-time allowances; charges external work before dispatch; checks inference/write authorization separately; and cancels the actual parked State on exhaustion. Those counters are outside World rollback. |
| Parser and paired constructions | `runtime/parser_cli.mjs` owns shared model/check counters and explicit image-relative quanta. Parking retains the real checkpoint plus pending ingress; consumed ingress is cleared after each drive. The Program's construction allowance (`test/consumers/incremental-parser/main.zig`) controls authored rounds, rather than billing for internal interpreter steps. |
| Review | `test/consumers/review/main.zig` owns review order and the one-call, nonparallel model-selection contract. Runtime tests supply responses and check those authored decisions. They do not derive authority from instruction counts. |
| Document and repository | Their `main.zig`, `consequence_live.zig` and `replacement.zig` modules retain live evidence, exact-proposal revalidation and approval outside speculative delimiters. `runtime/document.mjs` / `repository.mjs` retain path/content/write capabilities, locks and conditional delivery. Uncertain delivery is not automatically retried. |
| Cancellation, transfer and resumption | The runner and World remain the existing owners. Semantic compilation may change private progress points across images; it does not grant cross-image State transfer or alter same-image stepping. Saved requests and replies retain their exact bindings. |

The audited selections preserve these business-level limits and authored choices.
Parser quanta are explicitly an image-relative work allowance, not a security or
billing surrogate. Broader reusable callers retain the structural default unless
their owner explicitly selects semantic compilation. No authoring-uniformity
migration is required by this audit.

## Current evidence and unresolved qualification

At Boundary `e82386e`, the source archive, GitHub tree, extracted package,
Zig-managed package and existing World tuple verify. Managed component tools
pass 7/7 steps; the standalone economy build passes 3/3 steps. Fresh source
emission completes all 18 workloads and every image hash equals the cross-engine
candidate-selection probe. Six review runtime tests and 38 clarification
scenarios pass against the unchanged production WASM kernel (no native execution
comparison is claimed for these two focused commands).

Final integrated/serial/browser qualification, execution/checkpoint/timing costs,
consumer-policy completion and remaining M2 transformations are still open.

## Historical evidence at Boundary `8321156`

The previous bound input had these results:

- GitHub commit/tree, source archive, extracted package and actual Zig-managed
  package inventories verify. The existing World source/runtime tuple also verifies.
- Managed-package component tools and economy probe: terminal success, 10/10 steps.
- Fresh source emission completes all 18 workloads under unchanged default work
  limits: ten applied, eight legal no-ops, zero work-limit outcomes.
- ReAct image: 49,604-byte structural baseline → 41,021 bytes. Inquiry repair:
  35,591 → 35,257; repeated inquiry: 35,973 → 35,637. Image size does not prove speed.
- The combined aggregate reported a failing Node integration batch (93 passing,
  one failed and one cancelled, 95 total). Remaining task-owned work was stopped
  after this tuple was superseded; terminal exit 143. It is failed/incomplete,
  not a passing aggregate. Its functional economy report had no reported failures.

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

Isolated follow-up attributes the increases to expression reuse, rather than
dead-computation removal alone. Running DCE before reuse did not remove either
regression. An unshipped literal-rematerialization experiment removed the
clarify-first retention increase but left review-model above its cutover memory;
the remaining review-model reuse replaced four field projections with moves.
Neither experiment was retained. The unresolved selection/lifetime cost is not
a reason to change runtime ownership or waive the admission-memory criterion.

## Prepared correction and integration scheduling

Boundary `95277a26ef7d5fa04265a200f9d9fca7caed8981` is authenticated separately
while the previous tuple is still under test. Its standalone source economy
build passes 3/3 steps and fresh source emission completes all 18 workloads.
Every image hash matches Boundary's recorded candidate-selection measurement:
the two new native admission-memory increases are removed for these exact images.
This intermediate candidate was kept separate from the active `8321156` lock;
it was not adopted. The subsequent `e82386e` binding is qualified above.

The unchanged production WASM kernel subsequently exposed new `95277a2` costs
in review-mid_review and review-clarify_first: peak increases of 13,636/13,642
bytes and retained increases of 6,684/6,690 bytes. The three-fresh-kernel samples
and exact image hashes are retained in `m2-wasm-admission-memory.json`. This
candidate was not rebound into the active lock. Boundary's successor now
models native/WASM allocation growth from logical node counts; its closed-record
probe reduces those increases to 38/44 bytes, and its authenticated source/package binding and fresh emission now match those
measured records here.

The old concurrently scheduled Node integration batch completed with 93 passing,
one failing and one cancelled test (95 total): inquiry CLI and packaged-command
timeouts. The enclosing Zig aggregate was later terminated as superseded (exit 143). A focused invocation
of the unchanged inquiry CLI test passes both tests in 78.5 seconds, preserving
its 120-second timeout. Per-scenario reports show contention in the concurrent
attempt. The next integrated run serializes Node test files; every original case,
assertion and deadline remains. Its complete outcome is not yet established.
