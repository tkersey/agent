# Native Single-Binary Agentic Systems v1.2 acceptance

All obligations below are from the October 6, 2026 v1.2 specification.
An earlier receipt with the same ID does not discharge this version.
N0 supporting evidence is described in [the implementation notes](native-single-binary.md).
No row is accepted until its full final-artifact observation is established.

| ID | Required result | Current evidence |
|---|---|---|
| NB-001 | Native implementation reuses World's existing evaluator; no second calculus/interpreter exists. | Pending. |
| NB-002 | Current source/package/toolchain/data identities are authenticated without arbitrary repinning. | Pending. |
| NB-003 | Production native execution links only necessary data/runtime code, not the authoring compiler. | Pending. |
| NB-004 | Public downstream author recipe builds a complete authored system and declared native handlers. | Pending. |
| NB-005 | Image generation runs on the build host; cross-target runtime code is not executed there. | Pending. |
| NB-006 | Shared image generation is reused across scenarios/targets where inputs match. | Pending. |
| NB-007 | Custom output paths, package stores and exact compiler/library propagation work. | Pending. |
| NB-008 | Pure authoring installation does not acquire native environmental dependencies. | Pending. |
| NB-009 | One executable contains required program/schema/resource/runtime assets. | Pending. |
| NB-010 | Help, describe-build and offline demo work with no adjacent app resources. | Pending. |
| NB-011 | Launch requires no Node/Python/Zig/npm/WASM engine or hidden child wrapper. | Pending. |
| NB-012 | Linux x86_64 final artifact executes in its declared clean base. | Pending. |
| NB-013 | macOS arm64 final artifact executes with declared OS linkage/security requirements. | Pending. |
| NB-014 | Compile-only additional targets are not labeled executed/qualified. | Pending. |
| NB-015 | Artifact manifest names actual dependencies, target, profiles and embedded resource digests. | Pending. |
| NB-016 | Binary identity has no embedded self-hash cycle or false self-authentication claim. | Pending. |
| NB-017 | Native host uses closed Resident/Prepared ownership for supported execution. | Pending. |
| NB-018 | Reentrant/concurrent operations and use-after-close are rejected or prevented by construction. | Pending. |
| NB-019 | Progress/yield/reply/cancel/terminal controls preserve existing distinctions. | Pending. |
| NB-020 | Output/allocator failure does not publish a half-applied native drive. | Pending. |
| NB-021 | Host durable-publication failure cannot lead to subsequent effects from an uncommitted resident. | Pending. |
| NB-022 | Unfinished sessions are cancelled/parked or explicitly fenced, not silently called complete. | Pending. |
| NB-023 | Prepared-image reuse and checkpoint/restore use public APIs and canonical bytes. | Pending. |
| NB-024 | Raw pointers, callbacks, native structs and OS handles never become portable state. | Pending. |
| NB-025 | Capabilities match exact semantic/schema/resource identities, not just names. | Pending. |
| NB-026 | Present-but-disabled handlers cannot dispatch through stale model offers, resource instructions or unauthorized client messages. | Pending. |
| NB-027 | Unknown effects have explicit missing-capability behavior without external-interpreter fallback. | Pending. |
| NB-028 | Native work tools obey read-only snapshot/path/resource restrictions. | Pending. |
| NB-029 | Native code does not duplicate authored agent/control policy. | Pending. |
| NB-030 | Native HTTPS calls the admitted provider directly, without curl/Node/SDK subprocesses. | Pending. |
| NB-031 | TLS hostname/chain validation and credential redirect refusal are exercised. | Pending. |
| NB-032 | Read/deadline/body/parser limits cover missing/false Content-Length and partial responses. | Pending. |
| NB-033 | Malformed JSON, duplicate keys, exact integers and Unicode match the contract's independent expectations. | Pending. |
| NB-034 | The native-first replay-preserving core captures full admitted response/replay data separately from normalized actions and preserves needed opaque items; v3 is not flattened into a false continuity claim. | Pending. |
| NB-035 | Native provider encoding/admission passes the independent core corpus produced here; existing JS v3 checks and the compatible semantic intersection remain qualified without requiring a production JS v4 host. | Pending. |
| NB-036 | Native provider code preserves the admitted fixed model/reasoning/resource profile and never selects tools or retries unknown calls on its own. | Pending. |
| NB-037 | Secrets are supplied explicitly and absent from image, manifest, logs, argv-sensitive paths and exports. | Pending. |
| NB-038 | OS/external trust data dependencies are declared; missing trust does not disable validation. | Pending. |
| NB-039 | One OS-enforced owner controls the standalone run's durable state. | Pending. |
| NB-040 | Dispatch is durably charged; restart cannot reset the budget. | Pending. |
| NB-041 | Acquired results survive crash without external redispatch. | Pending. |
| NB-042 | Unknown dispatch remains unknown; no timeout-based safe-repeat assumption. | Pending. |
| NB-043 | Current checkpoint/artifact references commit coherently with recoverable intent. | Pending. |
| NB-044 | Known corruption/rollback generation and missing closure fail closed without reinitialization. | Pending. |
| NB-045 | Export includes complete admitted context artifacts and no local pointer/secret dependencies. | Pending. |
| NB-046 | Backend checkpoint copying is not mislabeled live custody/authority transfer. | Pending. |
| NB-047 | Native→WASM→native settled continuation reaches independent expected results. | Pending. |
| NB-048 | Canonical outcomes and effect order agree under matched logical input/profile. | Pending. |
| NB-049 | Resource-profile differences are reported rather than disguised as semantic equivalence. | Pending. |
| NB-050 | Native artifact identity is distinct from the WASM kernel hash and profile. | Pending. |
| NB-051 | Existing WASM/browser and distributed custody admission are not weakened. | Pending. |
| NB-052 | Native execution is not claimed to inherit the WASM isolation boundary. | Pending. |
| NB-053 | Minimal example actually executes an authored image, native leaf, yield and retained continuation. | Pending. |
| NB-054 | The useful fixed-profile repository analyst is authored and delivered within this project, runs without any adaptive implementation, and shares one image across CLI/stdio and recorded-reply backend parity. | Pending. |
| NB-055 | Actual native work calls, a client clarification and a queued follow-up affect later captured provider requests and the independently checked typed report; the repository remains unchanged. | Pending. |
| NB-056 | The admitted model/reasoning/resource profile, current task facts, acquired inputs and spent allowances survive restart; changed resume profiles reject and new-task selection does not reconfigure old work. | Pending. |
| NB-057 | Embedded/external instruction resources are admitted immutable task data; they cannot install native code, mutate an accepted profile or introduce unknown effects. | Pending. |
| NB-058 | Offline/mocked and real provider qualification are separately reported. | Pending. |
| NB-059 | CLI status/cancel/resume/export commands are executable and honest about unknown/pending states. | Pending. |
| NB-060 | Current legacy v3/WASM consumers retain their existing supported behavior. | Pending. |
| NB-061 | New mandatory native checks are visible, selectable and included once in full acceptance. | Pending. |
| NB-062 | Shared compilation and non-destructive cache policy remain intact. | Pending. |
| NB-063 | Cold/warm/edit build, startup, runtime, memory and provider costs are separated. | Pending. |
| NB-064 | Report contains unfavorable results and no unmeasured native speedup. | Pending. |
| NB-065 | Licenses and distribution dependencies are recorded without secrets/private assets. | Pending. |
| NB-066 | Final-artifact qualification identifies actual binary/image/profile subjects. | Pending. |
| NB-067 | PRs are current, assigned to tkersey, and use only actual dependency order. | Pending. |
| NB-068 | No unauthorized merge, release, spending, infrastructure or real-repository mutation occurred. | Pending. |
| NB-069 | The same executable implements long-lived serve --transport stdio; no protocol sidecar, interpreter or mandatory client SDK is needed. | Pending. |
| NB-070 | CLI and protocol share one native task/occurrence/evaluator owner; public status is not a second domain phase machine. | Pending. |
| NB-071 | Exactly one stdin protocol reader and framed stdout writer own serve-mode I/O; native human adapters cannot prompt/read independently. | Pending. |
| NB-072 | Fragmentation, coalesced reads, CRLF and split UTF-8 work; oversize/truncated/stalled frames are bounded and never execute prematurely. | Pending. |
| NB-073 | Closed schemas, duplicate keys, Unicode and full-width decimal/byte values admit or reject without coercion or ambiguous interpretation. | Pending. |
| NB-074 | Bounded batches, response correlation and notification suppression follow the profile; mutation notifications cause no side effects. | Pending. |
| NB-075 | Exact version negotiation precedes task/data/provider activity; repeated/unsupported initialization cannot reset execution or authority. | Pending. |
| NB-076 | Offline discovery exposes embedded method/application I/O schemas and effective limits without source checkout or remote schema fetch. | Pending. |
| NB-077 | Only launcher-admitted application/profile/resource aliases can be selected; client metadata cannot mint principals, credentials or capabilities. | Pending. |
| NB-078 | Client task/answer/message values enter exact authored typed boundaries; there is no arbitrary World reply/drive/native-tool RPC. | Pending. |
| NB-079 | Submission admission is durable before acknowledgment; restart and same-operation retransmission recover one task with no additional physical work. | Pending. |
| NB-080 | Operation IDs use canonical admitted parameters independent of JSON layout/RPC ID; different method/content/task under an existing ID conflicts. | Pending. |
| NB-081 | Deduplication survives ordinary event/result pruning; quota exhaustion rejects admission instead of forgetting live replay protection. | Pending. |
| NB-082 | An input-required event refers to an already durable pending question recoverable without its old connection or callback. | Pending. |
| NB-083 | Answers bind principal/audience, question/revision, request digest and schema; identical repeats recover a receipt and conflicting/stale answers reject. | Pending. |
| NB-084 | Answer acquisition, cancellation and revocation have a serialized winner without manufacturing approval or reviving a superseded occurrence. | Pending. |
| NB-085 | Follow-up messages are durably acknowledged as queued with stable IDs, bounded capacity and observable delivery disposition. | Pending. |
| NB-086 | Queued inputs are consumed once at an authored settled boundary; held provider/tool calls retain their original request/reply pairing and context. | Pending. |
| NB-087 | The reusable authored inbox is implemented here and has the same image/contract semantics under native and recorded-reply WASM execution; no adaptive prerequisite or native JSON-loop policy exists. | Pending. |
| NB-088 | Terminal/cancellation races report acknowledged but unconsumed inputs; no silent discard, task resurrection or automatically charged replacement task. | Pending. |
| NB-089 | RPC acceptance, application completion/failure, unknown delivery and pending input remain distinct in acknowledgments, status, events and result lookup. | Pending. |
| NB-090 | Large typed results/schemas use authorized immutable references and bounded exact artifact chunks; truncation/path access/re-inference are not fallbacks. | Pending. |
| NB-091 | Current grants and task/audience ownership gate status, replay, subscriptions and every artifact read, including after revocation. | Pending. |
| NB-092 | Required events correspond to durably committed task facts, preserve per-task sequence across restart and cannot precede their authoritative publication. | Pending. |
| NB-093 | Subscribe registration/replay/live tail has no completion gap; its response precedes its ordered notifications and unsubscribe closes that ordering. | Pending. |
| NB-094 | A restarted client resumes after its last processed sequence; duplicates are detectable and terminal results survive lost notifications. | Pending. |
| NB-095 | Expired/future event cursors are explicit; bounded history pruning preserves current questions/results/unresolved evidence and replay tombstones. | Pending. |
| NB-096 | With output consumed, ping/status/valid input/cancel acknowledgment remain serviceable while provider I/O is held and World work is bounded. | Pending. |
| NB-097 | Slow stdout and queue pressure cannot cause unbounded buffering, interleaved frames, silent RPC response loss or evaluator-lock deadlock. | Pending. |
| NB-098 | Blocked stderr and dependency diagnostics cannot contaminate protocol stdout or block task cancellation/publication. | Pending. |
| NB-099 | EOF/EPIPE/framing or output stall applies bounded park-and-exit, stops new dispatch and never means automatic semantic cancellation or hidden background work. | Pending. |
| NB-100 | Shutdown park/cancel modes acknowledge intent separately from outcome and retain unknown/unfinished cleanup rather than claiming global success. | Pending. |
| NB-101 | Documented serve-mode exit dispositions distinguish settled exit, incomplete work, protocol/config, storage and already-owned namespace conditions. | Pending. |
| NB-102 | New instances expose old tasks/results but require explicit eligible resume and current grants; process/subscription IDs do not reset budgets or task identity. | Pending. |
| NB-103 | A second server/one-shot CLI cannot bypass the OS-enforced live state owner; workers are quiesced/fenced before ownership is released. | Pending. |
| NB-104 | Unknown provider delivery remains unknown across connection loss, RPC retransmission, shutdown and resume; there is no blind paid retry. | Pending. |
| NB-105 | The fixed-profile binary exposes no inference_set/skill_set or privileged raw-tool RPC; later adaptive controls must use checked authored actions rather than ambient protocol administration. | Pending. |
| NB-106 | Default events/errors/discovery exclude credentials, opaque reasoning and unauthorized private paths/payloads while preserving useful typed results. | Pending. |
| NB-107 | Error codes/kinds and recovery dispositions distinguish unadmitted work from uncertain acceptance without leaking other tasks or instructing blind provider retry. | Pending. |
| NB-108 | Complete offline protocol schemas/transcripts and a usable TypeScript subprocess client demonstrate both directions without becoming application runtime dependencies. | Pending. |
| NB-109 | Linux x86_64 and macOS arm64 clean-artifact qualification runs real bidirectional task/question/message/result/cancel exchanges. | Pending. |
| NB-110 | Protocol conformance/fault cases reuse the existing owner, native/provider corpus and shared compilations; no per-method binary or ceremony-only CI expansion. | Pending. |
| NB-111 | Protocol/control latency and queue memory are measured separately from provider/task duration; responsiveness is demonstrated during a held external call. | Pending. |
| NB-112 | Required scope remains stdio without an inbound listener; no unsupported MCP/A2A/network-authentication, callback-tool or distributed-custody compatibility claim is made. | Pending. |
