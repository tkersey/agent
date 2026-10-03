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

This initial slice is **not a working mobility runtime**. The authored bounded
`ensure` strategy, durable SQLite custodian, authenticated transport, occurrence
fencing, complete-state policy, browser/data/browser consumer, source-free use
archive, recovery tests and matched measurements remain required. No custody,
durability, privacy or end-to-end continuation claim is established yet.

The selected foundation is Agent `b1f9d2866b5717d16339e7022a3b4d08951f0770`
and its unchanged `conformance/agent4/dependencies.lock.json`: Boundary
`65f46131f366bdd21aa98701f4110ecb801d2c8d`, World
`a48d5fd0cb2d4fcbe79bc3188f354d7d036d29f5`, ABI 3, kernel SHA-256
`9627eb1e66239119bccb4ddcd43b4f6c757180dab930a9feb276671262f735d1`.
The new runtime must qualify these exact inputs before reporting execution.
