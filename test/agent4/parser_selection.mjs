// Real candidate tools; World retains all selection and reciprocal control.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {createParserDelivery} from '../../runtime/parser_delivery.mjs';
import {decodedFields,rawRecords,bufferUntilEOF} from '../consumers/incremental-parser/candidates.mjs';
const [runtimePath,policy='first']=process.argv.slice(2);assert(['first','last','unavailable'].includes(policy));
const runtime=verifyRuntime(resolve(runtimePath)),world=await import(pathToFileURL(runtime.entrypoint));
const read=name=>readFile('zig-out/agent4/parser-construction/'+name);
const image=await read('select-'+(policy==='unavailable'?'first':policy)+'.bpi3');
const inputSchema=decodeSchema(await read('input-schema.bin')),resultSchema=decodeSchema(await read('result-schema.bin'));
const model=decodeValue(decodeSchema(await read('model-schema.bin')),await read('model-template.bin'));
const tools=await createParserTools();assert.equal(tools.kind,'qualified',JSON.stringify(tools));
const hash=v=>createHash('sha256').update(v).digest('hex');
const area=await mkdtemp(join(tmpdir(),'parser-selection-'));
try{
 await writeFile(join(area,'parser.mjs'),tools.evidence.reference);
 const delivery=await createParserDelivery({root:area});
 model[3].push([2,`Frozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}`]);
 const input=[tools.subject(hash(tools.evidence.reference)),model,[[[92],false],[[110,10],false],[[],true]],17n,2n,'parser.mjs',7n,true,false,{tag:0,value:null}];
 const kernelBytes=await readFile(runtime.kernelPath);let id=1n;
 const fresh=()=>world.Kernel.create({bytes:kernelBytes,expectedSha256:runtime.kernelSha256,instanceId:id++});
 let k=await fresh(),p=k.prepare(image),s=k.start(p,encodeValue(inputSchema,input));k.releasePrepared(p);
 let control='none',value=new Uint8Array(),models=0,checks=0,approvals=0,writes=0,reads=0,transfers=0,result;
 const references=[],acceptances=[],events=[];
 for(let n=0;;n++){
  assert(n<256);const out=world.decodeOutcome(k.drive(s,{control,value,quantum:97,checkpoint:true}));
  if(out.kind==='completed'){result=decodeValue(resultSchema,out.value);k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  if(out.kind==='requested'){
   const request=await world.decodeRequest(out.request),payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);events.push(request.semanticIdentity);let reply;
   if(request.semanticIdentity==='agent.parser.reference.v1'){references.push(payload[1]);assert.equal(writes,0);reply=await tools.reference(payload);}
   else if(request.semanticIdentity==='agent.model.invoke.v3'){
    models++;assert.equal(writes,0);assert.equal(reads,0);
    const fragment=models%2===1,name=fragment?'fragment':'complete_candidate',ordinal=fragment?0:1;
    if(models===2)assert(payload[3].some(message=>message[1].includes('consumer probe failed')));
    if(models===4)assert(payload[3].some(message=>message[1].includes('consumer probe passed')));
    const source=models===1?bufferUntilEOF:models===2?decodedFields:rawRecords;
    const explanation=fragment?'Construct the boundary transition.':'Revise to emit each complete record immediately.';
    reply={tag:0,value:[[{tag:0,value:['reused-provider-id',name,new TextEncoder().encode(JSON.stringify({source,explanation})),ordinal,{tag:0,value:{tag:ordinal,value:[source,explanation]}}]}],Array(32).fill(0)]};
   }else if(['agent.parser.probe.v1','agent.parser.execution.v1'].includes(request.semanticIdentity)){
    assert.equal(writes,0);assert.equal(reads,0);checks++;
    reply=await(request.semanticIdentity==='agent.parser.probe.v1'?tools.probe(payload):tools.execute(payload));
    if(request.semanticIdentity==='agent.parser.execution.v1'){
     assert.equal(reply[2].tag,1);assert.equal(reply[2].value[0],true);acceptances.push(payload[1]);
     // An unavailable bound reply is a protocol test, not fabricated acceptance.
     if(policy==='unavailable'&&models===4)reply=[payload[1],payload[2][1],{tag:2,value:0}];
    }
   }else{
    assert.equal(models,4);assert.deepEqual(acceptances,[19n,22n]);
    if(request.semanticIdentity==='agent.parser.target-read.v1'){reads++;reply=await delivery.read(payload);}
    else if(request.semanticIdentity==='agent.approval.issue.v1.parser.replace'){reply=41n;}
    else if(request.semanticIdentity==='agent.interaction.exchange.v1.parser.replace'){approvals++;reply={tag:0,value:[payload[3],7n,{tag:0,value:null}]};}
    else if(request.semanticIdentity==='agent.parser.replace.v1'){writes++;reply=await delivery.replace(payload);}
    else throw Error('unexpected leaf '+request.semanticIdentity);
   }
   control='reply';value=await world.encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply));
  }else{assert.equal(out.kind,'progressed');control='none';value=new Uint8Array();}
  assert.deepEqual(k.checkpoint(s,{transfer:true}),out.state);k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);transfers++;
 }
 assert.deepEqual(references,[17n,20n]);assert.equal(models,4);assert.equal(checks,4);
 if(policy==='unavailable'){assert.equal(result.tag,3);assert.equal(writes,0);assert.equal(reads,0);assert.equal(await readFile(join(area,'parser.mjs'),'utf8'),tools.evidence.reference);}
 else{assert.equal(result.tag,4);assert.equal(approvals,1);assert.equal(writes,1);assert.equal(reads,1);assert.equal(await readFile(join(area,'parser.mjs'),'utf8'),policy==='first'?decodedFields:rawRecords);}
 console.log(JSON.stringify({policy,imageBytes:image.length,models,checks,approvals,writes,reads,transfers,references:references.map(String),acceptances:acceptances.map(String),metrics:tools.metrics(),events}));
}finally{await rm(area,{recursive:true,force:true});}
