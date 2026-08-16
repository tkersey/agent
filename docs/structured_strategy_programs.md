# Structured strategy programs

`agent.Flow` is a bounded comptime Control-IR builder. `agent.Value(T)` is a
symbolic compiler value containing only a typed SSA identity.

Flow supports constants, product and sum construction/extraction/update,
integer and boolean operations, canonical bounded-Text comparison, optionals,
bounded vectors, typed blocks, branches, loops, exact authored failures,
returns, and typed effect suspension. It privately assigns numeric value IDs,
block IDs, continuation parameters, resume placeholders, and edge arguments.

`finish(Result)` validates and returns one ordinary `boundary.ir.Program`.
Flow has no runtime representation and does not define operation semantics;
every operation lowers directly to the corresponding Boundary Control IR
operation. It is intentionally scoped to strategy authoring rather than a
general Zig source language.
