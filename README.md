# Agent 4 — resumable interaction programs

Agent is a Zig authoring library for ordinary Boundary 2 computations. Applications
choose their own branches, loops, handlers, questions, conversations, and child
computations. The complete program compiles to BPI2. Unfinished control travels in
PST2 and executes under unchanged World 5.

This branch is **candidate integration**, using the exact development inputs in
[the dependency lock](conformance/agent4/dependencies.lock.json). It does not claim
that Boundary 2 or World 5 has been released. Agent 3 artifacts remain on their
frozen BPI1/PST1 runtime; active-state migration is not supported.

## Authoring

Use Zig 0.16.0. A consuming package imports the `agent` and `boundary` modules.
The optional `agent_contracts` module contains pure schema/value support and has
no compiler or runtime dependency.

```zig
const agent = @import("agent");
const boundary = @import("boundary");

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const integer = try c.schema(u32);
        const unit = try c.schema(void);
        const read = try c.external("example.read.v1", integer, integer, .read);
        const entry = try b.declare(&.{integer}, integer, &.{read}, &.{});
        try b.define(entry, try b.term(.{ .perform = .{
            .effect = read, .payload = try b.reference(b.parameter(entry, 0)),
        } }));
        return b.module(entry, unit);
    }
};

const System = agent.system(.{
    .InitialArgs = u32, .Result = u32, .Failure = void,
    .application = Application,
});
// var compiled = try agent.compile(allocator, System);
// defer compiled.deinit();
```

Native emitters run only while authoring; arbitrary Zig closures and stack frames
are not translated or checkpointed. Helpers construct the same public Boundary
source terms available to the application. Agent has no instruction format or
evaluator. See the independent [document](test/consumers/document) and
[review](test/consumers/review) consuming packages.

The public library includes typed `decision`, `interaction`, `dialogue`,
`conversation`, `react`, `scopes`, `sets`, `responders`, `observation`, `tools`, and
`approval` constructions. Supplied system catalogs are checked and available in
`Context.catalogs`. Model profiles, prompts, and skills become ordinary image
constants. Private futures and approval resources never cross an external value
boundary. See [architecture](docs/architecture.md) and
[the model contract](docs/model-invocation-v3.md).

## Checks and execution

The normal authoring check fetches only the exact locked Boundary package:

```sh
zig build check-agent4 -Doptimize=ReleaseSafe
zig build emit-agent4 -Doptimize=ReleaseSafe
```

To acquire the immutable candidate runtime in this checkout, explicitly run:

```sh
node tools/agent4/setup.mjs
zig build check-agent4-integration -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
zig build check-agent4-economy -Doptimize=ReleaseSafe \
  -Dworld-runtime="$PWD/.agent4/out/world-runtime"
```

Use `--cache-dir` and `--global-cache-dir` inside the isolated Agent checkout when
working alongside other deliveries. `-Dboundary-v2-source=/absolute/immutable/copy`
is an optional development input, verified against the same lock. Native agreement
tests use the separately authenticated unchanged World source acquired by setup.
No runtime kernel is built per application.

The optional runner starts, resumes, inspects, and cancels saved World outcomes.
Canonical reply bytes are supported without a UI or provider session. It is a
single-writer reference, with one outstanding external request per computation.
See [runtime commands](docs/agent4-runtime.md) and
[migration from Agent 3](docs/migration_from_3.md).

Required tests use synthetic provider replies and real tools in isolated fixture
directories. No test needs personal credentials or paid inference. Snapshot
portability supplies neither encryption nor global anti-replay; environmental
handlers remain responsible for authentication, actual I/O, and atomic tool
preconditions. Approval, negative replies, local abort, root closure, cancellation,
uncertain delivery, and operational capacity failure remain distinct.
