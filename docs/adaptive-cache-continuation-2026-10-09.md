# Cache-preserving adaptive continuation — October 9, 2026

The reference now resumes its existing Boundary computation through World and
continues the ordered transcript. Ordinary effort/model/skill controls do not
construct a task-state handoff. This supersedes the reset-based behavior qualified
in the [earlier live report](adaptive-live-validation-2026-10-09.md); those original
subjects and failures remain historical evidence.

## Mechanism

- An admitted effort update settles the real model-generated control call, then
  appends configuration_update while leaving top-level effort and the complete
  previous input prefix unchanged. No synthetic human turn is inserted.
- A model switch retains compatible visible messages and complete tool exchanges.
  Old opaque reasoning and old-profile effort updates are excluded. It does not
  infer shared cache or opaque compatibility between Sol and Astra.
- Skill eviction removes owned injected blocks and exclusive definitions. Per-item
  provenance distinguishes an injection from identical text in ordinary evidence.
  Opaque dependency tracking distinguishes body exposure from tool-definition
  exposure, preserving unrelated output while removing dependent opaque items.
  Destination profiles still govern tool additions and explicit cache markers.
- Boundary's saved continuation remains the owner of task progress, control state,
  evidence references and pending results. The redundant handoff builder and its
  unused outcome/intent copies were removed. The generic explicitly authored seed
  operation remains separate; this reference does not invoke it.

The context artifact is version 3. Exact image, schema, assets and runtime bindings
still govern recovery; old tasks were not migrated or rewritten.

## Exact live subject

Agent source: 7cf1b2bf706ec267f1010da855c23e2b84133ce1.

- macOS arm64 reference SHA-256: ad24d819fb403e7cc12c425f1b49984b94919759500b725debfa27c923c24df7
- BPI3 SHA-256: e16a9b245a6d33d4ecfe6231d480ed188c8b720398def3024b438d3d21fdacd1
- Application assets SHA-256: 6d8c6af10f4c631ecea176431833435d8a2416a5e91e29de8efd5e42fa48fb45

The [observations](adaptive-cache-continuation-observations-2026-10-09.json) contain
compiler/library identities, unchanged Boundary/World locks, all new attempts,
request/response hashes, actual returned metadata, controls, usage, and causal
transition receipts. Raw captures, opaque reasoning and credentials remain private.

## Actual task

Task 9746b60f764b234563b64af7e22953d2, 2026-10-09T20:52:20.729Z through 2026-10-09T20:53:22.458Z,
ran through the compiled program, native tools and real Responses API. Both profiles
were frozen before admission; every control originated in a model function call.

| Request | Model | Top-level / effective effort | Action | Returned cached tokens | Exact unchanged input-prefix items |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | gpt-6.1-sol | medium / medium | list | 1286 | 0 |
| 2 | gpt-6.1-sol | medium / medium | read | 1388 | 3 |
| 3 | gpt-6.1-sol | medium / medium | skill_set load | 1759 | 6 |
| 4 | gpt-6.1-sol | medium / medium | inference_set | 1756 | 8 |
| 5 | gpt-6.1-sol | medium / high | inspect | 2378 | 12 |
| 6 | gpt-6.1-sol | medium / high | skill_set deactivate | 2758 | 15 |
| 7 | gpt-6.1-sol | medium / high | skill_set unload | 2812 | 17 |
| 8 | gpt-6.1-sol | medium / high | inference_set | 1759 | 10 |
| 9 | gpt-6-astra | medium / medium | skill_set load | 1759 | 12 |
| 10 | gpt-6-astra | medium / medium | read | 3683 | 21 |
| 11 | gpt-6-astra | medium / medium | skill_set unload | 4071 | 23 |
| 12 | gpt-6-astra | medium / medium | ask | 4360 | 25 |
| 13 | gpt-6-astra | medium / medium | report | 4654 | 27 |

