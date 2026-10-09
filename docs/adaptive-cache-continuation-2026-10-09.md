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
  Opaque dependency tracking also preserves reasoning from an inactive interval
  across transient reactivation and removal.
- Boundary's saved continuation remains the owner of task progress, control state,
  evidence references and pending results. The redundant handoff builder and its
  unused outcome/intent copies were removed. The generic explicitly authored seed
  operation remains separate; this reference does not invoke it.

The context artifact is version 2. Exact image, schema, assets and runtime bindings
still govern recovery; old tasks were not migrated or rewritten.

## Exact live subject

Agent source: c5d11c08c286433bbb36f17c092d8eecf521ef1d.

- macOS arm64 reference SHA-256: f3472dabb373362784ebd1784def7f775b81ccff5657f70ac6b6d5da77de8d75
- BPI3 SHA-256: e16a9b245a6d33d4ecfe6231d480ed188c8b720398def3024b438d3d21fdacd1
- Application assets SHA-256: 778d8075adfa1f86f9645dbdb14cf41e26148e2ace8a7029b0825990e9e02920

The [observations](adaptive-cache-continuation-observations-2026-10-09.json) contain
compiler/library identities, unchanged Boundary/World locks, all new attempts,
request/response hashes, actual returned metadata, controls, usage, and causal
transition receipts. Raw captures, opaque reasoning and credentials remain private.

## Actual task

Task 7e1a7fbc0a0275fa145261b76eae9180, 2026-10-09T19:53:43.514Z through 2026-10-09T19:58:26.422Z,
ran through the compiled program, native tools and real Responses API. Both profiles
were frozen before admission; every control originated in a model function call.

| Request | Model | Top-level / effective effort | Action | Returned cached tokens | Exact unchanged input-prefix items |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | gpt-6.1-sol | medium / medium | list | 1286 | 0 |
| 2 | gpt-6.1-sol | medium / medium | read | 1388 | 3 |
| 3 | gpt-6.1-sol | medium / medium | skill_set load | 1759 | 6 |
| 4 | gpt-6.1-sol | medium / medium | inference_set | 1756 | 8 |
| 5 | gpt-6.1-sol | medium / high | inspect | 2380 | 12 |
| 6 | gpt-6.1-sol | medium / high | skill_set deactivate | 2759 | 15 |
| 7 | gpt-6.1-sol | medium / high | skill_set unload | 2813 | 17 |
| 8 | gpt-6.1-sol | medium / high | inference_set | 1759 | 10 |
| 9 | gpt-6-astra | medium / medium | skill_set load | 1759 | 12 |
| 10 | gpt-6-astra | medium / medium | read | 3680 | 21 |
| 11 | gpt-6-astra | medium / medium | skill_set unload | 4067 | 23 |
| 12 | gpt-6-astra | medium / medium | ask | 4356 | 25 |
| 13 | gpt-6-astra | medium / medium | report | 4665 | 27 |

Request 5 preserved all 12 input items from request 4 and
reported 2380 cached input tokens.
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

The additional work used 31 actual API calls:
a successful 5-call ordinary baseline and 13-call directed run on the intermediate
candidate, followed by a 13-call directed run on the final candidate. The intermediate
subject is separately identified. The ordinary baseline was retained rather than
repeated after the private provenance refinement and deletion of unused state.

Additional conservative estimated token charges: $0.7647700.
Cumulative campaign: 77 calls and approximately
$1.4807375. This prices all input
at cache-write rates without discounts, and includes reasoning in output tokens.
It is not a billing statement. [Official rates](https://developers.openai.com/api/docs/pricing)
were used. The user had explicitly removed campaign ceilings.

Native regression coverage includes exact prefix preservation, effective-effort
validation before dispatch, evidence/injection text collisions, model changes,
transient reactivation, and acquired-before-interpreted recovery. The controlled
14-call peer passed. Broader macOS closed-output failures remain disclosed; current
Linux CI and review disposition belong to PR #47.

These observations establish the exercised continuation behavior and real cache
reuse. They do not prove global cache optimality, billed savings, shared cross-model
KV state, autonomous routing quality or broad model efficacy. Exact unchanged input
prefixes are local byte observations; cached tokens and cache diagnostics are separate
[provider observations](https://developers.openai.com/api/docs/guides/prompt-caching).
