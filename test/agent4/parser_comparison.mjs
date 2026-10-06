// Retained source-free consumer witness; no strategy or full-acceptance campaign.
import { artifactRoot } from './artifacts.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../../runtime/values.mjs';
import { createParserTools } from '../../runtime/parser_tools.mjs';
import { decodedFields } from '../consumers/incremental-parser/candidates.mjs';
const [runtimePath, strategy, scenario, nativeTool, deniedRoot, nativeMode] = process.argv.slice(2);
assert(['recursive', 'alternate'].includes(strategy));
assert.equal(scenario, 'consumer-partial'); assert.equal(nativeMode, 'file'); assert(nativeTool && deniedRoot);
const runtime = verifyRuntime(resolve(runtimePath)), world = await import(pathToFileURL(runtime.entrypoint));
const read = name => readFile(join(artifactRoot, 'agent4/parser-construction', name));
const image = await read((strategy === 'recursive' ? 'consumer-fixed' : 'consumer-alt-fixed') + '.bpi3');
const inputSchema = decodeSchema(await read('input-schema.bin')), resultSchema = decodeSchema(await read('result-schema.bin'));
const model = decodeValue(decodeSchema(await read('model-schema.bin')), await read('model-template.bin'));
const tools = await createParserTools(); assert.equal(tools.kind, 'qualified', JSON.stringify(tools));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile('conformance/agent4/parser-producer-v2.bmo1')), '672efdd6d55b36cd46711c0fb73461bbc1e7e425482f35f887d1f9bcb39811dc');
assert.notDeepEqual(await read('consumer.bmo1'), await read('consumer-alt.bmo1'));
model[3] = [model[3][0], [2, `Construct an incremental parser for this frozen batch reference and required behavior. Use the offered construction or experiment operations; explain inability honestly.\nFrozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}`]];
const input = [tools.subject(hash(tools.evidence.reference)), model, [[[92], false], [[110, 10], false], [[], true]], 17n, 1n, 'parser.mjs', 7n, true, false, { tag: 0, value: null }];
const initialArgs = encodeValue(inputSchema, input);
const profile = `(version 1) (allow default) (deny file-read* (subpath ${JSON.stringify(deniedRoot)})) (deny process-exec (subpath ${JSON.stringify(deniedRoot)}))`;
const area = await mkdtemp(join(tmpdir(), 'parser-consumer-'));
let state, control = 'none', value = new Uint8Array(), models = 0, checks = 0, result;
const references = [], probes = [];
try {
  for (let n = 0; ; n++) {
    assert(n < 512);
    const command = world.encodeInput({ image, ...(state === undefined ? { initialArgs } : { state }), control, value, quantum: 97 });
    const file = join(area, 'invocation.pki3'); await writeFile(file, command);
    const bytes = execFileSync('/usr/bin/sandbox-exec', ['-p', profile, nativeTool, file], { input: command, maxBuffer: 16 << 20 });
    const out = world.decodeOutcome(bytes);
    if (out.kind === 'completed') { result = decodeValue(resultSchema, out.value); break; }
    if (out.kind === 'requested') {
      const request = await world.decodeRequest(out.request), payload = decodeValue(decodeSchema(request.payloadSchema), request.payload);
      let reply;
      if (request.semanticIdentity === 'agent.parser.reference.v1') { references.push(payload[1]); reply = await tools.reference(payload); }
      else if (request.semanticIdentity === 'agent.model.invoke.v3') {
        assert.equal(++models, 1);
        const name = payload[4].some(tool => tool[2] === 'complete_candidate') ? 'complete_candidate' : 'fragment', ordinal = name === 'fragment' ? 0 : 1;
        const args = { source: decodedFields.replace('records.push(s.fields);', 'if(s.fields.some(field=>field.includes(10)))records.push(s.fields);'), explanation: 'Required acceptance decides correctness.' };
        reply = { tag: 0, value: [[{ tag: 0, value: ['same-provider-id', name, new TextEncoder().encode(JSON.stringify(args)), ordinal, { tag: 0, value: { tag: ordinal, value: Object.values(args) } }] }], Array(32).fill(0)] };
      } else if (request.semanticIdentity === 'agent.parser.probe.v2') {
        checks++; probes.push(payload[1].toString());
        const extra = strategy === 'alternate' && probes.length === 1;
        assert.equal(payload[1], extra ? 20n : 18n); assert.deepEqual(payload[3].value, extra ? [[[97], false], [[10], false]] : input[2]);
        reply = await tools.probe(payload);
      } else assert.fail('partial construction must not acquire acceptance or delivery authority: ' + request.semanticIdentity);
      control = 'reply'; value = await world.encodeResult(out.request, encodeValue(decodeSchema(request.resumeSchema), reply));
    } else { assert.equal(out.kind, 'progressed'); control = 'none'; value = new Uint8Array(); }
    state = out.state;
  }
  assert.deepEqual(references, [17n]); assert.equal(result.tag, 2); assert.equal(models, 1);
  assert.equal(checks, strategy === 'alternate' ? 2 : 1); assert.equal(result.value[1][2].value[1], true);
  assert.equal(result.value[3].tag, strategy === 'alternate' ? 1 : 0);
  if (strategy === 'alternate') { const cf = result.value[3].value; assert.equal(cf[0][0], 20n); assert.equal(cf[0][2].value[1], false); assert.equal(cf[1].value[0], '610a'); }
  assert.deepEqual(probes, strategy === 'alternate' ? ['20', '18'] : ['18']);
  console.log(JSON.stringify({ strategy, models, checks, sourceDenied: true, probes }));
} finally { await rm(area, { recursive: true, force: true }); }
