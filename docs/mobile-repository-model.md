# Stateless model leaf and durable work allowance

The reference deployment loader supports `openai-responses-replay` as an ordinary
model leaf. It returns normalized proposals; the authored program owns tool
selection, local admission, execution, recovery and subsequent model calls.
The authored mobile repository loop now consumes this leaf, retaining replay,
paired tool results, staged edits, checks, and logical allowances across human
review. No live provider qualification has been run.

The existing `agent.model.invoke.v3` request and result are unchanged. The additive
`agent.model.invoke.v4` contract nests that request with bounded replay bytes and
call/result pairs. Its result retains the normalized v3 result, complete supported
replay items, explicit continuity status, and optional observed usage. The replay
limit is 2 MiB, subject to inherited World limits. Reasoning content remains
opaque. Missing encrypted reasoning, unsupported items and overflow cannot be
reported as preserved continuity; they produce explicit unsupported/capacity
status. The protected replay responder rejects candidate interpretation in those
cases. It also retains the request-time offered set and selection policy through
suspension, just like the existing model responder.

Stateless Responses requests return encrypted reasoning by default. Continuing
without stored responses requires replaying complete output items, including
assistant phase and function call/result pairing. This implementation was checked
against the [official reasoning documentation](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses).
It uses `store: false`, no provider conversation ID and no `previous_response_id`.
Neither replay retention nor encryption changes the run's classification.

## Operator profile

A deployment binding for `agent.model.invoke.v4` supplies a compiled request/result
schema and the normal principal, tenant, scope, audience and state-label grants.
Its adapter configuration is explicit; there is no default live model or key.
This is a synthetic loopback example, not a production model selection:

```json
{
  "kind": "openai-responses-replay",
  "owner": "W",
  "mode": "loopback-fixture",
  "endpoint": "http://127.0.0.1:9000/v1/responses",
  "credentialEnv": null,
  "model": "fixture-model",
  "parameters": { "maxOutputTokens": 128, "temperature": null, "reasoning": null },
  "timeoutMs": 1000,
  "maximumRequestBytes": 100000,
  "maximumResponseBytes": 32768,
  "disclosure": { "audience": "fixture-provider", "policyRevision": "p1", "labels": ["shared"] },
  "allowance": { "attempts": 2, "request_bytes": 200000, "output_tokens": 256, "concurrent": 2 }
}
```

`openai-live` requires the exact HTTPS OpenAI Responses endpoint and an explicitly
selected credential environment variable. Keys are read only by the provider
owner at dispatch; they are not transported in the request contract, replay,
checkpoint, journal or browser. Configuring a live profile is an operator action
requiring provider, data-disclosure and positive work-budget authorization.
The existence of an environment variable is not that authorization. Loopback
profiles admit only literal loopback addresses and reject credential variables.
Redirects are refused. Streaming and background provider jobs are unsupported.

The complete actual request—including replay, tool descriptions and schemas—is
bounded before dispatch. Model and parameters must match the selected profile;
run labels must be admitted by its explicit disclosure grant. Timeouts are
positive and at most 120 seconds. Attempts are at most 32, concurrent unsettled
requests at most eight; configured lower bounds apply. Requested output-token
allowance and total request bytes are charged separately. Observed input/output
and cached-input token counts are retained when supplied. These bounds and
observations are not a dollar-cost estimate or a guarantee of provider pricing.

## Recovery and accounting

The existing custody journal atomically charges a run's allowance with its
occurrence's dispatch claim. The record binds the signed run registration,
configured W owner, profile/grant digest and limits. Reattachment, service restart,
reply failure or return to W cannot create another allowance or widen it. Charged
attempts are never refunded after an ambiguous request. Allowance rows count
against the journal's record quota. Unknown work retains its concurrency slot.

Provider I/O runs after the durable claim without retaining the per-run execution
lock. The local promise holds only the active I/O resource; the journal owns all
continuation and recovery facts. Completion checks the exact occurrence/attempt,
custody epoch, execution revision and outcome. Executor attachment alone does not
invalidate the same pending external occurrence. Cancellation does.

Lost transport and HTTP failure leave `UNKNOWN`; there is no automatic repeat.
A model leaf explicitly permits discarding a response because it returns only
proposals. Cancellation aborts and awaits local I/O before marking that occurrence
`ABANDONED`, then drives normal World cancellation/cleanup. Its charged attempt
remains. Unknown mutation leaves without this permission remain blocked. This
permission does not prove an unobserved provider call was free or never ran.

Tests cover fresh adapter processes and recreated loopback servers, complete item
replay and pair ordering, unsupported/missing items and overflow, profile and
disclosure rejection, native World offer custody, transaction fault boundaries,
restart-preserved charges, concurrency, cancellation and late replies. No tests
in this lane use a production credential or send repository data to a provider.

## Authored investigation

The application offers list/read/search, edit, check, ask, and finish. Inspect mode
never offers edits or checks. Edits replace the staged entry at the same path and
invalidate the prior candidate and validation. The program prepares/checks the
exact staged set; finishing a changed candidate requires a passing disposition.
Diagnostic records are supplied intact within the model context bound; overflow
stops explicitly rather than silently truncating a check.

The owned investigator remains suspended during review. A read-only question
returns to its original call site with mutation actions withheld. An amendment
clears staged edits/candidate/checks and supplies new guidance within the original
scope. Neither path resets logical work, movement, physical charges, or replay.
Final disposition alone completes and cleans up the investigator.
