# Provider-neutral decision contract

`agent.decision.jsonContract(Compiled)` projects the closed `Action` tagged
union into deterministic JSON Schema for external structured-output providers.
It does not execute in the Machine and is not an alternate semantic type
system.

The projection exposes its format version, Action schema digest, closed variant
catalog, canonical JSON bytes, and semantic SHA-256 digest. Every branch uses
one constant action name and an exact `arguments` object with required fields,
bounded values, and `additionalProperties: false`.

The repository-repair artifacts are installed as:

```text
zig-out/agent-actuality/repository-repair-decision-contract.json
zig-out/agent-actuality/repository-repair-decision-contract.sha256
```

The digest file contains the semantic contract digest, not merely the hash of
the presentation bytes. The capability must validate structured JSON against
this exact contract, recheck UTF-8 byte and integer bounds, map the stable name
to the exact tagged-union variant, and encode canonical Boundary Action bytes.
Only those Boundary bytes cross Effect protocol v1 with semantic authority.

The model-facing shape is:

```json
{
  "action": "read_file",
  "arguments": { "path": "src/range.mjs" }
}
```

Unknown actions, missing or extra fields, invalid enums, overlong text, and
out-of-range values are rejected before the Machine resumes.
