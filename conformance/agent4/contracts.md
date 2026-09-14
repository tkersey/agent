# Compiled example contracts

The authoritative schemas and bindings are in each BPI2 and pending ERQ2. These
names explain the demonstration values; they supply no continuation or policy.
Canonical values use Boundary2 little-endian scalars and minimal ULEB sequence/sum
counts. Text is byte-counted UTF-8. Product fields are in listed order.

## Interactive document revision

InitialArgs is u64 (fixture7). Root result is optional retained accepted score.
A first message requires clarification; subsequent successful turns can recall
retained knowledge. Explicit close ends the conversation. The examples use numeric
synthetic task/clarification values so transfer can be checked exactly.

Exchange payloads are `(channel:text, purpose:text, presentation:unit, outgoing)`.
The clarification helper retains input+1000 and accepts `Value(u64)` or `AbortTurn(unit)`.
The critic accepts `Value(u64)` and retains its own internal dialogue. A turn reply
awaits `Value(u64)` or `CloseConversation(unit)`; its outgoing sum is revised(score),
recalled(score), aborted, conflict(observation), failed(text), uncertain(text),
declined(text), invalid, denied, in that order.

A document observation is `(content:Text128,digest:Text64)`. `document.read.v1`
accepts Text32 path and returns success(observation) or failure(Text64).
`document.replace.v1` accepts a proposal:

`(path:Text32, base:observation, replacement:Text128, provenance:u64,
required_principal:u64, reason:Text64)`.

Its result is success(observation), conflict(observation), failure(Text64), or
uncertain(Text64). The allocated fixture path is document.txt; live policy admits
principal7 and external provenance1. Actual read evidence is held privately in
PST2 and cannot be supplied through this product. Conditional replacement verifies
actual content and digest under the local environment's serialization discipline.

`agent.approval.issue.v1.document.change` requests a fresh authority occurrence
for the retained proposal and returns u64 synthetic occurrence data. The approval
exchange `agent.interaction.exchange.v1.document.change` offers
`Challenge=(occurrence:u64,proposal)`. Its resume is
`Value((Challenge,principal:u64,Decision))`, where Decision is Approve(unit),
Reject(Text64), or Amend(proposal). Authentication of supplied principals belongs
to the trusted adapter. Replaying an old entire snapshot is not prevented here.

`document.turn.cleanup.v1` returns unit for its u64 resource observation. It may
remain requested while cleanup is suspended, including during World cancellation.

The model effect is `agent.model.invoke.v3`; the proposal answer contains a typed
replacement and score. See the included model contract for its full request,
normalized result, strict JSON descriptors and failure tags. The supplied fixtures
are synthetic external answers, never a host control program or live model proof.

## Review and headless examples

The two review images differ in authored request order: evidence→reviewer→clarify,
and evidence→clarify→reviewer. Each keeps typed findings and offers another review.
Their images declare no write or commit effects. The human/model/rule images use
the same Ask body with prescribed equal answer5 and complete with result8. The
ReAct example is an ordinary headless public composition returning2.

Review-specific field schemas are carried by the requested records. The optional
included test oracle supplies and checks their synthetic values; it is not required
to execute an image. The runner and raw World need only image, InitialArgs or State,
and canonical results. Named `inventory.json` is solely a distribution file list.
