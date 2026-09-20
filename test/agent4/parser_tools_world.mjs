// Semantic reply binding is enforced in the compiled Program, after World framing.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {decodeSchema,encodeValue,decodeValue} from '../../runtime/values.mjs';
import {decodedFields} from '../consumers/incremental-parser/candidates.mjs';
const [worldEntry,kernelPath]=process.argv.slice(2);
const {Kernel,decodeOutcome,decodeRequest,encodeResult}=await import(pathToFileURL(resolve(worldEntry)));
const bytes=new Uint8Array(await readFile(kernelPath));
const expectedSha256=createHash('sha256').update(bytes).digest('hex');
const image=new Uint8Array(await readFile('zig-out/agent4/parser/program.bpi3'));
const requestSchema=decodeSchema(await readFile('zig-out/agent4/parser/execution-request.bin'));
const replySchema=decodeSchema(await readFile('zig-out/agent4/parser/execution-reply.bin'));
const tools=await createParserTools();assert.equal(tools.kind,'qualified',JSON.stringify(tools));
const subject=tools.subject('a'.repeat(64)), trace=[[[92],false],[[110,10],true]];
const input=[subject,1n,[decodedFields,1n,0],{tag:0,value:trace}];
let identity=1n;
const fresh=()=>Kernel.create({bytes,expectedSha256,instanceId:identity++});
async function park(input) {
  const k=await fresh(),p=k.prepare(image),s=k.start(p,encodeValue(requestSchema,input));k.releasePrepared(p);
  const out=decodeOutcome(k.drive(s,{checkpoint:true}));assert.equal(out.kind,'requested');
  const request=await decodeRequest(out.request);assert.equal(request.semanticIdentity,'agent.parser.execution.v1');
  assert.deepEqual(decodeValue(requestSchema,request.payload),input);
  const state=k.checkpoint(s,{transfer:true});assert.equal(k.usage().workingLive,0n);
  return {state,request:out.request};
}
const pending=await park(input);
const actual=await tools.execute(input);
const assessment={tag:1,value:[true,536,536,true,'']};
const variants=[['valid',actual,'completed'],
  ['wrong-occurrence',[2n,1n,actual[2]],'failed'],
  ['wrong-version',[1n,2n,actual[2]],'failed'],
  ['wrong-operation',[1n,1n,assessment],'failed'],
  ['unavailable',[1n,1n,{tag:2,value:0}],'completed'],
  ['stale-unavailable',[1n,2n,{tag:2,value:0n}],'failed']];
const results=[];
async function check(name,pending,value,expected) {
  const k=await fresh(),p=k.prepare(image),s=k.restore(p,pending.state);k.releasePrepared(p);
  const out=decodeOutcome(k.drive(s,{control:'reply',value:await encodeResult(pending.request,encodeValue(replySchema,value)),checkpoint:true}));
  assert.equal(out.kind,expected,name);
  if(expected==='completed')assert.deepEqual(decodeValue(replySchema,out.value),value);
  else assert.deepEqual(out.value,new Uint8Array());
  k.close(s);assert.equal(k.usage().workingLive,0n);results.push({name,result:out.kind});
}
for(const [name,value,expected] of variants)await check(name,pending,value,expected);
const partial=await park([subject,2n,input[2],{tag:1,value:null}]);
await check('partial-is-not-validated',partial,[2n,1n,assessment],'failed');
console.log(JSON.stringify({imageBytes:image.length,results,realProbe:tools.metrics()}));
