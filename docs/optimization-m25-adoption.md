# M2.5 consumer qualification

Continue on the existing cutover branch and Agent #39 under the user-directed
one-branch/one-PR policy. Preserve earlier M2 receipts and accepted cost decisions.
The authenticated Boundary dependency remains exactly 8b900338818c084d0e752f191313a4535ee31699; later Boundary test/document changes are not relabeled as its source.
World uses the unchanged authenticated f8a1597 runtime, kernel
7d31effb1d4e32523d0fcbd5b4d5f5a8a2289fbd4c731173a33b1c174524282f.

## Terminal evidence

- Authenticated package verification and managed-tool build: 7/7 steps.
- Corpus emission: 3/3 steps; 18 images, 13 byte-identical to M2.
- Inquiry/ReAct: 13 prescribed cases; document: 13; consequence: 36.
- Repeated inquiry now passes with the required real executor: four epochs,
  28 prescribed model responses, four experiments and eight cleanups; native,
  production WASM and independent Wasmtime agree. The earlier outer-sandbox
  failure is retained as historical evidence, not rewritten as a pass.
- Admission memory: all 18 workloads on native and production WASM, with local
  M2 and cumulative pre-cutover comparisons. Largest local native increase is
  474 bytes; no local WASM increase.
- Admission timing: 20 changed-image/engine/control comparisons completed;
  no reproducible slowdown above 5%. Raw samples and identities are retained.

These are bounded observations, not final M2.5 acceptance. Execution/checkpoint
paired timings, final integrated/browser qualification, remaining representation
obligations, and later optimization milestones remain open. Code reviews follow
the complete programme; they do not gate continued implementation.