Request 5 preserved all 12 input items from request 4 and
reported 2378 cached input tokens.
The effort update followed the actual settled tool result. Provider metadata still
reports top-level medium; the accepted configuration-update item selects high under
the documented [reasoning API contract](https://developers.openai.com/api/docs/guides/reasoning).
It remained present through the resident skill's removal and was excluded when
selecting Astra/medium.

Astra received the original visible evidence and complete settled exchanges. Its
final report used Sol-acquired quota.mjs and Astra-acquired scenario.mjs, correctly
explaining conservation, duplicate/insufficient rejection and repeat-release behavior.
The resident inspect result (four lexical guards) was consumed at Sol/high and
properly distinguished from a correctness proof. One follow-up was consumed once.

The task parked at the actual clarification question after transient unload.
Restarting with saved task inputs produced a byte-identical archive: 12 attempts
before and after, with no reacquisition. Answering that preserved question caused
one further Astra/medium inference and the grounded report at attempt 13.

## Scope and accounting

The additional work used 57 actual API calls:
a successful 5-call ordinary baseline and 13-call directed run on the intermediate
candidate, a 13-call pre-review-v2 run, a 13-call pre-export-fix-v3 run, and a 13-call directed
run on the final candidate. Each earlier
subject is separately identified. The v3 task completed and its parked restart
passed, but completed export failed with OutOfMemory. Its final observations were
recovered from digest-checked saved objects through read-only SQLite inspection. Replay validation now releases per-record scratch
through the service allocator. On the existing 14-call recovery fixture, peak
requested memory fell from 55,507,231 to 28,693,092 bytes; the added completed
export check passes with a 32 MiB test budget. The final live completed export
passed through the native validator. The ordinary baseline was retained rather than
repeated after the provenance, destination-profile and export-memory refinements;
the final directed run exercised the same native list/read/report path.

Additional conservative estimated token charges: $1.5019500.
Cumulative campaign: 103 calls and approximately
$2.2179175. This prices all input
at cache-write rates without discounts, and includes reasoning in output tokens.
It is not a billing statement. The user had explicitly removed campaign ceilings.

Native regression coverage includes exact prefix preservation, effective-effort
validation before dispatch, evidence/injection text collisions, model changes,
transient reactivation and unload, destination feature restrictions, explicit seed
replacement after an effort update, and acquired-before-interpreted recovery. The controlled
14-call peer passed. Broader macOS closed-output failures remain disclosed; current
Linux CI and review disposition belong to PR #47.

These observations establish the exercised continuation behavior and real cache
reuse. They do not prove global cache optimality, billed savings, shared cross-model
KV state, autonomous routing quality or broad model efficacy. Exact unchanged input
prefixes are local byte observations; cached tokens and cache diagnostics are separate
[provider observations](https://developers.openai.com/api/docs/guides/prompt-caching).

## Subsequent macOS disconnect repair

The closed-output failures above were traced to the native transport: Darwin did
not report a closed pipe/socket when stdout was polled with an empty event mask.
The transport now makes a nonblocking write-readiness probe before its ordinary
idle wait. This detects disconnects without continuously waking on writable stdout.
A regression test covers both pipes and sockets, including the idle wait.

The full macOS `zig build check-native-product -Doptimize=safe` check passed with
its existing process assertions unchanged. The held-provider disconnect completed
in 21.15 ms, and restart retained unknown delivery without retry. The controlled
14-call adaptive peer also passed. The tested host, repository and adaptive binary
SHA-256 values were respectively
`f561cee6a2c21ad904f4be3d6b946c9952c01f7e772b6ab45d39ef3240657813`,
`5c405256853c726b4b341e9875f6784fd7e759410c6ed5b03b5a6a705711696e`, and
`7710b67b3053caf6d1ae0577836698355939402c1f1eb427759b7781872ecc0b`.
The preceding failures remain historical observations; no additional live-provider
calls were made for this transport-only repair.
