# Consequence-sensitive clarification

`agent.clarification` is an opt-in authoring composition. It runs a captured
proposal continuation for each interpretation, compares exact operative keys,
and asks about the resulting actions when the declared decision needs a choice.
All of this control becomes ordinary BPI2, executed by unchanged World.

The complete example is the `consequence` mode of the existing
[document consumer](../test/consumers/document/main.zig). Its numeric
clarification and critic modes retain their original behavior and image identity.
There is no migration of old document snapshots to the new program.

## Authoring contract

The external consumer uses the same public `agent` package as ordinary consumers:

1. `clarification.define(builder, spec)` declares portable candidate/key schemas,
   a native-authored `Domain.finite` ID set or `Domain.open`, and a deliberation
   scope. Finite declarations reject empty or duplicate domains.
2. The authored body calls `deliberation.choose` with `definition.multi`, then
   produces `(hypothesis ID, Known(candidate, key) | Unavailable | Rejected |
   Inconclusive)`. The application supplies proposal validation and derives its
   decisive facts. Provider data cannot supply a completeness certificate.
3. `clarification.explore(context, definition, body, arguments, mandatory)`
   registers the actual body, runs the existing multi-shot collector, and
   classifies every returned evaluation. `body` is an authored computation
   value, not a host callback. `mandatory` is ordinary authored task/policy data.
4. `clarification.resolver` declares `(context, classification) -> resolution`.
   Its pure authored presenter receives the retained context and consequence
   groups. The typed interaction accepts an offered ID, Other, NotSure, turn
   abort, or conversation close. Only an actually offered ID selects a group.

See [the proposal composition](../test/consumers/document/consequence_proposals.zig)
and [question presentation](../test/consumers/document/consequence_question.zig)
for the complete consuming example. A separate numeric instantiation exercises
three hypotheses, grouping, permutations, and private scratch across suspension.

The result schemas distinguish Common from Selected. Groups contain a canonical
offered ID (the minimum member ID), a representative ordinary result, and all
member IDs. Invalid/incomplete evaluations remain in the Unresolved result;
Other, NotSure, and unoffered selections have distinct non-action reasons.

Classification checks nonempty coverage, uniqueness, membership and every Known
status before grouping. Open domains always need qualified confirmation with an
Other route. Mandatory clarification offers interpretation choices even when
keys agree. Otherwise a complete finite domain with one exact action class
returns Common without claiming that intent has been resolved.

Structural comparison uses `agent.value_equality`; it compares the complete
declared portable key. The application owns the claim that this key includes
every operative field. Candidates, keys, context and outgoing presentation reject
nested internal types. Presentation is pure. Exploration permits declared model
effects and non-external internal/simulation effects; existing protected
admission checks the actual transitive functions, handlers and captures.

## Controlled document task

The typed request contains target path, old literal, replacement literal,
mandatory-scope policy, archive permission and attempt ID. Its only unresolved
dimension is `active_section` (ID 1) versus `whole_document` (ID 2).
This is a finite application contract for that task, not an interpretation model
for arbitrary editing prose.

The example admits UTF-8 documents of at most **512 bytes**, with exactly one
`Active policy:\n` marker preceding exactly one `Archive:\n` marker. The active
region lies between them. Replacement is case-sensitive, non-overlapping, and
scans the original text, so a replacement containing the old term cannot recurse.
All other bytes are preserved. Empty old terms, malformed markers, marker edits,
new markers and capacity overflow are explicit invalid results. These capacities
belong to this example; existing public profile defaults are unchanged.

Each branch invokes the existing model responder with the scoped interpretation,
frozen document, terms and target. The program subsequently constructs the exact
permitted edit, checks the returned replacement against it, and derives whether
archive text changes. A refusal, interrupted transport, unknown action, wrong
argument type, unavailable/inconclusive result or wrong edit prevents agreement.
The model supplies data; it never executes proposed tools.

The decisive key is the complete `Action`: operation kind; exact proposal path,
base content **and** digest, replacement bytes, provenance, required principal
and reason; original typed task; and policy identity. Mutations of all 15 scalar
or blob leaves are tested. No score, narrative similarity or digest alone stands
in for the operation. The separate consequence label is derived from the checked
edit, including its actual archive suffix.

If `customer` occurs in both sections, the question offers the two exact edits
and says which changes archived text. If it occurs only in the active section,
both branches yield the same operation: no clarification occurs, and scope intent
remains unresolved. A forbidden archive edit makes that branch Rejected and the
decision Unresolved; it is never offered as a checked executable alternative.

## Live continuation and lifetime

The initial protected observation proof is consumed before exploration. Only
ordinary immutable data enters the multi-shot future. After resolution the
application reacquires live evidence, compares exact content and digest, and
uses the retained target and policy. Staleness returns a conflict without
approval or replacement. Even NoChange rereads, then consumes its proof without
requesting write approval.

