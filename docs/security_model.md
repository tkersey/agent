# Security model

- Definition and strategy inputs are untrusted until comptime admission passes.
- Instructions, names, descriptions, histories, configs, and manifest fields
  are bounded before compiler work or encoding.
- Action coverage and effect rows are closed structurally.
- Decision results are untrusted until their exact tagged-union schema passes
  Boundary and World validation.
- Budgets are checked before the effect whose count would exceed policy.
- Counter overflow and vector intrinsic failure occur before committed state
  mutation; external resume is transactional.
- Action metadata never grants capability authority.
- Definitions and Machines contain no credentials or provider endpoints by
  default.

The host may be malicious. WASM alone does not establish host trust. Agent
state may contain sensitive data and this package provides no encryption,
signing, confidentiality, mutable deployment aliases, or exactly-once external
execution.
