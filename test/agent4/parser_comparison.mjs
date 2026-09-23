import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {createParserDelivery} from '../../runtime/parser_delivery.mjs';
import {decodedFields,bufferUntilEOF} from '../consumers/incremental-parser/candidates.mjs';
const [runtimePath,strategy='react',scenario='easy',nativeTool,deniedRoot,nativeMode='invoke',peerPath,browserTools]=process.argv.slice(2);
assert(['react','recursive','complete','alternate'].includes(strategy));assert(['easy','repair','unresolved','stale','consumer','consumer-partial','consumer-unavailable'].includes(scenario));
if(scenario.startsWith('consumer'))assert(['recursive','alternate'].includes(strategy));else assert(strategy!=='alternate');
if(scenario==='consumer-unavailable')assert.equal(strategy,'alternate');
assert(!deniedRoot||nativeTool);assert(['invoke','file'].includes(nativeMode));
const runtime=verifyRuntime(resolve(runtimePath)),world=await import(pathToFileURL(runtime.entrypoint));
const read=name=>readFile('zig-out/agent4/parser-construction/'+name);
const image=await read((strategy==='recursive'?'program':strategy)+'.bpi3');
const inputSchema=decodeSchema(await read('input-schema.bin')),resultSchema=decodeSchema(await read('result-schema.bin'));
const model=decodeValue(decodeSchema(await read('model-schema.bin')),await read('model-template.bin'));
const tools=await createParserTools();assert.equal(tools.kind,'qualified',JSON.stringify(tools));
const hash=v=>createHash('sha256').update(v).digest('hex');
if(scenario.startsWith('consumer')){
 assert.equal(hash(await read('producer.bmo1')),'fcf0b53d44983c0aabe5e69eec502295d2b2e66b6eb3cdcd57281be8cf456502');
 assert.notDeepEqual(await read('consumer.bmo1'),await read('consumer-alt.bmo1'));
}
assert(!peerPath||nativeTool&&!deniedRoot);assert(!browserTools||peerPath);
let peer,browser;const engines=[];
const area=await mkdtemp(join(tmpdir(),'parser-comparison-'));
try{
 if(peerPath)peer=await(await import(pathToFileURL(resolve(peerPath)))).wasmtimePeer(runtime.kernelPath,runtime.kernelSha256);
 if(browserTools)browser=await(await import('./recursive_browser.mjs')).browserPeer({worldEntry:runtime.entrypoint,kernelPath:runtime.kernelPath,tools:browserTools,engine:'chromium',sha256:runtime.kernelSha256});
 await writeFile(join(area,'parser.mjs'),tools.evidence.reference);
 const delivery=await createParserDelivery({root:area});
 // Same task/reference; the admitted tool set determines partial vs complete offers.
 model[3]=[model[3][0],[2,`Construct an incremental parser for this frozen batch reference and required behavior. Use the offered construction or experiment operations; explain inability honestly.\nFrozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}`]];
 const input=[tools.subject(hash(tools.evidence.reference)),model,[[[92],false],[[110,10],false],[[],true]],17n,scenario==='consumer-partial'?1n:3n,'parser.mjs',7n,true,false,{tag:0,value:null}];
 const kernelBytes=await readFile(runtime.kernelPath);let id=1n;
 const fresh=()=>world.Kernel.create({bytes:kernelBytes,expectedSha256:runtime.kernelSha256,instanceId:id++});
 const initialArgs=encodeValue(inputSchema,input);let k,p,s,nativeState;
 if(!nativeTool||peer){k=await fresh();p=k.prepare(image);s=k.start(p,initialArgs);k.releasePrepared(p);}
 const profile=deniedRoot?`(version 1) (allow default) (deny file-read* (subpath ${JSON.stringify(deniedRoot)})) (deny process-exec (subpath ${JSON.stringify(deniedRoot)}))`:null;
 let control='none',value=new Uint8Array(),models=0,checks=0,experiments=0,approvals=0,writes=0,reads=0,transfers=0,result,contextBytes=0,peakCheckpoint=0,peakWorkingLive=0n;
 const references=[],events=[],probes=[];let accepted=false;
 for(let n=0;;n++){
  assert(n<512);const cp=nativeTool?(nativeState??new Uint8Array()):k.checkpoint(s);peakCheckpoint=Math.max(peakCheckpoint,cp.length);if(k){const live=k.usage().workingLive;if(live>peakWorkingLive)peakWorkingLive=live;}
  let bytes,engine=nativeTool?'native':'Node';
  if(peer)nativeState=k.checkpoint(s);
  if(nativeTool){const command=world.encodeInput({image,...(nativeState===undefined?{initialArgs}:{state:nativeState}),control,value,quantum:97});const file=join(area,'invocation.pki3');if(nativeMode==='file')await writeFile(file,command);const args=nativeMode==='file'?[file]:['invoke'];bytes=new Uint8Array(execFileSync(profile?'/usr/bin/sandbox-exec':nativeTool,profile?['-p',profile,nativeTool,...args]:args,{input:command,maxBuffer:16<<20}));}
  else bytes=k.drive(s,{control,value,quantum:97,checkpoint:true});
  if(peer){const invocation={image,state:nativeState,control,value,quantum:97};const node=k.drive(s,{control,value,quantum:97,checkpoint:true}),independent=(await peer.call('invoke',{bytes:world.encodeInput(invocation)})).bytes;assert.deepEqual(node,bytes);assert.deepEqual(independent,bytes);const choices=[[bytes,'native'],[node,'Node'],[independent,'Wasmtime']];if(browser){const actual=await browser.invoke(invocation);assert.deepEqual(actual,bytes);choices.unshift([actual,'Chromium Worker']);}[bytes,engine]=choices[n%choices.length];}
  engines.push(engine);
  const out=world.decodeOutcome(bytes);
  if(out.kind==='completed'){result=decodeValue(resultSchema,out.value);if(k){k.close(s);assert.equal(k.usage().workingLive,0n);}break;}
  if(out.kind==='requested'){
   const request=await world.decodeRequest(out.request),payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);events.push(request.semanticIdentity);let reply;
   if(request.semanticIdentity==='agent.parser.reference.v1'){references.push(payload[1]);reply=await tools.reference(payload);if(scenario==='stale')reply[0]++;}
   else if(request.semanticIdentity==='agent.model.invoke.v3'){
    models++;assert.equal(writes,0);contextBytes+=payload[3].reduce((sum,message)=>sum+Buffer.byteLength(message[1]),0);
    const offered=payload[4].map(tool=>tool[2]);const experiment=scenario==='repair'&&models===2;
    const fragment=!offered.includes('complete_candidate');
    const name=scenario==='unresolved'?'unresolved':experiment?'experiment':fragment?'fragment':'complete_candidate',ordinal=scenario==='unresolved'?4:experiment?2:fragment?0:1;
    assert(offered.includes(name));if(!['recursive','alternate'].includes(strategy))assert(!offered.includes('fragment'));
    if(scenario.startsWith('consumer')&&models===2){const context=payload[3].map(message=>message[1]).join('\n');if(strategy==='alternate'){assert.match(context,/earlier FAILED experiment/);assert.match(context,/Hex bytes: 610a/);}else assert(!context.includes('earlier required check FAILED'));}

    const source=scenario.startsWith('consumer')&&models===1?decodedFields.replace('records.push(s.fields);','if(s.fields.some(field=>field.includes(10)))records.push(s.fields);'):scenario==='repair'&&models===1?bufferUntilEOF:decodedFields;
    const args=scenario==='unresolved'?{reason:'No supported construction.'}:experiment?{input_hex:'610a',first_chunk_bytes:1,chunk_bytes:1,finalize:true,reason:'Check immediate emission.'}:{source,explanation:'Required acceptance decides correctness.'};
    reply={tag:0,value:[[{tag:0,value:['same-provider-id',name,new TextEncoder().encode(JSON.stringify(args)),ordinal,{tag:0,value:{tag:ordinal,value:Object.values(args)}}]}],Array(32).fill(0)]};
   }else if(['agent.parser.probe.v2','agent.parser.execution.v2'].includes(request.semanticIdentity)){
    checks++;if(payload[3].tag===2)experiments++;
    if(scenario.startsWith('consumer')&&request.semanticIdentity==='agent.parser.probe.v2'){probes.push(payload[1].toString());const extra=strategy==='alternate'&&probes.length===1;assert.equal(payload[1],extra?17n+input[4]+2n:18n);assert.deepEqual(payload[3].value,extra?[[[97],false],[[10],false]]:input[2]);}

    reply=await(request.semanticIdentity==='agent.parser.probe.v2'?tools.probe(payload):tools.execute(payload));
    if(scenario==='consumer-unavailable'&&checks===1)reply=[payload[1],payload[2][1],{tag:2,value:0}];
    if(request.semanticIdentity==='agent.parser.execution.v2')accepted=reply[2].tag===1&&reply[2].value[0];
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
  peakCheckpoint=Math.max(peakCheckpoint,out.state.length);
  if(nativeTool&&!peer)nativeState=out.state;else{assert.deepEqual(k.checkpoint(s,{transfer:true}),out.state);k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);}transfers++;
 }
 const partial=scenario==='consumer-partial';
 const stopped=['unresolved','stale','consumer-unavailable'].includes(scenario);
 assert.deepEqual(references,[17n]);
 if(partial){assert.equal(result.tag,2);assert.equal(approvals,0);assert.equal(writes,0);assert.equal(reads,0);assert.equal(models,1);assert.equal(checks,strategy==='alternate'?2:1);assert.equal(result.value[1][2].value[1],true);assert.equal(result.value[3].tag,strategy==='alternate'?1:0);if(strategy==='alternate'){const cf=result.value[3].value;assert.equal(cf[0][0],20n);assert.equal(cf[0][2].value[1],false);assert.equal(cf[1].value[0],'610a');}}
 else if(stopped){assert.equal(result.tag,3);assert.equal(approvals,0);assert.equal(writes,0);assert.equal(reads,0);assert.equal(checks,scenario==='consumer-unavailable'?1:0);assert.equal(models,scenario==='stale'?0:1);assert.equal(await readFile(join(area,'parser.mjs'),'utf8'),tools.evidence.reference);}
 else{assert.equal(result.tag,4);assert.equal(approvals,1);assert.equal(writes,1);assert.equal(reads,1);assert.equal(await readFile(join(area,'parser.mjs'),'utf8'),decodedFields);assert.equal(models,scenario==='repair'?3:['recursive','alternate'].includes(strategy)?2:1);}
 assert.equal(experiments,scenario==='repair'?1:0);
 if(scenario.startsWith('consumer'))assert.deepEqual(probes,scenario==='consumer-unavailable'?['22']:strategy==='alternate'?[(17n+input[4]+2n).toString(),'18']:['18']);
 console.log(JSON.stringify({strategy,scenario,acceptedArtifacts:stopped||partial?0:1,falseCompletionClaims:0,imageBytes:image.length,models,contextBytes,checks,experiments,approvals,writes,reads,referenceRequests:references.length,transfers,peakCheckpoint,peakWorkingLive:nativeTool?null:String(peakWorkingLive),engine:peer?'cross-engine':nativeTool?'native':'Node',engines,browser:browser?.identity,workersDestroyed:browser?.workersDestroyed,sourceDenied:!!deniedRoot,metrics:tools.metrics(),events,probes}));
}finally{if(browser)await browser.close();if(peer)await peer.close();await rm(area,{recursive:true,force:true});}
