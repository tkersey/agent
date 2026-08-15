# DecisionContract v2

`agent.decision.contract(Compiled)` emits canonical `AGT_DCT2` binary bytes,
a deterministic JSON projection, strict provider-neutral Action JSON Schema,
and SHA-256 identities for the contract, Action schema, DecisionTurn schema,
and DecisionView schema.

JSON Schema `maxLength` counts Unicode scalar values, while Boundary `Text(N)`
is bounded in UTF-8 bytes. The generated schema uses `maxLength` as an early
provider-neutral bound. Capability admission also canonical-encodes the
selected Action and rejects strings whose UTF-8 representation exceeds the
Boundary type; the schema alone is not the portable-value decoder.

The immutable contract contains instructions, the closed action catalog,
schema identities, runtime and epistemic identities, and rendering metadata.
The epistemic identity includes the admitted custom implementation's explicit
lowering identity. Changing any semantic field or lowering identity changes the
digest. JSON is a projection; the canonical binary is authoritative.

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
