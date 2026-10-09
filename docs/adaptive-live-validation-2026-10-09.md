# Adaptive Responses live validation — October 9, 2026

The requested live trajectory **passed on repaired source `94abcabe6e53ba51e461bcc48c458472eb8829cd`**, using the Boundary-authored program through native World and the real OpenAI Responses endpoint. The merged PR #46 artifact did **not** pass: its first terminal report was rejected because the replay grammar omitted documented reasoning content. The following repairs and successful observations do not retroactively qualify that artifact.

This is a finite live integration observation. It does not establish broad production readiness, routing optimality, model quality, mathematical proof, or general cache savings. The separate macOS closed-output failures below remain unresolved.

[Machine-readable observations](adaptive-live-observations-2026-10-09.json) retain all 46 physical attempts, their request/response hashes, returned metadata and usage, controls, lineage changes, tool offers, and local input-prefix comparisons. Raw requests, provider bodies, encrypted reasoning, credentials, task state, and checkpoint archives remain private and out of Git/CI uploads.

## Tested subjects

| Subject | Source / artifact SHA-256 |
| --- | --- |
| Merged main | Agent `c19a210664bdde2796f4de5e73d42c4064ab5986`; Linux binary `6df794f15c196bd47669d30fcf1e7cfa399f110ee272f470afd81204e211ac74` |
| Repaired reference | Agent `94abcabe6e53ba51e461bcc48c458472eb8829cd`; macOS arm64 binary `b1180bf2ecd6807f1284d7984c6c046b3805523df54f548f899ac2e4751d76e1` |
| Repaired BPI3 | `16395c9203f7809c7c42a31c864fa00bf4eac9f58b28e357dbdbf904a19960cc` |
| Repaired application assets | `be66351557a08e049596f0f5ef88c76cbc5ee15d77303331cbd5e48c5ffbd371` |
| Boundary lock | `c49f743382257c7cf5512934ae3a2d0f56d4d4c0` |
| World lock | `35f11b811b03fcaa2d696265ff8d9b9c92c8fc95` |

Zig 0.17.0, safe optimization, SQLite 3.53.4. Compiler executable/library inventories and both lock hashes are recorded per subject in the JSON. Main began clean; the parser-only intermediate was a dirty candidate whose binary is separately identified. The repaired source commit contains both fixes; later evidence-only commits do not change its executable source.

