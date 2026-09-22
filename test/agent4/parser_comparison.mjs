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
import {decodedFields,bufferUntilEOF} from '../consumers/incremental-parser/candidates.mjs';
const [runtimePath,strategy='react',scenario='easy']=process.argv.slice(2);
assert(['react','recursive','complete'].includes(strategy));assert(['easy','repair','unresolved','stale'].includes(scenario));
const runtime=verifyRuntime(resolve(runtimePath)),world=await import(pathToFileURL(runtime.entrypoint));
const read=name=>readFile('zig-out/agent4/parser-construction/'+name);
const image=await read((strategy==='recursive'?'program':strategy)+'.bpi3');
const inputSchema=decodeSchema(await read('input-schema.bin')),resultSchema=decodeSchema(await read('result-schema.bin'));
const model=decodeValue(decodeSchema(await read('model-schema.bin')),await read('model-template.bin'));
const tools=await createParserTools();assert.equal(tools.kind,'qualified',JSON.stringify(tools));
const hash=v=>createHash('sha256').update(v).digest('hex');
const area=await mkdtemp(join(tmpdir(),'parser-comparison-'));
try{
 await writeFile(join(area,'parser.mjs'),tools.evidence.reference);
 const delivery=await createParserDelivery({root:area});
 // Same task/reference; the admitted tool set determines partial vs complete offers.
 model[3]=[model[3][0],[2,`Construct an incremental parser for this frozen batch reference and required behavior. Use the offered construction or experiment operations; explain inability honestly.\nFrozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}`]];
 const input=[tools.subject(hash(tools.evidence.reference)),model,[[[92],false],[[110,10],false],[[],true]],17n,3n,'parser.mjs',7n,true,false,{tag:0,value:null}];
 const kernelBytes=await readFile(runtime.kernelPath);let id=1n;
 const fresh=()=>world.Kernel.create({bytes:kernelBytes,expectedSha256:runtime.kernelSha256,instanceId:id++});
 let k=await fresh(),p=k.prepare(image),s=k.start(p,encodeValue(inputSchema,input));k.releasePrepared(p);
 let control='none',value=new Uint8Array(),models=0,checks=0,experiments=0,approvals=0,writes=0,reads=0,transfers=0,result,contextBytes=0,peakCheckpoint=0,peakWorkingLive=0n;
 const references=[],events=[];let accepted=false;
 for(let n=0;;n++){
  assert(n<512);const cp=k.checkpoint(s);peakCheckpoint=Math.max(peakCheckpoint,cp.length);const live=k.usage().workingLive;if(live>peakWorkingLive)peakWorkingLive=live;
  const out=world.decodeOutcome(k.drive(s,{control,value,quantum:97,checkpoint:true}));
  if(out.kind==='completed'){result=decodeValue(resultSchema,out.value);k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  if(out.kind==='requested'){
   const request=await world.decodeRequest(out.request),payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);events.push(request.semanticIdentity);let reply;
   if(request.semanticIdentity==='agent.parser.reference.v1'){references.push(payload[1]);reply=await tools.reference(payload);if(scenario==='stale')reply[0]++;}
   else if(request.semanticIdentity==='agent.model.invoke.v3'){
    models++;assert.equal(writes,0);contextBytes+=payload[3].reduce((sum,message)=>sum+Buffer.byteLength(message[1]),0);
    const offered=payload[4].map(tool=>tool[2]);const experiment=scenario==='repair'&&models===2;
    const fragment=!offered.includes('complete_candidate');
    const name=scenario==='unresolved'?'unresolved':experiment?'experiment':fragment?'fragment':'complete_candidate',ordinal=scenario==='unresolved'?4:experiment?2:fragment?0:1;
    assert(offered.includes(name));if(strategy!=='recursive')assert(!offered.includes('fragment'));
    const source=scenario==='repair'&&models===1?bufferUntilEOF:decodedFields;
    const args=scenario==='unresolved'?{reason:'No supported construction.'}:experiment?{input_hex:'610a',first_chunk_bytes:1,chunk_bytes:1,finalize:true,reason:'Check immediate emission.'}:{source,explanation:'Required acceptance decides correctness.'};
    reply={tag:0,value:[[{tag:0,value:['same-provider-id',name,new TextEncoder().encode(JSON.stringify(args)),ordinal,{tag:0,value:{tag:ordinal,value:Object.values(args)}}]}],Array(32).fill(0)]};
   }else if(['agent.parser.probe.v1','agent.parser.execution.v1'].includes(request.semanticIdentity)){
    checks++;if(payload[3].tag===2)experiments++;
    reply=await(request.semanticIdentity==='agent.parser.probe.v1'?tools.probe(payload):tools.execute(payload));
    if(request.semanticIdentity==='agent.parser.execution.v1')accepted=reply[2].tag===1&&reply[2].value[0];
   }else{
    assert(accepted,'no target authority before full acceptance');
    if(request.semanticIdentity==='agent.parser.target-read.v1'){reads++;reply=await delivery.read(payload);}
    else if(request.semanticIdentity==='agent.approval.issue.v1.parser.replace')reply=41n;
    else if(request.semanticIdentity==='agent.interaction.exchange.v1.parser.replace'){approvals++;reply={tag:0,value:[payload[3],7n,{tag:0,value:null}]};}
    else if(request.semanticIdentity==='agent.parser.replace.v1'){writes++;reply=await delivery.replace(payload);}
    else throw Error('unexpected leaf '+request.semanticIdentity);
   }
   control='reply';value=await world.encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply));
  }else{assert.equal(out.kind,'progressed');control='none';value=new Uint8Array();}
  assert.deepEqual(k.checkpoint(s,{transfer:true}),out.state);peakCheckpoint=Math.max(peakCheckpoint,out.state.length);k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);transfers++;
 }
 const stopped=['unresolved','stale'].includes(scenario);
 assert.deepEqual(references,[17n]);
 if(stopped){assert.equal(result.tag,3);assert.equal(approvals,0);assert.equal(writes,0);assert.equal(reads,0);assert.equal(checks,0);assert.equal(models,scenario==='stale'?0:1);assert.equal(await readFile(join(area,'parser.mjs'),'utf8'),tools.evidence.reference);}
 else{assert.equal(result.tag,4);assert.equal(approvals,1);assert.equal(writes,1);assert.equal(reads,1);assert.equal(await readFile(join(area,'parser.mjs'),'utf8'),decodedFields);assert.equal(models,scenario==='repair'?3:strategy==='recursive'?2:1);}
 assert.equal(experiments,scenario==='repair'?1:0);
 console.log(JSON.stringify({strategy,scenario,acceptedArtifacts:stopped?0:1,falseCompletionClaims:0,imageBytes:image.length,models,contextBytes,checks,experiments,approvals,writes,reads,referenceRequests:references.length,transfers,peakCheckpoint,peakWorkingLive:String(peakWorkingLive),metrics:tools.metrics(),events}));
}finally{await rm(area,{recursive:true,force:true});}
