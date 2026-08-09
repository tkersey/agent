# Action algebra v1

Every `Action` variant has exactly one descriptor in the closed algebra:

- `effect` maps an exact Action payload to one typed Boundary effect site and
  maps its exact resume type to one Observation variant;
- `final` returns an exact `Definition.Result` payload;
- `fail` returns the exact authored `Definition.Failure` payload.

Descriptors are normalized by Action declaration order. Duplicate variants,
duplicate stable names, missing variants, nonexistent variants, payload/resume
mismatches, and missing final actions are compile errors.

Runtime dispatch uses tagged-union matching, never strings. A stable action
name and diagnostic class are manifest metadata; neither grants host
authority. The generated decision site is ordinal zero and declared effect
actions receive dense subsequent ordinals.
