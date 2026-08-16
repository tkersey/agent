# Agent Adequacy v1 successor proof

The original locked Agent `v2.0.0` tuple did not complete. Its exact
`agent_flow_expressivity` obstruction and reproducer remain under
`adequacy/router-policy-v1/agent-adequacy-obstruction.md`.

The completed successor proof uses only official public releases:

```text
Agent              v2.2.0
Boundary           v1.5.0
World              v3.1.3
world-host         v1.0.1
world-capabilities v2.3.2
```

Machine ABI v2, `ABL_RNF2`, Application ABI v1, Frame v1, Effect protocol v1,
one pending effect, and the original state and WASM limits are unchanged.

The live lane uses request-and-proposal-bound receiver verification. It does
not prompt for human approval, publish prompts or repository contents, expose
the reference solution to the model, or allow an unverified write.

Run:

```text
zig build check-agent-adequacy-compile
zig build check-agent-adequacy-fixture
zig build check-agent-adequacy-epistemics
zig build check-agent-adequacy-native-wasm
zig build check-agent-adequacy-deterministic
zig build check-agent-adequacy-retry
zig build check-agent-adequacy-replay
zig build check-agent-adequacy-branch
zig build check-agent-adequacy-migrate
zig build check-agent-adequacy-measure
zig build check-agent-adequacy-lock
zig build check-agent-adequacy-reference-stack
zig build check-agent-adequacy-reference-stack-offline \
  -Dworld-host-archive=/path/to/world-host-v1.0.1-runtime.tar.gz \
  -Dworld-capabilities-archive=/path/to/world-capabilities-v2.3.2-deterministic.tar.gz
zig build check-agent-adequacy-release
```

The historical `check-agent-adequacy-core-unchanged` claim is intentionally
not provided: the official successor compiler line contains the owner-specific
correction required by the recorded v2.0.0 obstruction. Claiming those bytes
were unchanged would falsify the result.

The explicit live lane reuses receiver-supplied credentials and model:

```text
OPENAI_API_KEY=... OPENAI_MODEL=... \
zig build check-agent-adequacy-live \
  -Dworld-host-root=/path/to/world-host-v1.0.1-runtime \
  -Dworld-capabilities-root=/path/to/world-capabilities-v2.3.2-deterministic
```
