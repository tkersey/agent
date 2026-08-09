# Agent manifests

Compilation exposes three deterministic projections and their canonical binary
encodings:

- `DefinitionManifest` / `DefinitionManifestBytes` (`AGT_DEF1`);
- `StrategyManifest` / `StrategyManifestBytes` (`AGT_STR1`);
- `Manifest` / `ManifestBytes` (`AGT_CMP1`).

Definition bytes contain raw bounded name, version, instructions, decision
interface, stable action names/descriptions, observation mappings, and effect
identities plus schema digests and static policies. Strategy bytes contain the
semantic identity, canonical portable config, generated request/state schemas,
and normalized Control IR digest. Compiled bytes bind both semantic digests,
Machine options, exact Boundary package identity, ABI v2 contract digest, and
residual effect catalog.

Encoding uses fixed magic bytes, big-endian integers, checked u32-length byte
fields, declaration-ordered arrays, and exact fixed output lengths. There are
no pointers, host handles, maps, source paths, or trailing capacity bytes.

SHA-256 values are content identities and integrity witnesses. They are not
signatures, attestations, authorization tokens, or confidentiality controls.
