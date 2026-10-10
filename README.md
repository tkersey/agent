# Agent

Agent builds agents as typed, resumable programs. Its supported application is
**Adaptive Agent**: a native executable that investigates a read-only snapshot,
selects among approved models and reasoning settings, loads approved skills,
asks questions, and constructs and reuses bounded pure tools.

The application is authored in Zig. Boundary checks and compiles its control
flow into BPI3; native World owns execution and continuation. Agent supplies
provider I/O, tools, task storage, and CLI/stdio clients. The host does not
interpret a recipe or run a second application policy loop.

## Build and run

Use Zig **0.17.0**, `tar`, and `unzip`. Approved source archives and SQLite are
acquired and authenticated by a Zig bootstrap; Node and Python are not needed.
From this checkout:

```sh
zig run tools/native/dependencies.zig -- setup \
  conformance/agent4/dependencies.lock.json \
  conformance/agent4/native-dependencies.lock.json \
  .agent4-native/inputs "$(command -v zig)"
zig build adaptive-agent -Doptimize=safe
./zig-out/bin/adaptive-agent describe-build
./zig-out/bin/adaptive-agent demo --offline --state-dir ./adaptive-demo
```

Setup authenticates complete source inventories, seeds Zig's pinned Boundary
package, and retains only native World source and SQLite inputs. Append
`--offline` to setup to require previously cached archives. Existing dependency
directories are rechecked and never silently replaced.

The offline demo uses recorded replies through the actual authored program.
For configured operation, see [Adaptive Agent](examples/adaptive-agent/README.md)
and the [native build and operations guide](docs/native-single-binary.md).
Inference requires explicit configuration, authorization, and a credential file;
there is no credential discovery or paid call in ordinary qualification.

Supported native targets are `aarch64-macos` and `x86_64-linux-musl`. SQLite,
the small native C bridge, libc, and OS facilities remain dependencies. The
installed agent needs no compiler, JS/WASM runtime, or adjacent source tree.

## Reusable authoring and embedding

Agent remains a library. `agent.system`, `Context`, and `compile` construct
ordinary Boundary programs. Checked model responders retain request-time offers;
adaptive controls, inboxes, prompts, skills, compiled tools, and the generic
interaction/approval constructions remain available to downstream authors.
Model calls, choices, and continuations belong to the program.

The public `addNativeSystem` build function accepts caller-owned definition,
types, and environment paths, or an already emitted image/assets/types tuple.
It uses the same native source admission and asset/metadata writers as the
repository application. The [downstream recipe](test/consumers/adaptive/build.zig)
builds the adaptive application through that public API.

[Architecture](docs/architecture.md) ·
[Trust boundaries](docs/security_model.md) ·
[Adaptive model contracts](docs/model-invocation-v6.md) ·
[Native Responses](docs/native-responses.md)

## Qualification

```sh
zig build check-agent4 check-native -Doptimize=safe
node test/agent4/installations.mjs .agent4-native/inputs zig-out/bin/adaptive-agent
```

Node is an external verification controller only. The independent native peer
uses controlled HTTPS, actual authored actions and created tools, killed/restarted
tasks, frozen inputs, malformed archives, and cancellation. The downstream witness
uses a clean source package and an OS executable boundary that excludes Node and
Python during acquisition, authoring, public-API building, installation, inspection,
and offline execution. Source and compiler caches are authenticated or reused
without deleting unrelated local data.

CI qualifies Linux and retains only the adaptive executable, its build metadata,
program/contracts, and example configuration. The complete workflow target is
300 seconds and its maximum is 360 seconds. Exact-head results belong to the PR;
a previous run does not qualify a changed candidate.

## Retired applications

The fixed repository agent, native minimal demo, inquiry/parser/document
applications, JavaScript runners, and JavaScript mobility deployment have been
removed. See [migration notes](docs/migration_from_3.md). Distributed adaptive
mobility is future work. Checkpoint export/import preserves local continuation
and compatibility checks; it does not establish exclusive distributed custody.

Boundary's independent source oracle and World's source-agreement tests remain
outside this product. World's optional JS/WASM embedding remains supported by
World and is not a native Agent prerequisite.
