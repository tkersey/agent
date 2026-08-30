# Repository-repair Process transcript v1

Agent v2.7 publishes the landed repository-repair Interpretation v1 program as
an immutable Boundary Process ABI v1 compatibility transcript. This is a
source-independent replay artifact for the existing program, not a new Agent
runtime or a new repository-repair execution.

## Historical compatibility witness

The transcript retains the exact canonical BPI1 emitted by the landed Agent 2.7
compiler line:

```text
byte length: 23,431
SHA-256:     7440076a8078220d9d4000b871423d981bbbee19aedba499afaa4a86239fe6a6
```

Those bytes predate Boundary Process ABI v1. Replaying them unchanged through
the exact released Boundary v1.7.0 Process kernel proves that the later generic
Process host can execute the historical image without recompilation,
normalization, linking, or transcoding. Replacing the image with a newer linked
program would test different semantics and would lose that compatibility
witness.

The transcript is therefore immutable. Its producer commit, Boundary kernel,
program image, InitialArgs, every one-reduction outcome, every residual request,
and every supplied result are digest-bound. A published pair is never replaced
in place; a defect requires a successor Agent patch release with a new pair.

## Release assets

The GitHub release exposes exactly two required assets:

```text
agent-repository-repair-process-v1-transcript.json
agent-repository-repair-process-v1-transcript.bin
```

The JSON asset is the closed manifest. It binds the producer and Boundary
tuples, the payload digest and length, the ordered artifact table, the 96-step
transcript, its 17 residual boundaries, the transfer point, and the terminal
result digest.

The binary asset is a headerless concatenation partitioned only by that artifact
table. In canonical order it contains the BPI1, InitialArgs, 96 exact
`ABL_PKO1` outcomes, 17 exact `ABL_ERQ1` requests, and 17 exact `ABL_ERS1`
results: 132 referenced artifacts in total. The released Boundary kernel and
Agent's generation receipt are not embedded in the payload.

## Independent replay

A conforming host needs only:

```text
the exact released Boundary v1.7.0 Process kernel
the transcript JSON
the transcript BIN
```

The host validates the closed manifest, complete payload partition, and every
digest; initializes the kernel from `program-image` and `initial-args`; and then
performs the 96 expected one-reduction invocations. Each invocation uses a fresh
kernel instance and must reproduce the recorded `ABL_PKO1` bytes and decoded
kind exactly. For a `Requested` outcome, the host also compares the exact
`ABL_ERQ1` and supplies the corresponding recorded `ABL_ERS1` on the next
reduction. At zero-based boundary index 8, a fresh kernel module wrapper and
instance must reconstruct the pending request byte-for-byte. Replay finishes
only with the recorded `Completed` outcome at reduction 95 and the bound
terminal Result digest.

No Agent source, `agent.process` API, World source or system linker,
`world-host`, `world-capabilities`, capability implementation, repository
fixture, application-specific WebAssembly, or `MachineV2Profile` participates
in that public replay. The deterministic model and repository implementations
are generation-only proof inputs used to produce the recorded `ABL_ERS1`
bytes; they are not runtime dependencies of the transcript.

## Instance-count proof scopes

Agent owns the release receipt's `freshWasmInstanceCount: 97`: 96 fresh
instances for the main reduction sequence plus one fresh instance for the
required transfer reconstruction at boundary index 8. Agent's independent
replay proves that count.

World's public acquisition validates and locks the manifest, payload, artifact
inventory, producer identity, and Agent-owned receipt; acquisition does not
remeasure the 97-instance proof. World #47's current broader clean-room replay
has a different scope: it performs all 96 transcript reductions and separately
reconstructs every one of the 17 requested outcomes, for 113 Process `advance`
calls. That host-specific 113-call check neither changes Agent's 97-instance
receipt nor adds artifacts to the transcript.

## Proof and remaining blocker

Run the focused Agent proof with:

```sh
zig build check-agent-repository-repair-process-transcript-v1 --summary all
```

Publishing this pair unblocks the Agent-owned half of World #47 Process Host
conformance. Boundary separately owns publication of:

```text
boundary-process-v1-conformance-corpus.json
boundary-process-v1-conformance-corpus.bin
```

Until those assets are public, World's full `bun run conformance:runtime` may
remain blocked. The Agent transcript neither contains nor substitutes for that
Boundary corpus.

This milestone is not Agent System Closure. Model configuration, prompt
programs, skills, tool declarations, and a complete Agent runtime remain work
for the separate Agent 3 architecture milestone.
