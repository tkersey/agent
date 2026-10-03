// M1 continuation scaffold only: durable custody is qualified separately.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyRuntime, readDependencyLock } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { fileBinding } from '../../runtime/text_file.mjs';
import { subject, READ, CLOSE } from '../../runtime/text_inspection.mjs';
import { placement, resolution } from './mobility_fixture.mjs';

const runtimePath = resolve(process.argv[2]);
const nativePath = process.argv[3] ? resolve(process.argv[3]) : null;
let nativeComparisons = 0;
const identity = verifyRuntime(runtimePath);
const world = await import(pathToFileURL(identity.entrypoint));
const bytes = await readFile(identity.kernelPath);
const image = await readFile('zig-out/agent4/mobility/program.bpi3');
const schema = async name => decodeSchema(await readFile(`zig-out/agent4/mobility/${name}.schema`));
const taskSchema = await schema('task'), reportSchema = await schema('report');
const area = await mkdtemp(join(tmpdir(), 'agent-mobility-continuation-'));
const content = new TextEncoder().encode('alpha\nbeta gamma\ndelta epsilon zeta\nomega\n');
const declared = await subject('fixture/story', content);
const zeros = Array(32).fill(0);
const initial = encodeValue({ root: 0, types: ['u64'] }, 123n);
const MOVE = 'agent.mobility.relocate.v1';
const TASK = 'agent.mobility.fixture.task.v1', PRESENT = 'agent.mobility.fixture.present.v1';
const SIDE = 'agent.mobility.fixture.child-resumed.v1', CLEANUP = 'agent.mobility.fixture.child-cleanup.v1';
const limits = readDependencyLock().world.runtime.physicalProfile.maximumMemoryBytes;
const make = async () => {
  const kernel = await world.Kernel.create({ bytes, expectedSha256: identity.kernelSha256 });
  kernel.setLimits({ input: limits, working: limits, output: limits });
  const prepared = kernel.prepare(image);
  return { kernel, prepared };
};
try {
  await writeFile(join(area, 'story.txt'), content);
  async function run({ refuse = false, cancelAtMove = false } = {}) {
    const binding = await fileBinding(declared, { root: area, path: 'story.txt' });
    let current = await make(), host = 'A', epoch = 0n, moves = 0, child = 0, cleanup = 0, presented = 0;
    let session = current.kernel.start(current.prepared, initial);
    let output;
    async function advance(options = {}) {
      const input = { image, ...(output === undefined ? { initialArgs: initial } : { state: world.decodeOutcome(output).state }), ...options };
      const next = current.kernel.drive(session, { ...options, checkpoint: true });
      if (nativePath) {
        const path = join(area, 'native-input.pki3'); await writeFile(path, world.encodeInput(input));
        const expected = new Uint8Array(execFileSync(nativePath, [path], { maxBuffer: 16 << 20 }));
        assert.deepEqual(next, expected, 'native and WASM canonical semantic boundary/outcome must agree'); nativeComparisons++;
      }
      output = next;
    }
    await advance();
    const trace = [], retired = [];
    for (let turn = 0; turn < 32; turn++) {
      const outcome = world.decodeOutcome(output);
      if (outcome.kind === 'completed' || outcome.kind === 'cancelled') {
        current.kernel.close(session); current.kernel.releasePrepared(current.prepared);
        assert.equal(current.kernel.usage().workingLive, 0n);
        assert.equal(cleanup, 1, 'owned cleanup is discharged once');
        if (cancelAtMove) {
          assert.equal(outcome.kind, 'cancelled'); assert.equal(child, 0); assert.equal(moves, 0);
        } else {
          assert.equal(outcome.kind, 'completed'); assert.equal(child, 1);
          assert.deepEqual(decodeValue(reportSchema, outcome.value), [123n, 9001n,
            refuse ? { tag: 1, value: null } : { tag: 0, value: [BigInt(content.length), 4n] }, 91n]);
          assert.equal(moves, refuse ? 0 : 2); assert.equal(presented, refuse ? 0 : 1);
          assert.deepEqual(binding.counts(), { reads: refuse ? [] : [0n, 16n, 32n], releases: refuse ? 0 : 1 });
          if (!refuse) assert.deepEqual(retired, ['A', 'B']);
        }
        return { trace, retired, moves, child, cleanup, presented };
      }
      assert.equal(outcome.kind, 'requested'); assert.ok(outcome.state);
      const request = await world.decodeRequest(outcome.request);
      const input = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      trace.push([host, request.semanticIdentity]);
      let value;
      if (request.semanticIdentity === 'agent.mobility.resolve.v1') {
        value = resolution(input, host, identity.kernelSha256);
      } else if (request.semanticIdentity === MOVE) {
        if (cancelAtMove) {
          await advance({ control: 'cancel_text', value: 'test cancellation' });
          continue;
        }
        if (refuse) {
          value = { tag: 1, value: [{ tag: 0, value: null }, input[0], { tag: 0, value: { tag: 0, value: null } }] };
        } else {
          const destination = input[0];
          assert.ok(['A', 'B'].includes(destination)); assert.notEqual(destination, host);
          // Retire this actual resident instance without semantic cancellation.
          const parked = current.kernel.checkpoint(session, { transfer: true });
          assert.deepEqual(parked, outcome.state);
          assert.throws(() => current.kernel.drive(session), { code: 'WORLD_HANDLE_INVALID' });
          current.kernel.releasePrepared(current.prepared);
          assert.equal(current.kernel.usage().workingLive, 0n);
          retired.push(host); current = null;
          current = await make(); host = destination; epoch++; moves++;
          session = current.kernel.restore(current.prepared, outcome.state);
          assert.deepEqual(current.kernel.checkpoint(session), parked, 'target restores exact pending call');
          assert.deepEqual(current.kernel.drive(session, { checkpoint: true }), output, 'target exposes the same canonical requested outcome');
          value = { tag: 0, value: [host, epoch, `transfer-${epoch}`, zeros,
            [host, zeros, zeros, 'fixture-policy', Array.from(Buffer.from(identity.kernelSha256, 'hex'))]] };
        }
      } else if (request.semanticIdentity === TASK) {
        assert.equal(host, 'A'); assert.equal(input, 123n);
        // Empty requirements here isolate continuation transport; the durable
        // application suite supplies complete admitted capability contracts.
        value = [123n, 9001n, declared, placement('B', 2, 'inspect'), placement('A', 1, 'present')];
        assert.deepEqual(encodeValue(taskSchema, value), encodeValue(decodeSchema(request.resumeSchema), value));
      } else if (request.semanticIdentity === READ || request.semanticIdentity === CLOSE) {
        assert.equal(host, 'B', 'browser host has no file binding');
        const reply = await binding.handle(request);
        await advance({ control: 'reply', value: await world.encodeResult(outcome.request, reply) });
        continue;
      } else if (request.semanticIdentity === PRESENT) {
        assert.equal(host, 'A', 'data host has no bound human audience');
        assert.deepEqual(input, { tag: 0, value: [BigInt(content.length), 4n] }); presented++; value = null;
      } else if (request.semanticIdentity === SIDE) {
        assert.equal(input, 77n); child++; value = null;
      } else if (request.semanticIdentity === CLEANUP) {
        assert.equal(input, 9001n); cleanup++; value = null;
      } else throw new Error(`Unsupported leaf remains parked: ${request.semanticIdentity}`);
      const reply = encodeValue(decodeSchema(request.resumeSchema), value);
      await advance({ control: 'reply', value: await world.encodeResult(outcome.request, reply) });
    }
    throw new Error('Consumer exceeded bounded test steps');
  }
  const roundtrip = await run(), refused = await run({ refuse: true }), cancelled = await run({ cancelAtMove: true });
  console.log(JSON.stringify({ check: 'mobility-continuation-scaffold', kernelSha256: identity.kernelSha256,
    imageBytes: image.length, nativeComparisons, roundtrip, refused, cancelled }));
} finally { await rm(area, { recursive: true, force: true }); }