A mutation enters the existing exact-proposal/principal/evidence approval path.
An identical amendment creates a fresh challenge. A different operation needs a
new task; approving such an amendment returns `unresolved_approval`, as does a
failed authority check. The unchanged real-file adapter conditionally replaces
the exact base, catching a change during approval under its documented cooperative
locking contract. Uncertain delivery remains uncertain and is not retried.

Other, NotSure, unoffered choices and turn abort leave the file unchanged and
allow another turn. Close exits the conversation through Boundary's existing
disposal/unwinding construction. Turn and conversation cleanup can each suspend.
Global cancellation is distinct and preserves request binding during cleanup.

The waiting task retains its proposals and option mapping in PST2. Answering
does not repeat completed assessments. Tests restore a live template on a fresh
Wasmtime guest during a model request, and transfer the later question, approval
and cleanup too. Native, Node/WASM and Wasmtime use identical canonical outcomes
for equal bound replies. The originating compiler and guest are unnecessary.

State-content binding cannot distinguish two occurrences that recreate the exact
same State. The program therefore owns a persisted turn counter, advances it once
at turn entry, and includes the current turn in the retained question context.
Every normal, failed, declined and aborted turn carries it forward. Caller attempt
labels and provider call IDs may repeat; a third identical question still rejects
the prior ERS2. The example's u64 counter fails on exhaustion instead of wrapping;
it is ordinary application data, not runtime fuel or a host nonce service.

Conversation memory retains a counter and one receipt (12 bytes after a decision):
whether there was an explicit choice and which of the two interpretations it
supports. Common actions retain both possibilities. Eight repeated turns leave
the same reachable graph size between
turns: 10 nodes, two blobs, the conversation's cleanup obligation, and no template,
branch, resource or owned child package. This is a bounded witness, not a claim of
constant space for arbitrary numbers or sizes of candidates.

## Exercise and validate

```sh
zig build check-agent4 -Doptimize=ReleaseSafe
node tools/agent4/setup.mjs
zig build check-agent4-integration -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
zig build check-agent4-economy -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

`zig build emit-agent4 -Doptimize=ReleaseSafe` emits
`zig-out/agent4/document/consequence.bpi2` and `consequence.args` without World.
The independent document package emits these too. Use archives include the
`document-consequence` example and require only the existing World host contract.
The clarify-first image is a test construction and is omitted from use archives.

The commands select authoring/ownership negatives, native numeric
and document checks, the existing regressions, 38 prescribed real-file cases,
fresh-guest transfers, and execution of the actual packaged application image.
The fixture runner uses deterministic provider envelopes and people; it needs
no credential, paid inference or customer file. Test outputs use the existing
`.agent4/out` and `zig-out/agent4` locations and are not maintained source records.

## Measured cost and limits

The paired comparator uses the same document, proposal body, synthetic responder
and final approval/conditional replacement path. Counts are separate:

| Fixture / order | Clarifications | Model assessments | Approvals |
|---|---:|---:|---:|
| Convergent / consequence-first | 0 | 2 | 1 |
| Convergent / clarify-first | 1 | 1 | 1 |
| Divergent / consequence-first | 1 | 2 | 1 |
| Divergent / clarify-first | 1 | 1 | 1 |

The complete consequence-first image is 14,355 bytes. Native statistics measure
one captured template and two activations per ordinary turn. The largest pending
PST2 in the simple convergent/divergent fixtures is 1,985 / 2,600 bytes.
The economy report binds the actual images, complete public compilation metrics,
semantic request/result bytes, provider-envelope bytes, pending State sizes and
history. It makes **no latency, token-cost or live-model quality improvement claim**.

The numeric composition's 1/2/3/8-hypothesis series has 19 compiled functions in
every image. Image sizes are 4,973 / 5,027 / 5,080 / 5,345 bytes; coverage constants
and guards grow with the domain. Measured pending peaks are 657 / 682 / 707 / 833
bytes, and result sizes are 34 / 42 / 50 / 90 bytes. One template is activated
1/2/3/8 times; the complete proposal application is not copied per hypothesis.

The existing model invocation transport is the extension point for a later live
study. Completeness of open natural-language hypotheses, model quality, optimal
question selection, automatic rebasing and global exactly-once delivery remain
unproved and outside this construction. Equal keys establish equivalence only at
the declared proposal boundary. Model calls are real external work, not rollback.

### Selected baseline

| Component | Immutable commit |
|---|---|
| Agent base | `3f624c17724ffe0df5ebf61f75c36303cd28334f` |
| Boundary 2.0.1 | `5084a0d487b886197863866e20ebe6d04de2a0a1` |
| World 5.0.1 | `fd794b36fe7f429fcd62def4d87556cb5ace56f9` |

Validation uses Zig 0.16.0 and the unchanged dependency lock. No Boundary/World
source, public ABI, format, toolchain pin or dependency update is part of this work.