The original Linux bundle came from [exact-main workflow 37926601318](https://github.com/tkersey/agent/actions/runs/37926601318), artifact 11614357412. Its downloaded SHA-256 matched GitHub metadata, and binary/program/assets/dependency-lock hashes matched its manifest. The user subsequently authorized macOS execution. No dependency pin changed, and no live calls were added to routine CI.

## Authorization and accounting

Only `https://api.openai.com/v1/responses` was used. The named repository credential binding was explicitly authorized; no credential discovery, provider proxy, SDK agent loop, mock endpoint, or forced model call was used for live tasks. External JavaScript only drove the native public protocol and inspected captures.

The original campaign ceilings were retained through 28 calls. At that point the user explicitly removed call, task, request, and spend ceilings. Subsequent calls remain part of the same accounting campaign. Existing tasks' frozen policy was never changed. New final tasks restored the normal 256 KiB request capacity and 4,096 output tokens; the application's existing 16-attempt task schema remained sufficient for the 13-call exercise.

Total: **46 physical attempts**, all with reported usage; **US$0.7159675 conservative estimated token charges**. This estimate prices every input token at the model's cache-write rate and all output tokens, including reasoning, at its output rate. It assumes no cache-read discount. It is neither a billing statement nor an exact invoice ceiling. Standard rates per million tokens were Sol $2 input / $0.10 cached / $2.50 write / $10 output and Astra $10 / $1 / $12.50 / $50. [Official pricing](https://developers.openai.com/api/docs/pricing).

Every request used `store:false`, `stream:false`, `background:false`, `truncation:"disabled"`, and `parallel_tool_calls:false`. No conversation store, `previous_response_id`, pro mode, configuration-update item, or premium service tier was selected. The provider returned the exact requested model IDs and `service_tier:"default"`; no alternate snapshot alias needs interpretation. Requested reasoning context `auto` returned `all_turns`. Both named models' supported efforts were rechecked in the [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) documentation; account access is established by the acquired responses, not the catalog.

## Runs, including failures

| Run | Subject | Physical attempts | Outcome |
| --- | --- | ---: | --- |
| ordinary | merged | 5 | no_result: documented empty reasoning content rejected |
| ordinary-repaired | parser_repair | 5 | grounded report |
| directed | parser_repair | 6 | capacity: operator-selected 20 KiB request cap |
| directed-retry | parser_repair | 12 | no_result: transient unload rejected by 8 KiB handoff ceiling |
| ordinary-final | repaired | 5 | grounded report |
| directed-final | repaired | 13 | grounded report after both transitions and settled restart |

UTC start/end times appear in each run record. The successful directed task ran from **2026-10-09T13:32:43.841Z** to **2026-10-09T13:35:28.074Z**, task `47f0f530847b16c8a7e95e117152a311`.

The first failure was a completed HTTP 200 response containing a valid report and a reasoning item with `content:[]` plus encrypted content. The closed replay grammar rejected the content field. The repair validates optional null/array content, admits only documented `reasoning_text` entries, preserves the original item privately, and retains unknown-field and malformed-shape rejection. The [official generated SDK type](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_reasoning_item.py) independently describes that field.

The first directed failure was caused by the operator's unnecessarily small 20 KiB request setting. The next directed task reached Astra, but its complete transient-unload handoff measured **8,532 bytes**, exceeding the consumer's separate 8,192-byte message ceiling. Independent reconstruction exactly matched an earlier emitted handoff before calculating the rejected one. The second repair gives the consumer the transport-sized message representation and checks handoff facts against the selected request capacity before complete-request admission. It neither drops facts nor enlarges dependency, host-memory, or storage limits. Old task/capture bindings were not rewritten.

## Successful directed trajectory

Profiles were frozen as `sol = gpt-6.1-sol, medium/high, standard` and `astra = gpt-6-astra, medium, standard`; initial selection was `sol/medium`. All controls below originated in actual provider function calls and passed the checked responder.

| Request | Actual model / effort | Context epoch | Model action | Returned cached input tokens |
| ---: | --- | --- | --- | ---: |
| 1 | gpt-6.1-sol / medium | 0 (initial) | list | 1287 |
| 2 | gpt-6.1-sol / medium | 0 (initial) | read | 1389 |
| 3 | gpt-6.1-sol / medium | 0 (initial) | skill_set load | 1760 |
| 4 | gpt-6.1-sol / medium | 0 (initial) | inference_set | 1757 |
| 5 | gpt-6.1-sol / high | 1 (effort_change) | inspect | 1026 |
| 6 | gpt-6.1-sol / high | 1 (effort_change) | skill_set deactivate | 3083 |
| 7 | gpt-6.1-sol / high | 1 (effort_change) | skill_set unload | 3200 |
| 8 | gpt-6.1-sol / high | 2 (eviction) | inference_set | 1029 |
| 9 | gpt-6-astra / medium | 3 (model_change) | skill_set load | 1029 |
| 10 | gpt-6-astra / medium | 3 (model_change) | read | 3117 |
| 11 | gpt-6-astra / medium | 3 (model_change) | skill_set unload | 3507 |
| 12 | gpt-6-astra / medium | 4 (eviction) | ask | 1029 |
| 13 | gpt-6-astra / medium | 4 (eviction) | report | 3884 |

The effort switch was source request 4 → request 5, control revision 1 → 2. Sol/high performed inspect on request 5 and interpreted its four-guard result before requesting deactivation on request 6. The cross-model switch was request 8 → request 9, control revision 4 → 5. Both switches settled through explicit semantic handoffs and new epochs; **this does not qualify an in-place effort-update optimization**. Each transition's actual call, source capture, receipt, next request hash, and next response identity are recorded in `successful_directed_audit.transitions`.

Resident guidance and the inspect definition appeared only after load. Deactivation removed the inspect offer while retaining its materialized definition/body; unload physically excluded both and the old opaque context. The transient reporting body appeared in consecutive Astra requests 10 and 11, after eligible cache boundaries, and was absent after unload. Its unload reason interpreted the scenario result. The seventh control receipt left no loaded skills.

Independent capture checks verified complete call/result pairing in every outgoing request or explicit settlement in a new-epoch handoff, unchanged task policy/resource identities, original goal and Sol evidence in Astra's handoff, correct effective effort, and physical exclusion of prior opaque reasoning at every epoch change. One identified follow-up was queued while inference was running and recorded as consumed once.

## Task results and recovery

The new non-sensitive fixture contains quota.mjs (712 bytes), scenario.mjs (414 bytes), and README.md (284 bytes). Hashes and independently specified expectations are in the JSON. Actual native reads covered quota [0,712) and scenario [0,414); the ordinary task also read README [0,284). No repository code was executed by either task.

The final report correctly explains remaining + reserved conservation under valid states and exact arithmetic, the 10 → 6 → 10 scenario, duplicate and insufficient rejection, and repeat-release no-op. Astra explicitly cites Sol-acquired quota evidence and its own scenario evidence; it uses the Sol inspection's four guards while distinguishing lexical counts from proof. It incorporates the follow-up's malformed-state/testing limitation.

After request 12, the native host parked at the model's real conservation-versus-duplicate-handling question. Reopening used `--profile-task` and saved inputs, with no replacement launch config. Question ID/revision/digest were unchanged. The complete exported archive was byte-identical before and after this restart, including checkpoint, frozen authority/resources, consumed inputs, and all counters: **12 attempts → 12 attempts**, no reacquisition. An explicit protocol answer requested emphasis on conservation. The next and final inference was **Astra/medium**, yielding the grounded report at attempt 13. The original question/answer and once-only follow-up are retained.

## Cache and feature observations

Explicit cache markers, 30-minute TTL, developer tool additions, permitted-tool selection, stateless encrypted replay, and comparison-response diagnostics were accepted on the exercised requests. Same-epoch comparisons returned `cache_hit`; comparison diagnostics were absent on initial/new-epoch requests. No fallback disabled these features. [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [function calling](https://developers.openai.com/api/docs/guides/function-calling).

Across the whole campaign, provider-reported cached tokens were **35,156 Sol/medium**, **19,794 Sol/high**, and **22,986 Astra/medium**. Per-request counts for the final trajectory appear above. The earlier first Astra request was cold; later Astra requests, including a later task's first request, showed positive cached tokens. This establishes reuse for those requests, not shared Sol/Astra KV state. The source of cache reuse across tasks is not established. New epochs and unloads are explicitly labeled; local unchanged-input-prefix measurements remain separate from provider cache evidence. No prewarm or cache-only request was made.

## Verification and remaining limits

- Repaired build and all **117 native unit tests passed**, including malformed-response cases and large-handoff acquired-before-interpreted recovery.
- The retained 14-call controlled adaptive peer passed controls, offers, hard eviction, inbox, questions, archive checks, cancellation and unknown-delivery handling. It is offline evidence, separate from the live calls.
- Full macOS `check-native-product` failed two closed-output shutdown peers: children were killed by their watchdog instead of exiting 74. An isolated host recheck reproduced this. No assertion was weakened and this platform behavior is unresolved.
- Exact follow-up Linux CI and review disposition belong to the follow-up PR; this report does not turn pending checks into passes.
- Live in-place effort updates, return to Sol, other model/effort pairs, alternative platforms, ambiguous acquisition retry, autonomous routing quality, and broad model efficacy remain unqualified. No merge or release is authorized by this report.
