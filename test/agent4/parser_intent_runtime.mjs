import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {decodeModelInvocation,normalizeOpenAIResponses} from '../../runtime/model.mjs';
const [runtimePath='.agent4-recursive-integrated/out/world-runtime',nativeTool,peerPath,browserTools,engine='chromium']=process.argv.slice(2);
const runtime=verifyRuntime(resolve(runtimePath));
const {Kernel,decodeOutcome,decodeRequest,encodeResult,encodeInput}=await import(pathToFileURL(runtime.entrypoint));
const peer=peerPath?await(await import(pathToFileURL(resolve(peerPath)))).wasmtimePeer(runtime.kernelPath,runtime.kernelSha256):null;
const browser=browserTools?await(await import('./recursive_browser.mjs')).browserPeer({worldEntry:runtime.entrypoint,kernelPath:runtime.kernelPath,tools:browserTools,engine,sha256:runtime.kernelSha256}):null;
try {
const read=async n=>new Uint8Array(await readFile(`zig-out/agent4/parser-construction/${n}`));
const image=await read('program.bpi3'),inputSchema=decodeSchema(await read('input-schema.bin')),outputSchema=decodeSchema(await read('result-schema.bin'));
const model=decodeValue(decodeSchema(await read('model-schema.bin')),await read('model-template.bin'));
const strict=await createParserTools(),emit=await createParserTools({eofPolicy:'emit'});
assert.equal(strict.kind,'qualified');assert.equal(emit.kind,'qualified');
const base=createHash('sha256').update(strict.evidence.reference).digest('hex');
const subjects=[strict.subject(base),emit.subject(base)];
for(const field of [1,2,3,4])assert.notEqual(subjects[0][field],subjects[1][field]);
await assert.rejects(()=>strict.reference([subjects[1],1n,[[[97],true]]]));
const kernelBytes=new Uint8Array(await readFile(runtime.kernelPath));let identity=1n,stale;
const results=[];
for(const [name,choice]of [['known',null],['strict',1],['emit',2],['unsure','unsure'],['unoffered',99],['other','other'],['bad-base',1],['bad-contract',2],['known-again',null],['no-work',2],['ask-again',1]]){
 const input=[subjects[0],structuredClone(model),[[[97],true]],BigInt(results.length+1),1n,'parser.mjs',7n,false,false,
  choice===null?{tag:0,value:null}:{tag:1,value:[structuredClone(subjects[1]),structuredClone(model)]}];
 const invalid=name.startsWith('bad-'),noWork=name==='no-work';
 if(name==='bad-base')input[9].value[0][0]='f'.repeat(64);
 if(name==='bad-contract')input[9].value[0][4]=subjects[0][4];
 if(noWork)input[4]=0n;
 const fresh=()=>Kernel.create({bytes:kernelBytes,expectedSha256:runtime.kernelSha256,instanceId:identity++});
 let k=await fresh(),p=k.prepare(image),s=k.start(p,encodeValue(inputSchema,input));k.releasePrepared(p);
 let control='none',value=new Uint8Array(),transfers=0,questions=0,models=0;const events=[];
 for(let n=0;;n++){
  assert.ok(n<128);const invocation={image,state:k.checkpoint(s),control,value,quantum:31};
  const actual=k.drive(s,{control,value,quantum:31,checkpoint:true});let returned=actual;
  if(peer){const bytes=encodeInput(invocation),native=new Uint8Array(execFileSync(nativeTool,['invoke'],{input:bytes,maxBuffer:16<<20})),independent=(await peer.call('invoke',{bytes})).bytes;assert.deepEqual(actual,native);assert.deepEqual(independent,native);const choices=[actual,native,independent];if(browser){const worker=await browser.invoke(invocation);assert.deepEqual(worker,native);choices.unshift(worker);}returned=choices[n%choices.length];}
  const out=decodeOutcome(returned);
  if(out.kind==='completed'){const result=decodeValue(outputSchema,out.value);assert.equal(result.tag,3);k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  if(out.kind==='requested'){
   const request=await decodeRequest(out.request),payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);events.push(request.semanticIdentity);let encoded;
   if(request.semanticIdentity==='agent.interaction.exchange.v1.parser.eof'){
    questions++;assert.equal(events.length,1);assert.match(payload[3][1],/Final unterminated-record behavior is unspecified/);assert.deepEqual(payload[3][0],[...subjects,input[3]]);
    if(stale){const before=k.checkpoint(s);assert.throws(()=>k.drive(s,{control:'reply',value:stale,quantum:1}));assert.deepEqual(k.checkpoint(s),before);}
    const selected=choice==='unsure'?{tag:2,value:null}:choice==='other'?{tag:1,value:null}:{tag:0,value:BigInt(choice)};
    encoded=await encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),{tag:0,value:selected}));stale=encoded;
   }else if(request.semanticIdentity==='agent.parser.reference.v1'){
    const policy=choice===2?emit:strict;assert.deepEqual(payload[0],choice===2?subjects[1]:subjects[0]);const reply=await policy.reference(payload);
    if(choice===2)assert.deepEqual(reply[1].value,[[[[[97]]],1,{tag:0,value:null}]]);
    else assert.equal(reply[1].value[0][1],2);
    encoded=await encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply));
   }else{
    assert.equal(request.semanticIdentity,'agent.model.invoke.v3');models++;const invocation=decodeModelInvocation(request.payload);
    const reply=normalizeOpenAIResponses(Buffer.from(JSON.stringify({status:'completed',error:null,output:[{type:'function_call',status:'completed',call_id:'same',name:'unresolved',arguments:JSON.stringify({reason:'Intent witness ends before construction.'})}]})),invocation.normalizationLimits,invocation.tools);
    encoded=await encodeResult(out.request,reply);
   }
   control='reply';value=encoded;
  }else{assert.equal(out.kind,'progressed');control='none';value=new Uint8Array();}
  assert.deepEqual(k.checkpoint(s,{transfer:true}),out.state);k=await fresh();p=k.prepare(image);s=k.restore(p,out.state);k.releasePrepared(p);transfers++;
 }
 assert.equal(questions,choice===null||invalid||noWork?0:1);assert.equal(models,!invalid&&!noWork&&(choice===null||choice===1||choice===2)?1:0);
 results.push({name,questions,models,transfers,events});
}
console.log(JSON.stringify({imageBytes:image.length,results,browser:browser?.identity,workersDestroyed:browser?.workersDestroyed,independent:!!peer,paidCalls:0}));
}finally{if(browser)await browser.close();if(peer)await peer.close();}
