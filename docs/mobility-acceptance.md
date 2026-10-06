# Mobility verification scope

Retained authoring and native contracts run in normal pull-request CI. Runtime
regressions cover custody, signed transfers, durable journal transitions, transport,
deployment, browser-bridge messages, sessions and the task catalogue.

The optional multi-engine/browser campaigns, bounded model exploration and manual
measurement harnesses have been removed. Existing product examples and transfer,
authority, publication and sandbox enforcement remain. This reduces coverage; it
does not prove browser execution or external deployment from unit tests.

See [regular verification](../conformance/agent4/evidence.md) and the
[mobile repository acceptance scope](mobile-repository-acceptance.md).
