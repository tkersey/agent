# Agent Actuality v1

`repository-repair-actuality` is a compiled AgentDefinition using the existing
ReAct strategy. Its only runtime meaning is the generated Boundary Machine.
All six effects remain residual in the World application:

```text
model.decide.v1
repo.list.v1
repo.read.v1
repo.search.v1
repo.test.v1
repo.replace.approved.v1
```

The deterministic lane copies `fixtures/repository-repair-v1` into a fresh
temporary Git repository. It performs real reads, literal search, `bun test`,
request-bound fixture approval, and one atomic replacement. It proves a failing
test before the replacement, a passing test afterward, the hidden behavior
check, typed completion, fresh-instance continuation, retry, replay, branching,
and migration.

```sh
zig build check-agent-actuality-release
```

The live lane replaces only the deterministic decision capability. It uses the
OpenAI Responses API and requires an interactive human approval before the
workspace capability can mutate `src/range.mjs`.

```sh
OPENAI_API_KEY=... OPENAI_MODEL=... zig build check-agent-actuality-live
```

A published live receipt is a non-authoritative projection. Verify it against
independently obtained release archives and the application artifacts generated
from the exact Agent archive:

```sh
zig build check-agent-actuality-v1-live-receipt -- \
  --receipt "$RECEIPT" --receipt-sha256 "$RECEIPT_SHA256" \
  --agent-archive "$AGENT_ARCHIVE" --agent-archive-sha256 "$AGENT_SHA256" --agent-version 1.1.1 \
  --boundary-archive "$BOUNDARY_ARCHIVE" --boundary-archive-sha256 "$BOUNDARY_SHA256" --boundary-version 1.3.2 \
  --world-archive "$WORLD_ARCHIVE" --world-archive-sha256 "$WORLD_SHA256" --world-version 3.1.1 \
  --world-host-archive "$WORLD_HOST_ARCHIVE" --world-host-archive-sha256 "$WORLD_HOST_SHA256" --world-host-version 1.0.0 \
  --capabilities-archive "$CAPABILITIES_ARCHIVE" --capabilities-archive-sha256 "$CAPABILITIES_SHA256" --capabilities-version 2.1.1 \
  --application-wasm "$APPLICATION_WASM" --application-wasm-sha256 "$APPLICATION_WASM_SHA256" \
  --application-manifest "$APPLICATION_MANIFEST" \
  --initial-args "$INITIAL_ARGS" \
  --decision-contract-digest-file "$DECISION_CONTRACT_DIGEST_FILE"
```

The verifier hashes every supplied file, checks those hashes against the
independent expected values and receipt claims, and then checks the live
acceptance, approval, mutation, lifecycle, and redaction predicates. The
receipt remains evidence only; it does not authorize execution.

The application artifact is import-free. The current measured WASM is
5,912,631 bytes. This exceeds the provisional 2 MiB target because the direct
specialization contains the bounded 32 KiB text-bearing Action, Observation,
history, and decision-request schemas. It is a reviewed size exception, not a
runtime interpreter or strategy registry. The canonical Frame is 873,504 bytes
and remains below the declared 1 MiB Machine-state limit.

The generated WASM has a bounded 384 MiB stack and 512 MiB maximum memory. The
unchanged world-host public worker API admits that artifact under explicit
receiver policy with `maximumMemoryBytes = 512 MiB`; no Boundary, World, or
world-host semantic change is involved. The history bound is eight
observations, exactly the deterministic witness sequence.

Capabilities return Effect outcomes only. They cannot author Frame bytes,
Machine state, branch heads, or terminal results. The host persists canonical
results and the World application computes every successor Frame.
