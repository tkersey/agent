// Four complete unresolved executions reuse one resident kernel and prepared Program.
// Only the task occurrence changes; prior replies and provider IDs grant no reuse.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
const root=resolve(import.meta.dirname,'../..');
assert.equal(process.argv.length,3,'usage: node test/agent4/parser_repeated.mjs WORLD_RUNTIME');
const runtime=verifyRuntime(resolve(process.argv[2]));
const {Kernel,decodeOutcome,decodeRequest,encodeResult}=await import(pathToFileURL(runtime.entrypoint));
const read=async name=>new Uint8Array(await readFile(root+'/zig-out/agent4/parser-construction/'+name));
const image=await read('retained.bpi3'),inputSchema=decodeSchema(await read('input-schema.bin'));
const resultSchema=decodeSchema(await read('result-schema.bin'));
const model=decodeValue(decodeSchema(await read('model-schema.bin')),await read('model-template.bin'));
const tools=await createParserTools();assert.equal(tools.kind,'qualified');
const hash=x=>createHash('sha256').update(x).digest('hex');
const bytes=await readFile(runtime.kernelPath);
const k=await Kernel.create({bytes,expectedSha256:hash(bytes),instanceId:444n}),p=k.prepare(image);
const baseline=k.usage().workingLive,oldReplies=new Map(),rows=[];
for(let task=0;task<4;task++){
 const input=[tools.subject(hash(tools.evidence.reference)),model,[[[92],false],[[110,10],false],[[],true]],17n+100n*BigInt(task),2n,'parser.mjs',7n,false,false,{tag:0,value:null}];
 const s=k.start(p,encodeValue(inputSchema,input));let control='none',value=new Uint8Array(),maximumState=0,rejected=0;const events=[];
 for(let quantum=0;;quantum++){
  assert(quantum<128);const out=decodeOutcome(k.drive(s,{control,value,quantum:100,checkpoint:true}));
  if(out.kind==='completed'){assert.equal(decodeValue(resultSchema,out.value).tag,3);k.close(s);break;}
  assert(['progressed','requested'].includes(out.kind));maximumState=Math.max(maximumState,out.state.length);control='none';value=new Uint8Array();
  if(out.kind!=='requested')continue;
  const request=await decodeRequest(out.request),name=request.semanticIdentity,payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);events.push(name);
  const previous=oldReplies.get(name);
  if(previous&&['agent.model.invoke.v3','agent.parser.reference.v1'].includes(name)){
   assert.throws(()=>k.drive(s,{control:'reply',value:previous,quantum:100,checkpoint:true}),{code:'WORLD_KERNEL_REJECTED'});
   assert.deepEqual(k.checkpoint(s),out.state);rejected++;
  }
  let reply;
  if(name==='agent.parser.reference.v1')reply=await tools.reference(payload);
  else if(name==='agent.model.invoke.v3')reply={tag:0,value:[[{tag:0,value:['same-provider-id','unresolved',new TextEncoder().encode(JSON.stringify({reason:'No supported construction.'})),4,{tag:0,value:{tag:4,value:['No supported construction.']}}]}],Array(32).fill(0)]};
  else {assert(['parser/retained-release','parser/retained-work','parser/participant-release'].includes(name),name);reply=null;}
  value=await encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply));control='reply';oldReplies.set(name,value.slice());
 }
 assert.deepEqual(events,['agent.parser.reference.v1','agent.model.invoke.v3','parser/retained-release','parser/retained-work','parser/retained-release']);
 assert.equal(k.usage().workingLive,baseline);if(task)assert.equal(rejected,2);rows.push({task,maximumState,rejected,retained:String(k.usage().workingLive),events});
}
k.releasePrepared(p);assert.equal(k.usage().workingLive,0n);console.log(JSON.stringify({rows,baseline:String(baseline),finalWorkingLive:'0'}));
