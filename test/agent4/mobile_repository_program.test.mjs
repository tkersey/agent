// Exercise the emitted application with synthetic, bounded leaf observations.
// This checks authored control, not provider quality, Git or OS isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifactRoot } from './artifacts.mjs';
import { verifyRuntime, readDependencyLock } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { decodeReplayModelInvocation, performReplayModelInvocation } from '../../runtime/model.mjs';
import { placement, resolution } from './mobility_fixture.mjs';

const identity = verifyRuntime(resolve(process.env.AGENT_MOBILITY_RUNTIME));
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = await readFile(identity.kernelPath), directory = join(artifactRoot, 'agent4/mobile-repository');
const image = await readFile(join(directory, 'program.bpi3'));
const taskSchema = decodeSchema(await readFile(join(directory, 'task.schema')));
const reportSchema = decodeSchema(await readFile(join(directory, 'report.schema')));

for (const [mode, checkStatus, statusTag] of [[1, 'Unavailable', 2], [1, 'Failed', 1], [2, 'Unavailable', 2]])
  test(`${mode === 1 ? 'propose' : 'publish'} with ${checkStatus} preserves the authored completion rule`, async () => {
    const kernel = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
    const limit = readDependencyLock().world.runtime.physicalProfile.maximumMemoryBytes;
    kernel.setLimits({ input: limit, working: limit, output: limit });
    const prepared = kernel.prepare(image), task = [731n, 1n, mode, 'Repair the admitted file.', 'repo', 'a'.repeat(40), 'file.zig',
      placement('A', 4, 'workspace'), placement('A', 4, 'human'), ['fixture-model',
        [{ tag: 1, value: 512 }, { tag: 0, value: null }, { tag: 0, value: null }]], 4, 1, 71n];
    const session = kernel.start(prepared, encodeValue(taskSchema, task));
    const snapshot = ['repo', '1', 0, task[5], 'b'.repeat(40), Array(32).fill(1), Array(32).fill(2), ['shared'], 'A'];
    const evidence = [snapshot[5], 'file.zig', Array(32).fill(3), 'const value = 1;', false];
    const candidate = JSON.stringify({ id: 'exact-candidate' }), validation = JSON.stringify({ status: checkStatus });
    const proposal = JSON.stringify({ candidate, validation, validationDisposition: 'unvalidated' });
    let turns = 0, cleanups = 0, proposals = 0, bytes = kernel.drive(session, { checkpoint: true });
    const originalFetch = globalThis.fetch;
    try {
      for (let step = 0; step < 48; step++) {
        const out = world.decodeOutcome(bytes);
        if (['completed', 'failed'].includes(out.kind)) {
          assert.equal(out.kind, mode === 1 ? 'completed' : 'failed');
          assert.equal(turns, 3); assert.equal(proposals, mode === 1 ? 1 : 0);
          if (mode === 1) {
            assert.equal(cleanups, 1);
            const report = decodeValue(reportSchema, out.value);
            assert.equal(report[5], proposal); assert.equal(report[6].tag, 0);
            assert.equal(report[4][0][1][3], candidate); assert.equal(report[4][0][1][4], validation);
          }
          return;
        }
        if (['progressed', 'yielded'].includes(out.kind)) {
          bytes = kernel.drive(session, { control: out.kind === 'yielded' ? 'resume_yield' : 'none', checkpoint: true }); continue;
        }
        assert.equal(out.kind, 'requested');
        const request = await world.decodeRequest(out.request), payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
        let reply, encoded;
        switch (request.semanticIdentity) {
          case 'agent.mobility.resolve.v1': reply = resolution(payload, 'A', identity.kernelSha256); break;
          case 'agent.repository.snapshot.v1': reply = snapshot; break;
          case 'agent.repository.read.v1': reply = evidence; break;
          case 'agent.model.invoke.v4': {
            const invocation = decodeReplayModelInvocation(request.payload), turn = turns++;
            assert(turn < 3);
            if (turn > 0) assert.equal(invocation.invocation.tools.some(tool => tool.name === 'finish'), turn === 2 && mode === 1);
            const [name, args] = turn === 0 ? ['edit', { operation: 'replace', path: 'file.zig', old_digest: '03'.repeat(32), content: 'const value = 2;' }]
              : turn === 1 ? ['check', {}] : ['finish', { summary: `Unvalidated candidate: ${checkStatus}.` }];
            globalThis.fetch = async () => new Response(JSON.stringify({ status: 'completed', error: null,
              output: [{ type: 'function_call', status: 'completed', call_id: `call-${turn}`, name, arguments: JSON.stringify(args) }] }));
            encoded = await performReplayModelInvocation(request.payload, { endpoint: 'http://127.0.0.1:1/v1/responses' }); break;
          }
          case 'agent.repository.prepare.v1': assert.equal(payload[1].length, 1); reply = candidate; break;
          case 'agent.repository.check.v1': assert.equal(payload, candidate); reply = [statusTag, validation]; break;
          case 'agent.repository.proposal.v1': assert.deepEqual(payload, [candidate, validation, 731n, 1n]); proposals++; reply = proposal; break;
          case 'agent.repository.review.v1': assert.equal(payload[4], proposal); reply = { tag: 0, value: null }; break;
          case 'agent.repository.investigation-release.v1': cleanups++; reply = null; break;
          default: assert.fail(`Unexpected operation: ${request.semanticIdentity}`);
        }
        bytes = kernel.drive(session, { control: 'reply', checkpoint: true,
          value: await world.encodeResult(out.request, encoded ?? encodeValue(decodeSchema(request.resumeSchema), reply)) });
      }
      assert.fail('Application did not finish within the declared steps');
    } finally {
      globalThis.fetch = originalFetch;
      kernel.close(session); kernel.releasePrepared(prepared);
      assert.equal(kernel.usage().workingLive, 0n);
    }
  });
