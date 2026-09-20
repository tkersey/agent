# Recursive participant integration

Early implementation of the Defunctionalized Hyperfunctions and Recursive
Interaction specification v1.1, September 19, 2026. This is incomplete.

Boundary companion: https://github.com/tkersey/boundary/pull/153.
Foundation PRs Boundary #152, World #54, Agent #32 are merged. Immutable follow-on
bases are Boundary c7a08ed7c1e15732fc7373dd1f149cbe7da82e7b,
World 374ed712c2a2ab5041c28befa38bb3c3a859bd26, and
Agent e1b56f06ce0d91a8d7f324198a541f0b16b55a00. Existing authenticated dependency
bindings remain unchanged in this first slice.

## Admission discriminator

`test/agent4/compiled_tool.zig` now independently builds and encodes a Boundary
component with an external model-named operation. Boundary's object checker
accepts its type/effect contract. Normal `agent.compile` rejects it as a compiled
read tool, even with matching local schemas and identity, and also when its local
role is changed to model. This protects the existing tool boundary. The fixture
is deliberately not a fully qualified Agent model invocation; it establishes
that an external alias cannot grant model access.

The required positive participant path is not implemented. It must permit
internal callable/owned endpoints and actual checked model interpretation,
without using model-visible tool metadata as universal component admission.
Assessment must reject completion authority through imported or indirect calls.
The source-level admission walker currently rejects opaque imports in speculation;
Boundary's source-free linker alone cannot replace that protected-authority check.

## First production interaction to establish

Independently compiled producer and consumer exchange complementary demands.
The producer waits while its consumer requests a reference observation; a model
boundary supplies a typed contribution. Both saved callers perform non-tail work
after fresh World restore. A second owned participant remains idle and valid.
Nearby negatives cover unbound external effects, false reusable captures, and
assessment reaching completion. Host adapters implement declared environmental
leaves only; the linked Program retains partner routing and waiting callers.

This slice adds a normal-path rejection scaffold, not the positive participant
API, parser synthesis application, new scheduler, or acceptance claim. Required
parser tooling, independent evaluator, comparisons, full engine transfers,
measurements and serial reviews remain open. Paid model execution is not run.
