# Release line

The initial exact targets were Boundary v1.0.0 and World v3.0.0, with no source
changes expected in either upstream repository.

Implementation produced two concrete obstructions:

- Boundary v1.0.0 could not faithfully lower every required runtime-authored
  `Failure` value and its compiler limits could not admit the required staged
  strategy programs.
- World v3.0.0 structurally admitted the resulting Machine after shared-module
  wiring, but its owned application provenance still recorded Boundary v1.0.0.

The release owner authorized the smallest upstream correction releases. The
released compatibility line is Boundary v1.3.1 and World v3.1.0. Boundary
Machine ABI v2, World Application ABI v1, World Frame v1, Effect protocol v1,
world-host v1.0.0, and the one-pending-effect restriction remain unchanged.

Release receipts distinguish two temporal claims:

- `agent_boundary_changes_required=true` and
  `agent_world_changes_required=true` record the historical work required to
  resolve the obstructions.
- `agent_additional_*_changes_required=false` records that no further upstream
  changes are required by the released Agent package.

Agent v1.0.1 supersedes the ambiguous v1.0.0 receipt wording. This correction
changes provenance metadata and its reproducible proof; it does not introduce
another runtime, reducer, state format, ABI, Frame, or capability implementation.
