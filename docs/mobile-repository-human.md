# Durable questions and reference browser sessions

The existing mobility custodian and journal now support a known deferred leaf.
This is environmental reply acquisition; the compiled World image still decides
what happens after the reply. The repository application's complete proposal and
approval UI is not yet implemented.

A trusted binding may provide synchronous `defer` and `answer` functions plus a
`deferredRevision`. `defer` returns the audience, display question, allowed choice
names (at most 16), and maximum text bytes (at most 8192). It must perform no
external effect. The journal atomically claims the current `READY` occurrence as
`AWAITING`, storing the complete question with its principal, tenant, request,
answer schema and binding revision. The scheduler releases its lock. Existing
immediate byte-reply bindings retain their behavior.

The browser submits a choice and text, together with the current version,
occurrence ID, request digest and question digest. It never supplies a World
reply. After authentication and policy checks, the trusted synchronous `answer`
encoder produces a schema-validated reply. A journal transaction checks the
identity, audience, current occurrence, version, input bounds and cancellation
again before acquiring it. An identical duplicate returns the acquired result;
a conflicting answer rejects. Cancellation before acquisition prevents a reply;
acquisition before cancellation preserves the saved reply, with cancellation
applied at the next eligible boundary. A restart never asks for a replacement
answer. GC retains the current question until its occurrence is consumed.

The `human-text` deployment adapter supports a bounded-text reply contract:

```json
{ "kind": "human-text", "revision": "human-text-v1" }
```

It presents the decoded typed payload as inert text and offers one `respond`
choice. Its schema must declare a positive text limit of at most 8192 bytes.
This adapter does not represent proposal approval or mint an approval grant.
The revision is operator-owned and must change if answer interpretation changes;
a changed revision cannot encode an outstanding unanswered question.

## Reference authentication

A browser deployment can add the following optional configuration to the existing
`agent-mobility-deployment/v1` document. Paths resolve relative to that document.
The state directory must be private to the service user. The browser and peer
services use separate ports and the configured TLS certificate.

```json
"browser": {
  "directory": "private/browser-sessions",
  "audience": "human-A",
  "host": "127.0.0.1",
  "port": 8444,
  "publicOrigin": "https://localhost:8444"
}
```

`execution` must be `browser`. `init CONFIG` explicitly creates custody and
session storage. An operator may then use the installed CLI:

```sh
node runtime/mobility/cli.mjs login-issue CONFIG PRINCIPAL TENANT
node runtime/mobility/cli.mjs serve CONFIG
```

Issuance requires an existing deployment grant for that principal and tenant,
and the configured audience. There is no default identity or public issuance
endpoint. The command prints one credential and its expiry; deliver it privately
to the intended person. Do not put it in a URL. Session issuance may run while the
service is active because it touches only the independent session store; custody
mutation commands still require stopping the service.

The person opens the printed browser origin's `/login` page. Redemption is a TLS
POST with the exact origin and host/port. The credential is one-use and expires
in ten minutes. A session lasts eight hours and uses a `__Host-agent-session`
Secure, HttpOnly, SameSite=Strict cookie. Storage contains random-token verifiers,
not plaintext credentials. Session/grant checks run on every authenticated
request; the bridge retains its session-bound CSRF checks. The session owner
supports explicit revocation, expiry and bounded admission (256 live login or
session rows by default). An existing SSO integration can still supply the
unchanged `authenticate(request)` seam instead.

## Current proof

Journal tests exercise restart, GC, before/after-commit fault injection,
authentication/scope mismatches, stale versions, duplicate/conflicting answers and
both cancellation orders. The production-adjacent three-host model includes
known waiting and answer races. TLS tests cover issuance, redemption, cookies,
expiry, revocation, wrong origin/port, URL rejection and missing public minting.
The extracted CLI issues a credential accepted by its configured browser bridge.
Chromium and Firefox tests use the actual login form, show inert question text,
restart the origin/custodian while waiting, reconnect with a fresh Worker, submit
an answer and complete the inherited compiled fixture.

These are synthetic-human tests, not actual-person qualification. They exercise
the generic owner seam and inherited fixture; full Mobile Repository application
and proposal/approval integration remain separate work.

## Retained application review

`repository-review-human` presents inspect/propose results with finish, decline,
question, and amend choices. `repository-approval-human` offers approve, decline,
question, and amend through the existing private approval owner. Question/amend
are typed rejection reasons, not approval grants. The authored investigator stays
parked until review resolves; questions withhold mutation, and amendments invalidate
the old candidate/check. The UI renders both proposal and publication diffs as text.
A restarted origin retains the exact pending question; cancellation disposes the
investigator once and cannot publish.
