# Effect-directed mobility (in development)

The public `agent.mobility` module defines the v1 placement schemas and explicit
`resolve(context, owner, input)` and `relocate(context, owner, input)` authoring
operations. These construct ordinary Boundary effects. They do not perform
network I/O or transfer custody themselves.

Both operations carry the distinct `mobility` role. Their identities are
reserved, emissions require a registered construction site, and protected
speculation cannot admit them through an allowlist. The existing opaque-tool
restrictions remain in force. `RelocationReply` has only `Arrived` and `Refused`;
unknown custody must never resume the source program.

Run `zig build check-mobility-authoring` for the current contract/admission
checks. These checks are included in `check-agent4`.

The independent consumer in `test/consumers/mobility` now moves at its own typed
relocation calls, reads a real fixture through the compiled text component,
returns to a human binding, resumes an owned child, and completes protected
cleanup. Its caller retains task ID `123` and marker `9001`; the child returns
`91`. The expected fixture result is 42 bytes and four LF newlines. Refusal takes
an authored fallback without performing the read. Cancellation at relocation
discharges the suspended child's cleanup without resuming its normal work.

`check-mobility-continuation` checks fresh resident instances and exact parked
state/request preservation. `check-mobility-browser-continuation` executes the
same 2,310-byte image in Chromium and Firefox Workers and a separate Node process.
It physically terminates the first Worker before data execution and verifies
that the data process has exited before the new Worker restores its successor.

```sh
zig build check-mobility-continuation check-mobility-browser-continuation \
  -Dworld-runtime=/absolute/authenticated/world-runtime \
  -Dworld-source=/absolute/authenticated/world-source \
  -Dworld-archive=/absolute/authenticated/world-source.tar.gz \
  -Dbrowser-tools=/absolute/locked-playwright-tools
```

These are **test scaffolds, not the durable custody reference route**. Their
synthetic arrival receipts and empty immediate-requirement lists isolate
continuation behavior; they provide no authority or custody safety evidence.
The authored bounded `ensure` strategy, durable SQLite custodian, authenticated
transport, occurrence fencing, complete-state policy, fully admitted application,
source-free use archive, recovery tests and matched measurements remain required.
The full acceptance suite and serial review closeout remain unfinished.

The selected foundation is Agent `b1f9d2866b5717d16339e7022a3b4d08951f0770`
and its unchanged `conformance/agent4/dependencies.lock.json`: Boundary
`65f46131f366bdd21aa98701f4110ecb801d2c8d`, World
`a48d5fd0cb2d4fcbe79bc3188f354d7d036d29f5`, ABI 3, kernel SHA-256
`9627eb1e66239119bccb4ddcd43b4f6c757180dab930a9feb276671262f735d1`.
The new runtime must qualify these exact inputs before reporting execution.
