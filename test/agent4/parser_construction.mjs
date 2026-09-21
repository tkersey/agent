// Environmental leaves only. Reciprocal ordering and candidate state live in BPI3.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createParserDelivery} from '../../runtime/parser_delivery.mjs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {bufferUntilEOF,decodedFields,wrongOffset} from '../consumers/incremental-parser/candidates.mjs';
const [worldEntry,kernelPath,peerPath,nativeTool,browserTools,browserEngine='chromium']=process.argv.slice(2);
const {Kernel,decodeOutcome,decodeRequest,encodeResult,encodeInput}=await import(pathToFileURL(resolve(worldEntry)));
const read=async name=>new Uint8Array(await readFile(`zig-out/agent4/parser-construction/${name}`));
const scenario=process.argv[8]??'repair';
const experiment=scenario.startsWith('experiment');
const retained=scenario.startsWith('retained');
const localAbort=scenario.startsWith('retained-abort');
const cancelRequested=scenario==='retained-cancel'||scenario==='retained-abort-cancel';
const image=await read(retained?'retained.bpi3':scenario==='forged'?'forged.bpi3':'program.bpi3'),inputSchema=decodeSchema(await read('input-schema.bin'));
const resultSchema=decodeSchema(await read('result-schema.bin')),modelSchema=decodeSchema(await read('model-schema.bin'));
const model=decodeValue(modelSchema,await read('model-template.bin'));
const tools=await createParserTools();assert.equal(tools.kind,'qualified',JSON.stringify(tools));
model[3].push([2,`Frozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}\nThe consumer needs the escape-boundary transition.`]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const subject=tools.subject(hash(tools.evidence.reference));
const trace=[[[92],false],[[110,10],false],[[],true]];
model[3].push([2,`Concrete consumer trace: ${JSON.stringify(trace)}`]);
const rounds=scenario==='zero'?0n:['one','retained-one','retained-cancel'].includes(scenario)?1n:['full-repair','experiment-repair','experiment-unchanged'].includes(scenario)?3n:2n;
const area=await mkdtemp(join(tmpdir(),'parser-synthesis-'));
await writeFile(join(area,'parser.mjs'),tools.evidence.reference);
const delivery=await createParserDelivery({root:area});
const apply=['apply','decline','changed-approval'].includes(scenario);
const input=[subject,model,trace,17n,rounds,'parser.mjs',7n,apply,localAbort,{tag:0,value:null}];
const kernelBytes=new Uint8Array(await readFile(kernelPath)),expectedSha256=hash(kernelBytes);
const peer=peerPath?await(await import(pathToFileURL(resolve(peerPath)))).wasmtimePeer(resolve(kernelPath),expectedSha256):null;
let browser;
try {
if(browserTools)browser=await(await import('./recursive_browser.mjs')).browserPeer({worldEntry,kernelPath,tools:browserTools,engine:browserEngine,sha256:expectedSha256});
let identity=1n;const fresh=()=>Kernel.create({bytes:kernelBytes,expectedSha256,instanceId:identity++});
let k=await fresh(),p=k.prepare(image),s=k.start(p,encodeValue(inputSchema,input));k.releasePrepared(p);
let control='none',value=new Uint8Array(),transfers=0;const events=[],engines=[];
let result,modelCalls=0,probeFailed=false,fullAccepted=false,targetReads=0,approvals=0,writes=0;
const lifetime=[];let cancelling=false,cancelled=false,failed=false;
for(let round=0;;round++) {
  assert.ok(round<128);
  const invocation={image,state:k.checkpoint(s),control,value,quantum:100};
  const node=k.drive(s,{control,value,quantum:100,checkpoint:true});let returned=node,engine='Node';
  if(peer) {
    const command=encodeInput(invocation);
    const native=new Uint8Array(execFileSync(nativeTool,['invoke'],{input:command,maxBuffer:16<<20}));
    const independent=(await peer.call('invoke',{bytes:command})).bytes;
    assert.deepEqual(node,native);assert.deepEqual(independent,native);
    const choices=[[native,'native'],[independent,'Wasmtime'],[node,'Node']];
    if(browser){const actual=await browser.invoke(invocation);assert.deepEqual(actual,native);choices.unshift([actual,`${browserEngine} Worker`]);}
    [returned,engine]=choices[round%choices.length];
  }
  engines.push(engine);const out=decodeOutcome(returned);
  if(out.kind==='failed'){assert.ok(['experiment-stale','experiment-assessment'].includes(scenario));failed=true;k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  if(out.kind==='cancelled') {assert.equal(cancelling,true);cancelled=true;k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  if(out.kind==='completed') {result=decodeValue(resultSchema,out.value);k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  assert.ok(['progressed','requested'].includes(out.kind),out.kind);
  if(out.kind==='requested') {
    const request=await decodeRequest(out.request),payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);
    events.push(request.semanticIdentity);let reply;
    if(request.semanticIdentity==='agent.parser.reference.v1'||(localAbort&&request.semanticIdentity==='parser/abort-observation')) {
      assert.equal(events.length,1,'reference must precede the first candidate');reply=await tools.reference(payload);
    } else if(request.semanticIdentity==='agent.model.invoke.v3') {
      modelCalls++;
      if(modelCalls===1) {
        assert.match(payload[3].at(-1)[1],/observations: 3$/);
        assert.deepEqual(payload[4].map(tool=>tool[2]),['fragment','unresolved']);
      } else {
        assert.equal(probeFailed,true,'repair requires the actual counterexample first');
        assert.match(payload[3].at(-1)[1],experiment&&modelCalls===3?/consumer probe passed/:modelCalls===2?/real consumer probe failed/:/Required acceptance rejected/);
        assert.ok(payload[3].at(-1)[1].includes(modelCalls===2||experiment?bufferUntilEOF:wrongOffset));
        if(experiment&&modelCalls===3){assert.ok(payload[3].some(message=>message[1].includes('Hex bytes: 610a; first chunk bytes: 1; later chunk bytes: 1; finalize: true')));assert.ok(payload[3].some(message=>message[1].includes('earlier required check FAILED')));}
        assert.ok(!payload[3].some(message=>message[1].includes(decodedFields)));
        assert.deepEqual(payload[4].map(tool=>tool[2]),['fragment','complete_candidate','experiment','unresolved']);
      }
      const source=modelCalls===1||scenario==='experiment-unchanged'?bufferUntilEOF:scenario==='full-repair'&&modelCalls===2?wrongOffset:decodedFields;
      const name=modelCalls===1?'fragment':'complete_candidate',ordinal=modelCalls===1?0:1;
      const explanation=modelCalls===1?'Escape handling is present; record emission still needs assessment.':'Revise immediate emission; request full independent acceptance.';
      reply={tag:0,value:[[{tag:0,value:['same-provider-id',name,
        new TextEncoder().encode(JSON.stringify({source,explanation})),ordinal,
        {tag:0,value:{tag:ordinal,value:[source,explanation]}}]}],Array(32).fill(0)]};
      if((experiment&&modelCalls===2)||(scenario==='experiment-before'&&modelCalls===1)){
        const proposal={input_hex:scenario==='experiment-invalid'?'zz':'610a',first_chunk_bytes:1,chunk_bytes:1,finalize:true,reason:'Check immediate emission on a literal record terminator.'};
        reply={tag:0,value:[[{tag:0,value:['same-provider-id','experiment',new TextEncoder().encode(JSON.stringify(proposal)),2,
          {tag:0,value:{tag:2,value:Object.values(proposal)}}]}],Array(32).fill(0)]};
      }
    } else if(['agent.parser.execution.v1','agent.parser.probe.v1'].includes(request.semanticIdentity)) {
      const proposed=experiment&&modelCalls===2;
      assert.equal(payload[2][0],modelCalls===1||proposed?bufferUntilEOF:scenario==='full-repair'&&modelCalls===2?wrongOffset:decodedFields);
      assert.equal(payload[2][1],BigInt(proposed?1:modelCalls));assert.equal(payload[2][2],modelCalls===1||proposed?0:1);
      if(proposed)assert.equal(payload[3].tag,2);
      assert.equal(payload[1],17n+BigInt(modelCalls));reply=scenario==='incomplete'&&modelCalls===2?[payload[1],payload[2][1],{tag:1,value:[true,0,536,false,'']}]:await (request.semanticIdentity==='agent.parser.probe.v1'?tools.probe(payload):tools.execute(payload));
      if(modelCalls===1) {
        assert.equal(reply[2].tag,0);assert.equal(reply[2].value[1],false);probeFailed=true;
        assert.deepEqual(reply[2].value[0],[[[],0,{tag:0,value:null}],[[],0,{tag:0,value:null}],[[[[10]]],1,{tag:0,value:null}]]);
      } else if(proposed){
        assert.equal(reply[2].tag,scenario==='experiment-invalid'?2:0);
        if(reply[2].tag===0){assert.equal(reply[2].value[1],true);assert.deepEqual(reply[2].value[0],[[[],0,{tag:0,value:null}],[[[[97]]],1,{tag:0,value:null}]]);}
        if(scenario==='experiment-stale')reply[1]=2n;
        if(scenario==='experiment-assessment')reply=[payload[1],payload[2][1],{tag:1,value:[true,536,536,true,'']}];
      } else {assert.equal(reply[2].tag,1);const passed=!(scenario==='full-repair'&&modelCalls===2);assert.equal(reply[2].value[0],passed);fullAccepted=passed&&scenario!=='incomplete';}
      console.log(JSON.stringify({modelRound:modelCalls,candidateVersion:Number(payload[2][1]),check:reply[2].tag,passed:reply[2].value[reply[2].tag===0?1:0]}));
    } else if(request.semanticIdentity==='agent.parser.target-read.v1') {
      assert.equal(fullAccepted,true);targetReads++;
      if(scenario==='changed-base')await writeFile(join(area,'parser.mjs'),'external change');
      reply=await delivery.read(payload);
    } else if(request.semanticIdentity==='agent.approval.issue.v1.parser.replace') {
      assert.equal(fullAccepted,true);assert.equal(targetReads,1);reply=41n;
    } else if(request.semanticIdentity==='agent.interaction.exchange.v1.parser.replace') {
      approvals++;assert.equal(payload[3][0],41n);
      if(scenario==='changed-approval')await writeFile(join(area,'parser.mjs'),'external change');
      reply={tag:0,value:[payload[3],7n,scenario==='decline'?{tag:1,value:'declined'}:{tag:0,value:null}]};
    } else if(request.semanticIdentity==='agent.parser.replace.v1') {
      writes++;assert.equal(approvals,1);reply=await delivery.replace(payload);
    } else if(['parser/retained-release','parser/retained-work','parser/participant-release'].includes(request.semanticIdentity)) {
      assert.equal(retained,true);if(!localAbort)assert.equal(probeFailed,true);
      if(cancelling)assert.ok(['parser/retained-release','parser/participant-release'].includes(request.semanticIdentity));
      if(!(cancelRequested&&!cancelling&&['parser/retained-release','parser/participant-release'].includes(request.semanticIdentity)))lifetime.push([request.semanticIdentity,payload.toString()]);reply=null;
    } else throw Error('undeclared leaf');
    if(cancelRequested&&!cancelling&&['parser/retained-release','parser/participant-release'].includes(request.semanticIdentity)) {
      cancelling=true;control='cancel_text';value=new TextEncoder().encode('stop during local disposal');
    } else {control='reply';value=await encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply));}
  } else {control='none';value=new Uint8Array();}
  const state=out.state;assert.deepEqual(k.checkpoint(s,{transfer:true}),state);assert.equal(k.usage().workingLive,0n);
  k=await fresh();p=k.prepare(image);s=k.restore(p,state);k.releasePrepared(p);transfers++;
}
if(failed){assert.ok(['experiment-stale','experiment-assessment'].includes(scenario));assert.equal(fullAccepted,false);assert.equal(modelCalls,2);assert.equal(targetReads,0);assert.equal(writes,0);}
else if(scenario==='experiment-before'){assert.equal(result.tag,3);assert.match(result.value,/model response was rejected/);assert.equal(modelCalls,1);assert.equal(tools.metrics().physicalExecutions,0);assert.equal(fullAccepted,false);}
else if(scenario==='experiment-unchanged'){assert.equal(result.tag,3);assert.match(result.value,/known counterexample/);assert.equal(modelCalls,3);assert.equal(fullAccepted,false);assert.equal(targetReads,0);assert.equal(tools.metrics().physicalExecutions,2);}
else if(experiment&&scenario!=='experiment-repair'){
  assert.equal(result.tag,2);assert.equal(result.value[0][0],bufferUntilEOF);assert.equal(result.value[0][1],1n);
  assert.equal(result.value[1][0],19n);assert.equal(result.value[1][1],1n);assert.equal(result.value[2].tag,1);
  assert.equal(result.value[1][2].tag,scenario==='experiment-invalid'?2:0);
  assert.equal(result.value[3].tag,1);assert.equal(result.value[3].value[0][2].value[1],false);
  assert.equal(fullAccepted,false);assert.equal(modelCalls,2);assert.equal(targetReads,0);assert.equal(writes,0);
  assert.equal(tools.metrics().physicalExecutions,scenario==='experiment-invalid'?1:2);
}
else if(cancelled){assert.equal(cancelRequested,true);assert.equal(modelCalls,localAbort?0:1);assert.equal(fullAccepted,false);}
else if(localAbort){assert.equal(result.tag,3);assert.match(result.value,/locally abandoned/);assert.equal(modelCalls,0);assert.equal(fullAccepted,false);assert.equal(events.filter(x=>x==='agent.parser.reference.v1').length,1);}
else if(scenario==='forged'){assert.equal(result.tag,3);assert.match(result.value,/do not grant completion authority/);assert.equal(events.length,0);}
else if(rounds===0n){assert.equal(result.tag,3);assert.equal(events.length,0);}
else if(scenario==='incomplete'){assert.equal(result.tag,3);assert.match(result.value,/incomplete or inconsistent/);assert.equal(fullAccepted,false);}
else {
  if(rounds===1n) {
    assert.equal(result.tag,2);assert.equal(result.value[0][0],bufferUntilEOF);
    assert.equal(result.value[0][2],0);assert.equal(result.value[1][2].tag,0);
  } else {
    assert.equal(result.tag,4);assert.equal(targetReads,1);
    if(scenario==='apply'){assert.equal(result.value.tag,0);assert.equal(result.value.value.tag,0);assert.equal(writes,1);}
    else if(scenario==='decline'){assert.equal(result.value.tag,1);assert.equal(writes,0);}
    else if(scenario==='changed-base'){assert.equal(result.value.tag,5);assert.equal(approvals,0);assert.equal(writes,0);}
    else if(scenario==='changed-approval'){assert.equal(result.value.tag,0);assert.equal(result.value.value.tag,1);}
    else {assert.equal(result.value.tag,4);assert.equal(writes,0);assert.equal(result.value.value[0][2],decodedFields);}
  }
  assert.equal(fullAccepted,rounds>1n);
  assert.equal(events.filter(x=>x==='agent.parser.reference.v1').length,1);
  assert.equal(modelCalls,Number(rounds));
}
const current=await readFile(join(area,'parser.mjs'),'utf8');
if(retained)assert.deepEqual(lifetime,localAbort&&cancelled?[
  // Global unwind disposes the younger retained owner first; it does not run
  // the authored local close-5/advance-50 continuation.
  ['parser/participant-release','90'],['parser/retained-release','50'],['parser/retained-release','5'],
]:localAbort?[
  ['parser/participant-release','90'],['parser/retained-release','5'],['parser/retained-work','57'],['parser/retained-release','50'],
]:cancelled?[
  ['parser/retained-release','5'],['parser/retained-release','50'],
]:[['parser/retained-release','5'],['parser/retained-work','57'],['parser/retained-release','50']]);
assert.equal(current,scenario==='apply'?decodedFields:['changed-base','changed-approval'].includes(scenario)?'external change':tools.evidence.reference);
console.log(JSON.stringify({imageBytes:image.length,events,lifetime,cancelled,failed,transfers,engines,browser:browser?.identity,workersDestroyed:browser?.workersDestroyed,rounds:Number(rounds),modelCalls,fullAccepted,targetReads,approvals,writes,
  counterexampleObserved:probeFailed,metrics:tools.metrics(),paidProviderCalls:0}));
} finally {await rm(area,{recursive:true,force:true});if(browser)await browser.close();if(peer)await peer.close();}
