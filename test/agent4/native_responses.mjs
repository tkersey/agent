// The retained JS v3 normalizer runs the same independent corpus where the
// contracts intersect. Keep v3's ignored-envelope Unicode behavior and v5's
// whole-batch rejection explicit; neither is an equality claim.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeOpenAIResponses} from '../../runtime/model.mjs';

const corpus = JSON.parse(readFileSync(new URL('./native-responses-v1.json', import.meta.url)));
assert.equal(corpus.version, 1);
const limits = {maximumOutputItems: 8, maximumCallIdBytes: 64, maximumNameBytes: 6, maximumArgumentsBytes: 256, maximumArgumentNameBytes: 5, maximumArgumentFields: 1, maximumResultTextBytes: 256};
const tools = [{name: 'choose', actionOrdinal: 0, actionTag: 0, argumentCodec: [{name: 'value', kind: 'unsigned_integer', bitWidth: 64, maximumBytes: 0, enumNames: [], enumTags: []}]}];
const tags = ['output', 'refusal', 'transport_failure', 'provider_failure', 'unsupported_response'];
const reasons = ['unsupported_protocol', 'unsupported_parameter', 'malformed_json', 'invalid_utf8', 'unsupported_status', 'unsupported_output_item', 'mixed_refusal', 'normalization_limit'];
const items = [];
const nonintersection = [];
for (const fixture of corpus.cases) {
  const result = normalizeOpenAIResponses(Buffer.from(fixture.body), limits, tools);
  if (fixture.name === 'invalid whole batch' || fixture.name === 'invalid Unicode') {
    // v3 admits multiple calls and ignores this malformed string in an unused
    // envelope field. Native admission rejects the complete malformed envelope.
    assert.equal(tags[result[0]], 'output', fixture.name);
    nonintersection.push(fixture.name);
    continue;
  }
  if (fixture.name === 'missing call id') {
    // v3's requireTextLimit classifies absent text as a normalization limit;
    // v5 distinguishes a structurally unsupported item. Both reject the call.
    assert.equal(tags[result[0]], 'unsupported_response', fixture.name);
    assert.equal(reasons[result.readUInt32LE(1)], 'normalization_limit', fixture.name);
    nonintersection.push(fixture.name);
    continue;
  }
  assert.equal(tags[result[0]], fixture.result, fixture.name);
  if (fixture.reason) assert.equal(reasons[result.readUInt32LE(1)], fixture.reason, fixture.name);
  items.push({name: fixture.name, result: result.toString('hex')});
}
assert.deepEqual(nonintersection, ['invalid Unicode', 'missing call id', 'invalid whole batch']);
assert.equal(items.length, corpus.cases.length - nonintersection.length);
console.log(JSON.stringify({version: 1, items, explicit_nonintersection: nonintersection}));
