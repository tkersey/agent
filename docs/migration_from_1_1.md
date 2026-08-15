# Migrating from Agent 1.1

Agent v2 is source-incompatible. Existing v1 runs continue with their original
application artifacts; there is no Machine-state migration between application
identities.

To migrate source:

1. remove `Definition.history` and `Definition.final_policy`;
2. select an explicit verbatim or custom EpistemicStrategy;
3. pass it as the third `agent.compile` axis;
4. move final admission into the EpistemicStrategy;
5. rebind decision capabilities to the new application, DecisionTurn schema,
   and exact DecisionContract digest.

Historical Agent v1.1.2 remains the compatibility implementation. Agent v2
does not ship a legacy package or runtime reader for v1 build-time manifests.
