# DecisionContract v2

`agent.decision.contract(Compiled)` emits canonical `AGT_DCT2` binary bytes,
a deterministic JSON projection, strict provider-neutral Action JSON Schema,
and SHA-256 identities for the contract, Action schema, DecisionTurn schema,
and DecisionView schema.

The immutable contract contains instructions, the closed action catalog,
schema identities, runtime and epistemic identities, and rendering metadata.
Changing any semantic field changes the digest. JSON is a projection; the
canonical binary is authoritative.

The Machine carries only the 32-byte contract digest in each dynamic turn:

```text
contract_digest + goal + counters + phase + DecisionView + strategy_local
```

Instructions, action descriptions, Action JSON Schema, manifests, and complete
evidence are absent from DecisionTurn. A capability recomputes and admits the
exact static contract before provider invocation, verifies the request digest
and DecisionTurn schema binding, then renders static provider content before
the dynamic turn.

The contract digest is content identity, not a signature, secret,
authorization token, or mutable runtime configuration.
