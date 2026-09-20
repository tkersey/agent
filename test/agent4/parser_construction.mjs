// Environmental leaves only. Reciprocal ordering and candidate state live in BPI3.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {decodeSchema,decodeValue,encodeValue} from '../../runtime/values.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {bufferUntilEOF,decodedFields} from '../consumers/incremental-parser/candidates.mjs';
const [worldEntry,kernelPath,peerPath,nativeTool,browserTools,browserEngine='chromium']=process.argv.slice(2);
const {Kernel,decodeOutcome,decodeRequest,encodeResult,encodeInput}=await import(pathToFileURL(resolve(worldEntry)));
const read=async name=>new Uint8Array(await readFile(`zig-out/agent4/parser-construction/${name}`));
const image=await read('program.bpi3'),inputSchema=decodeSchema(await read('input-schema.bin'));
const resultSchema=decodeSchema(await read('result-schema.bin')),modelSchema=decodeSchema(await read('model-schema.bin'));
const model=decodeValue(modelSchema,await read('model-template.bin'));
const tools=await createParserTools();assert.equal(tools.kind,'qualified',JSON.stringify(tools));
model[3].push([2,`Frozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}\nThe consumer needs the escape-boundary transition.`]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const subject=tools.subject(hash(tools.evidence.reference));
const trace=[[[92],false],[[110,10],false],[[],true]];
model[3].push([2,`Concrete consumer trace: ${JSON.stringify(trace)}`]);
const scenario=process.argv[8]??'repair';
const rounds=scenario==='zero'?0n:scenario==='one'?1n:2n;
const input=[subject,model,trace,17n,rounds];
const kernelBytes=new Uint8Array(await readFile(kernelPath)),expectedSha256=hash(kernelBytes);
const peer=peerPath?await(await import(pathToFileURL(resolve(peerPath)))).wasmtimePeer(resolve(kernelPath),expectedSha256):null;
let browser;
try {
if(browserTools)browser=await(await import('./recursive_browser.mjs')).browserPeer({worldEntry,kernelPath,tools:browserTools,engine:browserEngine,sha256:expectedSha256});
let identity=1n;const fresh=()=>Kernel.create({bytes:kernelBytes,expectedSha256,instanceId:identity++});
let k=await fresh(),p=k.prepare(image),s=k.start(p,encodeValue(inputSchema,input));k.releasePrepared(p);
let control='none',value=new Uint8Array(),transfers=0;const events=[],engines=[];
let result,modelCalls=0,probeFailed=false,fullAccepted=false;
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
  if(out.kind==='completed') {result=decodeValue(resultSchema,out.value);k.close(s);assert.equal(k.usage().workingLive,0n);break;}
  assert.ok(['progressed','requested'].includes(out.kind),out.kind);
  if(out.kind==='requested') {
    const request=await decodeRequest(out.request),payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);
    events.push(request.semanticIdentity);let reply;
    if(request.semanticIdentity==='agent.parser.reference.v1') {
      assert.equal(events.length,1,'reference must precede the first candidate');reply=await tools.reference(payload);
    } else if(request.semanticIdentity==='agent.model.invoke.v3') {
      modelCalls++;
      if(modelCalls===1) {
        assert.match(payload[3].at(-1)[1],/observations: 3$/);
        assert.deepEqual(payload[4].map(tool=>tool[2]),['fragment','unresolved']);
      } else {
        assert.equal(probeFailed,true,'repair requires the actual counterexample first');
        assert.match(payload[3].at(-1)[1],/real consumer probe failed/);
        assert.ok(payload[3].at(-1)[1].includes(bufferUntilEOF));
        assert.ok(!payload[3].some(message=>message[1].includes(decodedFields)));
        assert.deepEqual(payload[4].map(tool=>tool[2]),['fragment','complete_candidate','unresolved']);
      }
      const source=modelCalls===1?bufferUntilEOF:decodedFields;
      const name=modelCalls===1?'fragment':'complete_candidate',ordinal=modelCalls===1?0:1;
      const explanation=modelCalls===1?'Escape handling is present; record emission still needs assessment.':'Revise immediate emission; request full independent acceptance.';
      reply={tag:0,value:[[{tag:0,value:['same-provider-id',name,
        new TextEncoder().encode(JSON.stringify({source,explanation})),ordinal,
        {tag:0,value:{tag:ordinal,value:[source,explanation]}}]}],Array(32).fill(0)]};
    } else if(request.semanticIdentity==='agent.parser.execution.v1') {
      assert.equal(payload[2][0],modelCalls===1?bufferUntilEOF:decodedFields);
      assert.equal(payload[2][1],BigInt(modelCalls));assert.equal(payload[2][2],modelCalls===1?0:1);
      assert.equal(payload[1],17n+BigInt(modelCalls));reply=scenario==='incomplete'&&modelCalls===2?[payload[1],payload[2][1],{tag:1,value:[true,0,536,false,'']}]:await tools.execute(payload);
      if(modelCalls===1) {
        assert.equal(reply[2].tag,0);assert.equal(reply[2].value[1],false);probeFailed=true;
        assert.deepEqual(reply[2].value[0],[[[],0,{tag:0,value:null}],[[],0,{tag:0,value:null}],[[[[10]]],1,{tag:0,value:null}]]);
      } else {assert.equal(reply[2].tag,1);assert.equal(reply[2].value[0],true);fullAccepted=scenario!=='incomplete';}
      console.log(JSON.stringify({candidateVersion:modelCalls,check:reply[2].tag,passed:reply[2].value[reply[2].tag===0?1:0]}));
    } else throw Error('undeclared leaf');
    control='reply';value=await encodeResult(out.request,encodeValue(decodeSchema(request.resumeSchema),reply));
  } else {control='none';value=new Uint8Array();}
  const state=out.state;assert.deepEqual(k.checkpoint(s,{transfer:true}),state);assert.equal(k.usage().workingLive,0n);
  k=await fresh();p=k.prepare(image);s=k.restore(p,state);k.releasePrepared(p);transfers++;
}
if(rounds===0n){assert.equal(result.tag,3);assert.equal(events.length,0);}
else if(scenario==='incomplete'){assert.equal(result.tag,3);assert.match(result.value,/incomplete or inconsistent/);assert.equal(fullAccepted,false);}
else {
  assert.equal(result.tag,2);
  assert.equal(result.value[0][0],rounds===1n?bufferUntilEOF:decodedFields);
  assert.equal(result.value[0][1],rounds);
  assert.equal(result.value[0][2],rounds===1n?0:1);
  assert.equal(result.value[1][2].tag,rounds===1n?0:1);
  assert.equal(fullAccepted,rounds>1n);
  assert.equal(events.filter(x=>x==='agent.parser.reference.v1').length,1,'reference evidence should be reused');
  assert.equal(modelCalls,Number(rounds));
}
console.log(JSON.stringify({imageBytes:image.length,events,transfers,engines,browser:browser?.identity,workersDestroyed:browser?.workersDestroyed,rounds:Number(rounds),modelCalls,fullAccepted,
  counterexampleObserved:probeFailed,metrics:tools.metrics(),paidProviderCalls:0}));
} finally {if(browser)await browser.close();if(peer)await peer.close();}
