# Architecture

Agent 3 owns one staged transformation:

```text
complete typed system source
    -> source admission and derived tool/protocol catalogs
    -> ordinary Boundary Control IR and generic effect composition
    -> ordinary Boundary Program
    -> BPI1
```

There is one executable identity: BPI1 plus Boundary's program-transition
identity. A closure inventory or release receipt is provenance, not a runtime
manifest or second executable format.

## Permanent owners

| Owner | Owns |
|---|---|
| Boundary | Portable values, generic typed effects and handlers, BPI1, Process State, request/result identity, and the fixed evaluator |
| Agent | Complete system authoring, semantic model requests, faithful normalized-result interpretation, prompts, skills, typed action selection, epistemics, admission, and lowering |
| World | Fixed-kernel admission, fresh-instance one-reduction execution, Process codecs, and byte relay |
| Environment | Credentials, endpoint and workspace authority, network transport, and actual typed external results |

Boundary contains no Agent, model, prompt, skill, provider, or repository
concept. Agent contains no evaluator, second state format, agent bytecode, or
application-specific WASM backend. World contains no prompt renderer, model
selector, skill loader, action decoder, admission policy, or agent loop.

## Runtime law

For one validated image `P`, complete portable state `S`, and optional canonical
effect result `R`, World hosts the fixed Boundary kernel that computes:

```text
advance(P, S, R) -> Process outcome
```

The same image, InitialArgs, and ordered effect-result bytes produce the same
Process outcomes and requests. Host heap objects, callbacks, provider sessions,
skill paths, and runtime registries are not part of a resumable instance.

The default ReAct lowering preserves the ENF flow:

```text
Observation -> observe(Memory, Observation) -> Memory
Memory -> project(Memory) -> DecisionView
DecisionView + image constants -> complete semantic model invocation
faithfully normalized model result -> typed Action -> offered-set/current-policy admission
    -> local computation, typed external effect, authored failure, or completion
```

Model-visible function declarations, JSON schemas, typed decoding, dispatch,
and Observation correspondence derive from the same closed Action descriptors.
Local and completion actions do not become environmental effects. External
actions retain distinct Boundary effect contracts.

The semantic model handler is a trusted effect handler for faithful protocol
normalization, just as a repository handler is trusted to return the bytes it
actually read. It may not choose an Action or substitute decoded fields. The
image independently checks the returned call name, declaration ordinal, Action
tag, offered set, and policy before dispatch. Retained raw argument bytes are
audit provenance; arbitrary or malicious effect-result forgery is outside the
handler contract and can forge any declared effect result.

## Lifetime and portability

The canonical Agent 3 path has no mandatory Budget, final action, generation
counter, or universal turn/effect ceiling. Applications may author finite
policies. Representation capacities and physical interpreter capacity are
separate, accurately named bounds.

Process State is transferable and forkable. Re-advancing a pending state
reproduces its request; it does not provide distributed locking or exactly-once
effects. Environments independently enforce filesystem, credential, and
workspace authority while image-owned admission enforces portable application
policy.

Agent 2 Machine/World 3/capability topology survives only in immutable release
history. It is not an active Agent 3 build dependency or compatibility runtime.
