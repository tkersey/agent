# Agent qualification

The current authenticated binding is [dependencies.lock.json](dependencies.lock.json).
The [coordinated acceptance report](https://github.com/tkersey/boundary/blob/codex/canonical-durable-3183/docs/optimization-acceptance.md) consolidates the full programme,
exact measured tuples, local/cumulative costs, failures and remaining reviews.
Its immutable archive index retains every retired Agent report and raw data digest.

The qualified pre-cleanup tuple is Agent `db48ebcdf1565be94d31b41f6b124b057e039f7a`,
Boundary `42c089c9c07cf01054ecd057d39a95660db919de` and World `cb52f4f` kernel `9356b126`.
The ReleaseSafe check-agent4/check-agent4-integration/check-compiled-tool-browser
aggregate passed 411/411 steps, 202/202 Zig tests and 95/95 final Node tests, no skips.
All 18 existing images remain byte-identical to the previously measured corpus.
The user explicitly accepted all currently recorded costs; future costs and
correctness are not waived. The cleanup binding is independently authenticated in the current lock; final
serial reviews remain open. Installation checks for that binding are reported
with the cleanup evidence without relabeling this earlier aggregate.

Substantive checks remain in test/agent4 and test/consumers. Contract documentation,
the independent frozen parser producer, runtime authentication and all useful
benchmark/test harnesses are retained. Superseded milestone/census/timing reports
are archived in Git and excluded from dependency packages. No runtime behavior,
approval, allowance, cancellation, cleanup or persistence contract is removed.

## Final-link profile repair

Review of `ff01793` found that compiled-tool and participant linking omitted the
supplied optimization profile. The final link now forwards it unchanged to
Boundary's existing closed-program validator. Open components still defer profile
handling; malformed or stale profiles cannot disappear at the final link.

Three regressions cover invalid profiles under structural and zero-work semantic
compilation, a valid profile that is used by the compiler, a stale image identity,
and the compiled-participant path. The valid fixture uses P01's documented
zero-work rollback to collect the admitted original record; normal profiled
compilation uses ordinary defaults. Existing authority and ownership checks remain.

The twelve concrete setup-dependent runtime arguments in the Inquiry, actuality
and clarification documentation now select `world-runtime/runtime`. Each was
resolved through `setupPaths` and checked against the authenticated runtime; the
old bundle directory reproduces the inventory rejection.

| Executed check | Result |
| --- | --- |
| `zig build agent4-authoring-tests -Doptimize=ReleaseSafe` | 312/312 steps, 139/139 tests; includes outside-tree A02 installation |
| `zig build check-agent4 check-agent4-integration check-compiled-tool-browser emit-agent4 -Doptimize=ReleaseSafe` with authenticated World source/archive/runtime and locked browser tools | 411/411 steps, 205/205 Zig tests, 95/95 Node integration tests, zero skips |
| Actual archive command cases within the integration run | Pass, including packaged parser and OS-qualified inquiry execution |
| Previous versus repaired emitted artifacts | All 123 files identical: 67 distribution files, 75 image/object/argument files and 41 binary fixtures |

The unchanged dependency lock is SHA-256
`cd2a654db1586c8c482796a5dbf2c7bdac739f8e52f9ff511b644dd71f6bb43d`:
Boundary `65f4613`, World runtime source `a48d5fd`, kernel `9627eb1e`.
The full execution log is SHA-256
`f36a8962941c6d385323cfc007f3c4f6342eb2b5c656b888395077dc87dedf74`.
The checked `src/compiled_tool.zig` is SHA-256
`805ac43330d0460e5e36287d30010707381eacf4f4625d55b14a575ac39b1fdb`.

The actual use archive is 275,194 bytes, SHA-256
`80f4a64afc2c0950c622b4b14652d349dc27b2cbf992d8081ee07eca39dd1e7f`.
Its 122 regular members differ from the previous archive only in the two corrected
documentation files it contains and `SHA256SUMS`. Its original receipt retains the
precommit `ff01793` observation and does not claim that its modified packaged
sources matched that commit. No historical receipt is rewritten.

This report-only addition follows the executed checks; it changes no executable,
fixture, build configuration or use-archive member. Existing runtime cost qualification is
reused for the identical images and runtime, not claimed as a new measurement.
All six initial reviews were folded before repair. Their credit was invalidated;
fresh Agent serial reviews remain required.
