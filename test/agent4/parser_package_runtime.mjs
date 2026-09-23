import {createParserKernel} from '../../runtime/parser_kernel.mjs';
// This optional archive test imports only files installed beside itself.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
const [runtimePath,...extra]=process.argv.slice(2);assert(runtimePath&&!extra.length);
const runtime=verifyRuntime(resolve(runtimePath));
const {Kernel,decodeOutcome,decodeRequest,encodeResult}=await import(pathToFileURL(runtime.entrypoint));
const folder=new URL('../../examples/parser-construction/',import.meta.url);
const image=new Uint8Array(await readFile(new URL('program.bpi3',folder)));
const inputSchema=decodeSchema(await readFile(new URL('input-schema.bin',folder)));
const resultSchema=decodeSchema(await readFile(new URL('result-schema.bin',folder)));
const initial=decodeValue(inputSchema,await readFile(new URL('task.args',folder)));
const bytes=new Uint8Array(await readFile(runtime.kernelPath));
let identity=1n;
async function execute(input,leaf,program=image){
 const fresh=()=>createParserKernel(Kernel, {bytes,expectedSha256:runtime.kernelSha256,instanceId:identity++});
 let kernel=await fresh(),p=kernel.prepare(program),session=kernel.start(p,encodeValue(inputSchema,input));kernel.releasePrepared(p);
 let control='none',value=new Uint8Array(),transfers=0;const events=[];
 for(let round=0;round<128;round++){
  const out=decodeOutcome(kernel.drive(session,{control,value,quantum:97,checkpoint:true}));
  if(out.kind==='completed'){
   const result=decodeValue(resultSchema,out.value);kernel.close(session);assert.equal(kernel.usage().workingLive,0n);
   return{result,events,transfers};
  }
  if(out.kind==='requested'){
   const request=await decodeRequest(out.request);events.push(request.semanticIdentity);
   const reply=await leaf(request.semanticIdentity,decodeValue(decodeSchema(request.payloadSchema),request.payload));
   control='reply';value=await encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply));
  }else{assert.equal(out.kind,'progressed');control='none';value=new Uint8Array();}
  assert.deepEqual(kernel.checkpoint(session,{transfer:true}),out.state);assert.equal(kernel.usage().workingLive,0n);
  kernel=await fresh();p=kernel.prepare(program);session=kernel.restore(p,out.state);kernel.releasePrepared(p);transfers++;
 }
 throw Error('fixture work allowance exhausted');
}
const zero=await execute(initial,()=>{throw Error('unconfigured example must not execute a leaf');});
assert.equal(zero.result.tag,3);assert.match(zero.result.value,/allowance exhausted/i);assert.deepEqual(zero.events,[]);
for(const policy of ['first','last']){
 const program=new Uint8Array(await readFile(new URL(`select-${policy}.bpi3`,folder)));
 const stopped=await execute(initial,()=>{throw Error('unconfigured selection must not execute a leaf');},program);
 assert.equal(stopped.result.tag,3);assert.deepEqual(stopped.events,[]);
}
const alternate=await execute(initial,()=>{throw Error('unconfigured alternate consumer must not execute a leaf');},new Uint8Array(await readFile(new URL('alternate.bpi3',folder))));
assert.equal(alternate.result.tag,3);assert.deepEqual(alternate.events,[]);
const tools=await createParserTools();assert.equal(tools.kind,'qualified',JSON.stringify(tools));
const input=structuredClone(initial);input[0]=tools.subject(createHash('sha256').update(tools.evidence.reference).digest('hex'));
input[2]=[[[92],false],[[110,10],false],[[],true]];input[3]=17n;input[4]=2n;input[8]=true;
const abandoned=await execute(input,async(identity,payload)=>{
 if(identity==='agent.parser.reference.v1')return tools.reference(payload);
 assert.equal(identity,'parser/participant-release');assert.equal(payload,90n);return null;
});
assert.equal(abandoned.result.tag,3);assert.match(abandoned.result.value,/locally abandoned/);
assert.deepEqual(abandoned.events,['agent.parser.reference.v1','parser/participant-release']);
assert.equal(tools.metrics().physicalExecutions,0);
console.log(JSON.stringify({check:'packaged parser without authoring sources',imageBytes:image.length,zero,abandoned,metrics:tools.metrics(),paidCalls:0}));
