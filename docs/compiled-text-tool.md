# Compiled text tool

`tools.textInspection.emit` independently emits a BMO1 object. Its `inspect`
export counts bytes and LF newlines in an immutable UTF-8 subject. Inputs contain
a logical name, SHA-256 content version and byte length, never a native file
descriptor or browser object. Subjects are bounded to 65,536 bytes; each typed
read returns at most 16 bytes. Offset, version, progress and EOF checks belong to
the Program, as do the fold and its retained counters.

The computation runs inside an owned generator with protected cleanup. Disposing
its yielded result invokes `agent.text.close.v1`; cancelling during a read also
reaches that cleanup. The portable leaf binding validates operation/schema/subject
compatibility. The Node file binding uses the existing protected document reader
and rechecks the complete bounded file version for each chunk. This fixture
adapter prioritizes version detection; it makes no streaming-I/O performance claim.

## Agent import boundary

`tools.declareCompiled` declares a local tool from actual BMO1 bytes, an exported
function, an explicit instance key and effect bindings. The compiler owns a copy
of the object and its binding names. Reusing the instance requires the same object
and bindings. Final linking remains Boundary-owned and independently admits the
complete Program; matching interface names or hashes do not bypass admission.

This profile accepts a closed function group with portable single-argument input
and result, effect-only imports, explicitly bound read/simulation operations,
nominal internal requirements bound to nonexternal `.internal` declarations, and
no multi-shot resumption schemas. Internal requirements remain in the interface;
they are not treated as purity or silently removed. Every external operation in the object must be
bound, including declarations outside the selected entry's immediate body.
Bindings preserve semantic operation names and must have the declared Agent role.
The final linker checks their complete schemas and function contracts. The
value-only tool caller explicitly requires no caller borrow dependencies, cell
writes carrying borrows, or outlives requirements. Boundary derives the actual
guarantee from linked code; the Agent effect role does not establish it. BMO1
now includes the borrow-contract table, so earlier development objects must be
re-emitted. The current text object is 1,490 bytes; the standalone/Agent BPI3
images remain 1,483/4,224 bytes.

An opaque import is rejected inside protected speculation even when its declared
row appears harmless. This does not claim general protected-component admission:
model, approval, commit/write and speculative compiled implementations need their
own stronger construction. Ordinary Agent source retains its existing generalized
effects and protected-authority paths.

The Agent compile result moves Boundary's owned linked records and analysis into
the ordinary construction owner. Boundary phase observations describe the caller
component compilation; the enclosing Agent compile phase also includes linking.
No component emitter or source is needed at link time or execution time.

## Executed witnesses

The component emitter and caller linker are separate executables. The runtime
test transports only the linker executable and one object into an isolated
directory, then links that same object into standalone and Agent Programs.
The Agent offers `inspect_text` through a real tool declaration and checked model
responder. The local source wrapper supplies the subject from the captured task;
the model cannot substitute a path. The task ID remains live across tool requests.

The Agent also retains a separate owned side task. Tool interruption and cleanup
leave it resumable. Two human confirmations have Program-owned occurrence values;
an earlier inner answer, rebound to the current outer request, reissues the current
question instead of being accepted.

`check-compiled-tools` covers real file reads, changed files, missing operation or
subject bindings, schema/version mismatches, a wrong Program/checkpoint pair,
stale outer replies, stale inner human replies, scoped tool interruption, retained
side work, global cancellation and suspending disposal cleanup.

`check-compiled-tool-browser` runs the same Agent image in Chromium and Firefox:
the first Worker reaches a chunk read, exports and terminates; a separate Node
process restores it, reads a real fixture file, exports its actual successor and
exits; a fresh Worker finishes using the matching in-memory subject, performs
cleanup and resumes the retained side task. Model/human replies are synthetic
leaf results. The host does not reconstruct the fold or replay completed reads.

```sh
zig build check-compiled-tools check-compiled-tool-browser \
  -Dworld-runtime=/absolute/authenticated/world-runtime \
  -Dworld-source=/absolute/authenticated/world-source \
  -Dbrowser-tools=/absolute/world/test/current/browser-tools
```

The browser tooling is the existing locked Playwright setup. This witness does
not complete the separate three-component composition requirement, general local
imported-borrow contracts, performance acceptance, or legacy retirement.

## Inspect a suspended execution

From an Agent source checkout, build the existing native inspector with `zig build build-inspector
-Doptimize=ReleaseSafe`, then run:

```sh
zig-out/bin/agent4-multi inspect-execution application.bpi3 checkpoint.pst3
```

The command admits the complete Program/State pair before producing JSON. It
reports the pending effect identity, canonical payload/result schema bytes in
hexadecimal, function/block/instruction location, retained activation/package and
template counts, and cleanup-obligation identities and lifecycle status. Locations
refer to BPI3 code, not native addresses or an unavailable source map. Required
cleanup is distinguished from completed or failed obligations. Captured payloads
and resource contents are omitted. Inspection does not execute, transfer custody,
write either input, or grant authority to a caller; a mismatched pair rejects.
