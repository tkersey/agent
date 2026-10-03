import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
const identity = verifyRuntime(resolve(process.argv[2]));
const world = await import(pathToFileURL(identity.entrypoint));
const bytes = await readFile(identity.kernelPath), image = await readFile('zig-out/agent4/mobility/ensure-image.bin');
const inputSchema = decodeSchema(await readFile('zig-out/agent4/mobility/ensure-input.bin'));
const resultSchema = decodeSchema(await readFile('zig-out/agent4/mobility/ensure-result.bin'));
const tagged = (tag, value = null) => ({ tag, value });
const optional = value => value === null ? tagged(0) : tagged(1, value);
const zeros = Array(32).fill(0);
const observation = host => [host, zeros, zeros, 'policy', zeros];
const candidate = (host, cost, domain = 'public') => [observation(host), domain, optional(cost), optional(0n), optional(0n), 'cost-v1'];
const limits = { input: 16 << 20, working: 32 << 20, output: 16 << 20 };
async function run({ resolution, required = null, affinity = null, domains = [], moves = 16, attempts = 3, refuse = 0, expected }) {
  const k = await world.Kernel.create({ bytes, expectedSha256: identity.kernelSha256 }); k.setLimits(limits);
  const prepared = k.prepare(image);
  const args = [[[], [domains, optional(required), optional(affinity), 8n << 20n]], 'placement-1', 'fixture-shared', [moves, attempts]];
  const session = k.start(prepared, encodeValue(inputSchema, args));
  let output = k.drive(session, { checkpoint: true });
  const selected = [];
  let resolutions = 0;
  for (let step = 0; step < 35; step++) {
    const outcome = world.decodeOutcome(output);
    if (outcome.kind === 'completed') {
      assert.deepEqual(decodeValue(resultSchema, outcome.value), expected.result);
      assert.deepEqual(selected, expected.hosts); assert.equal(resolutions, 1);
      k.close(session); k.releasePrepared(prepared); assert.equal(k.usage().workingLive, 0n);
      return;
    }
    assert.equal(outcome.kind, 'requested');
    const request = await world.decodeRequest(outcome.request);
    const payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
    let value;
    if (request.semanticIdentity === 'agent.mobility.resolve.v1') {
      resolutions++; assert.deepEqual(payload, args[0]); value = resolution;
    } else {
      assert.equal(request.semanticIdentity, 'agent.mobility.relocate.v1');
      selected.push(payload[0]);
      assert.deepEqual(payload.slice(1), [[], 'placement-1', 'fixture-shared', moves]);
      value = selected.length <= refuse
        ? tagged(1, [tagged(1), payload[0], tagged(0, tagged(1))])
        : tagged(0, [payload[0], 1n, 'transfer', zeros, observation(payload[0])]);
    }
    output = k.drive(session, { control: 'reply', value: await world.encodeResult(outcome.request, encodeValue(decodeSchema(request.resumeSchema), value)), checkpoint: true });
  }
  throw new Error('ensure did not terminate within candidate bound');
}
const ready = (host, remaining = 15) => tagged(0, [observation(host), remaining]);
const failed = reason => tagged(1, tagged(reason));
const cases = [
  { resolution: tagged(0, observation('local')), moves: 0, attempts: 0, expected: { hosts: [], result: ready('local', 0) } },
  { resolution: tagged(1, [candidate('C', 5n), candidate('B', 5n), candidate('A', 5n)]), expected: { hosts: ['A'], result: ready('A') } },
  { resolution: tagged(1, [candidate('A', 1n), candidate('B', 999n)]), affinity: 'B', expected: { hosts: ['B'], result: ready('B') } },
  { resolution: tagged(1, [candidate('A', 1n), candidate('B', 999n)]), required: 'B', affinity: 'A', expected: { hosts: ['B'], result: ready('B') } },
  { resolution: tagged(1, [candidate('A', 1n, 'private'), candidate('B', 999n)]), domains: ['public'], expected: { hosts: ['B'], result: ready('B') } },
  { resolution: tagged(1, [candidate('A', null), candidate('B', (1n << 64n) - 1n)]), expected: { hosts: ['B'], result: ready('B') } },
  { resolution: tagged(1, [[observation('A'), 'public', optional((1n << 64n) - 1n), optional(9n), optional(1n), 'cost-v1'], candidate('B', (1n << 64n) - 2n)]), expected: { hosts: ['B'], result: ready('B') } },
  { resolution: tagged(1, [candidate('A', 1n), candidate('B', 2n), candidate('C', 3n)]), refuse: 1, expected: { hosts: ['A', 'B'], result: ready('B') } },
  { resolution: tagged(1, [candidate('A', 1n), candidate('B', 2n), candidate('C', 3n)]), attempts: 2, refuse: 3, expected: { hosts: ['A', 'B'], result: failed(9) } },
  { resolution: tagged(1, [candidate('A', 1n)]), moves: 0, expected: { hosts: [], result: failed(9) } },
  { resolution: tagged(1, [candidate('A', 1n)]), domains: ['private'], expected: { hosts: [], result: failed(0) } },
  { resolution: tagged(2, tagged(1)), expected: { hosts: [], result: failed(1) } },
  { resolution: tagged(1, [candidate('', 0n), candidate('bad\0host', 0n), candidate('A', 1n)]), expected: { hosts: ['A'], result: ready('A') } },
  { resolution: tagged(1, [candidate('A', 1n), candidate('A', 2n), candidate('B', 3n)]), expected: { hosts: [], result: failed(3) } },
  { resolution: tagged(1, Array.from({ length: 32 }, (_, i) => candidate(`host-${String(i).padStart(2, '0')}`, BigInt(i)))), attempts: 0xffffffff, refuse: 32, expected: { hosts: Array.from({ length: 32 }, (_, i) => `host-${String(i).padStart(2, '0')}`), result: failed(9) } },
];
for (const [i, value] of cases.entries()) { try { await run(value); } catch (error) { error.message = `case ${i}: ${error.message}`; throw error; } }
console.log(JSON.stringify({ check: 'authored mobility ensure', cases: cases.length, imageBytes: image.length, kernelSha256: identity.kernelSha256 }));
