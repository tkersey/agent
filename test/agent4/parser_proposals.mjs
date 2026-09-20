// Synthetic provider data passes through the actual compiled model interpreter.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decodeSchema,decodeValue} from '../../runtime/values.mjs';
import {experimentTrace,createParserTools} from '../../runtime/parser_tools.mjs';
import {decodedFields} from '../consumers/incremental-parser/candidates.mjs';
const [worldEntry,kernelPath]=process.argv.slice(2);
const {Kernel,decodeOutcome,decodeRequest,encodeResult}=await import(pathToFileURL(resolve(worldEntry)));
const bytes=new Uint8Array(await readFile(kernelPath));
const expectedSha256=createHash('sha256').update(bytes).digest('hex');
const read=async name=>new Uint8Array(await readFile(`zig-out/agent4/parser-proposals/${name}.bin`));
const image=await read('program'),input=await read('input'),schema=decodeSchema(await read('result-schema'));
let identity=1n;
const fresh=()=>Kernel.create({bytes,expectedSha256,instanceId:identity++});
const k=await fresh(),p=k.prepare(image),s=k.start(p,input);k.releasePrepared(p);
const first=decodeOutcome(k.drive(s,{checkpoint:true}));assert.equal(first.kind,'requested');
assert.equal((await decodeRequest(first.request)).semanticIdentity,'agent.model.invoke.v3');
const state=k.checkpoint(s,{transfer:true});assert.equal(k.usage().workingLive,0n);
const results=[];
for(const [name,tag] of [['fragment',0],['experiment',2],['constraint',3],['unresolved',4],['unknown',null],['unoffered',null]]) {
  const peer=await fresh(),prepared=peer.prepare(image),session=peer.restore(prepared,state);peer.releasePrepared(prepared);
  const outcome=decodeOutcome(peer.drive(session,{control:'reply',value:await encodeResult(first.request,await read(name)),checkpoint:true}));
  assert.equal(outcome.kind,'completed');
  const interpreted=decodeValue(schema,outcome.value);
  assert.equal(interpreted.tag,tag===null?1:0,name);
  if(tag!==null)assert.equal(interpreted.value.tag,tag,name);
  if(name==='fragment')assert.match(interpreted.value.value[0],/escapedByte/);
  if(name==='experiment') {
    assert.deepEqual(experimentTrace(interpreted.value.value),[[[92],false],[[110,10],true]]);
    const tools=await createParserTools();assert.equal(tools.kind,'qualified');
    const probe=await tools.execute([tools.subject('a'.repeat(64)),1n,[decodedFields,1n,0],
      {tag:2,value:interpreted.value.value}]);
    assert.equal(probe[2].tag,0);assert.equal(probe[2].value[1],true);
  }
  peer.close(session);assert.equal(peer.usage().workingLive,0n);
  results.push({name,accepted:interpreted.tag===0});
}
for(const value of [['0g',1,1,true,''],['00',0,0,true,''],['00'.repeat(65),0,1,true,'']])
  assert.throws(()=>experimentTrace(value));
console.log(JSON.stringify({imageBytes:image.length,results,paidProviderCalls:0,syntheticProvider:true,freshTransfers:6}));
