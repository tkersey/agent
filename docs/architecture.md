# Agent 4 architecture

The application emitter constructs one Boundary source module. Agent checks its
catalogs and protected construction, then calls Boundary's compiler once. Boundary
owns type/effect/capture/use checking, continuation conversion, canonicalization,
and BPI2/PST2/ERQ2/ERS2/PKI2/PKO2. Unchanged World owns execution.

| Owner | Responsibility |
|---|---|
| Application | Control topology, declared policies, data retention and context projection |
| Agent | Typed domain constructions, semantic contracts, protected source admission |
| Boundary | Source calculus, portable values, checking, compilation and pure codecs |
| World | Program-relative state admission, interpretation, protocol framing and binding |
| Environment | Faithful typed results, credentials, authentication, atomic external operations |

`agent.system` binds InitialArgs, Result, Failure, optional descriptor catalogs and
an application emitter. `agent.compile` owns its temporary Builder/catalog/registry
storage; returned Boundary Compiled output owns independent storage. There is no
runtime callback registry, Agent control IR, compiler-selected application body,
or executable policy sidecar. ReAct is an ordinary library composition.

`Ask<Q,A>` is an internal typed demand. Its staged responder may ask a human, invoke
a model, compute a rule, or call another authored body. The same continuation
resumes at its call site. Answers do not become authority by their origin label.
The model responder captures the exact request-time offer set and selection policy,
constructs declarations from the closed catalog, and checks every returned claim.
The adapter preserves normalized items; the image owns candidate admission.

Internal dialogue packages own their futures. The surrounding program may retain,
resume, route, or dispose a child while serving another request. Only the complete
PST2 is portable execution state. A nested turn returns to its caller; only root
termination completes a conversation. Lexical Reader/state/region constructions
retain scopes across suspension and restore enclosing interpretations on exit.

Deliberation uses internal multi-shot resumption. Only immutable evidence crosses
into branch evaluation; captured mutable branch state follows Boundary's region
semantics. Agent additionally checks effect roles through bodies, handlers,
computation origins, forwarded capabilities, cleanup and successor handlers.
Approval, writes, commits, live-evidence acquisition and unclassified effects cannot
enter speculation. Higher-order admission conservatively checks every source
lambda sharing a computation schema. When unrelated code shares that schema,
`agent.callable.define(builder, function, signature)` gives the static function
identity its own ordinary Boundary computation schema; `agent.callable.value`
produces its lambda. Repeated definitions of the same function and signature
share that declaration. The helper asserts no safety: actual bodies, residual
rows and captures still pass the same final admission. Original structurally
interned source may remain conservatively rejected; the helper is a public source
composition with unchanged runtime semantics, not a new execution rule.

Live and simulation domain clients share a typed interface with distinct
observations. Only the corresponding live read owner can mint the private evidence
required by a live-precondition approval. Data can inform speculative assessment;
its authority remains outside the captured continuation.

`approve_and_commit` retains the exact proposal and authority occurrence, checks
structural equality, authenticating-adapter principal scope, current policy and
required live evidence, then consumes its internal grant before the sole commit
request. Amendment needs another occurrence and decision. Uncertain delivery is
returned for explicit reconciliation, never automatic replay. External operations
atomically enforce their final preconditions.

Protected admission scans actual source, including alternative entry/handler edges,
instead of trusting a list of helper names. Native application authors choose policy
and are trusted not to mutate Builder internals or forge admission metadata. Raw
Boundary authoring without the same Agent gate carries no protected-system claim.

The bridge delegates to World and returns original canonical outcomes. Inspection
is a non-authoritative view. Missing input stays parked; cleanup can itself park.
Killing an execution worker produces no authoritative successor or cleanup proof.
Content identity, conversation identity and delivery occurrence are distinct; whole
snapshot copies can replay prior control and require environmental safeguards.
