# Agent Adequacy v1 obstruction

## Result

Agent Adequacy v1 is not complete for the locked release tuple. The primary
obstruction is:

```text
obstruction_class=agent_flow_expressivity
obstruction_owner=tkersey/agent
```

The exact Agent v2.0.0 public `Flow` API cannot express the required compiled
relation between `DocumentSnapshot.slot: DocumentSlot` and
`DocumentSnapshot.slot_code: u8`.

## Exact release tuple

```text
Agent              v2.0.0
Boundary           v1.3.2
Boundary Machine   ABI 2, ABL_RNF2
World              v3.1.1
World Application  ABI 1, Frame 1
world-host         v1.0.1
Effect protocol    1
Zig                0.16.0
```

The clean-room dependency used the public Agent archive and package hash:

```text
https://github.com/tkersey/agent/archive/refs/tags/v2.0.0.tar.gz
agent-2.0.0-dBg3hBEwCgDuBIyJSmp-9PnvI9JVNJ8TBUAgAhp3b1Ap
```

Agent supplied its exact Boundary v1.3.2 public dependency.

## Smallest reproducer

Run from this directory:

```text
zig build reproduce
bun verify.mjs
```

The first command exposes the compiler failure. The second command succeeds
only when that exact public-API obstruction is reproduced.

Expected: one public, typed Flow operation can compare an enum-valued slot with
its redundant `u8` lowering witness, allowing the Machine to reject a mismatch.

Actual: `Flow.integerEqual` requires both operands to have the same fixed-width
integer type. `DocumentSlot` is an enum, `slot_code` is `u8`, and Agent v2.0.0
exposes neither enum equality nor enum-to-integer lowering. The reproducer fails
at the public API boundary before a Boundary Machine can be formed.

## Full-witness measurement

A direct implementation of the specified Memory, DecisionView, document
upsert, conflict removal, test epochs, mutation fold, and final guard was also
lowered against the exact releases before being discarded in favor of this
minimal reproducer.

```text
Boundary v1.3.2 maximum Control IR values:             256
full exact slot/code validation lowering values:       578
codec-authoritative code-only lowering values:         387
```

The second measurement removed enum correspondence from the Machine and relied
on the external codec. It still exceeded the locked Boundary ceiling by 131
values and then exceeded RNF invariant-term capacity when the diagnostic value
ceiling was temporarily raised in an unpacked cache. The cache instrumentation
was restored; no candidate or released substrate source was changed.

The exact failing full-attempt command was:

```text
cd adequacy/router-policy-v1 && zig build check
```

The decisive diagnostic was emitted by Boundary v1.3.2:

```text
Boundary compiler limit exceeds the implementation ceiling: maximum_values
actual=387 maximum=256
```

## Why the obstruction is dispositive

Section 15.5 requires compiled logic to validate that `slot_code` corresponds
to `slot`. Section 41 requires a slot-code mismatch to be rejected. The
released public Flow surface provides integer arithmetic and comparison only
for equal integer types, union tag inspection, products, optionals, and bounded
vectors. None can observe or compare an enum ordinal.

The available workarounds would falsify the adequacy claim:

- trusting only the capability codec removes the required Machine-side
  rejection and lets a direct Machine resume admit a mismatch;
- making `slot_code` a `DocumentSlot` changes the locked portable type and
  canonical codecs;
- replacing the document vector with nine independent optionals changes the
  specified epistemic working set;
- raising compiler or RNF limits changes the substrate under test;
- adding enum equality or conversion changes Agent and Boundary public
  operations during the milestone.

## Smallest proposed correction

After this milestone, add one typed enum-observation operation at the owning
compiler boundary: either same-enum equality plus a canonical enum-ordinal
projection, or a narrowly typed enum-to-underlying-integer conversion in
Boundary Control IR exposed through Agent Flow. The operation must preserve
portable schema identity and compile to Machine ABI v2 without increasing
application authority.

That correction is accidental in the general architecture but fundamental for
the locked tuple. It is not implemented here.

## Impact

The deterministic application cannot be compiled correctly, so capability
binding, the 47-effect lifecycle, the live lane, and adequacy release are not
admissible. The completed controlled fixture proof remains valid evidence but
does not establish Agent Adequacy v1.

## Obstruction receipt

```text
agent_adequacy_format=1
agent_adequacy_complete=false
adequacy_obstruction_present=true
obstruction_class=agent_flow_expressivity
obstruction_owner=tkersey/agent
exact_release_tuple_present=true
minimal_reproducer_present=true
measured_evidence_present=true
substrate_modified=false
```
