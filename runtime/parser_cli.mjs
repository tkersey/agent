// Environmental adapter loop only; construction, selection and acceptance live in BPI3.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createInterface} from 'node:readline';
import {contractFor} from './parser_oracle.mjs';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {isMain} from './cli.mjs';
import {verifyRuntime} from '../tools/agent4/dependencies.mjs';
import {decodeSchema,decodeValue,encodeValue} from './values.mjs';
import {admitModelEndpoint,decodeModelInvocation,performModelInvocation} from './model.mjs';
import {createParserTools} from './parser_tools.mjs';
import {createParserDelivery} from './parser_delivery.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item);
export function parseParserOptions(args){
 const options={calls:0,checks:0,quanta:10000,allowPaid:false,eofPolicy:'strict',selection:'single',strategy:'recursive'};const seen=new Set();
 const fields=new Map([['--strategy','strategy'],['--selection','selection'],['--eof-policy','eofPolicy'],['--world-runtime','runtime'],['--model','model'],['--endpoint','endpoint'],['--data-policy','dataPolicy'],['--key-env','keyEnv'],['--max-model-calls','calls'],['--max-checks','checks'],['--max-quanta','quanta']]);
 for(let i=0;i<args.length;i++){
  const name=args[i];assert(!seen.has(name),'repeated option');seen.add(name);
  if(name==='--allow-paid'){options.allowPaid=true;continue;}
  const field=fields.get(name);assert(field&&args[i+1]&&!args[i+1].startsWith('--'),'unknown or missing option');options[field]=args[++i];
 }
 for(const name of ['calls','checks','quanta']){assert(/^\d+$/.test(String(options[name])),'invalid allowance');options[name]=Number(options[name]);assert(Number.isSafeInteger(options[name])&&options[name]>=0&&options[name]<=(name==='quanta'?10000:16),'allowance out of range');}
 assert(['strict','emit','ask'].includes(options.eofPolicy),'unknown EOF policy');
 assert(['single','first','last'].includes(options.selection),'unknown selection policy');
 assert(['recursive','react','complete'].includes(options.strategy),'unknown strategy');
 assert(options.strategy==='recursive'||options.selection==='single','selection requires recursive strategy');
 assert(options.runtime,'--world-runtime is required');assert(options.quanta>0,'positive work allowance required');
 if(options.calls){
  assert(options.model&&Buffer.byteLength(options.model)<=128,'explicit model required');
  assert.equal(options.dataPolicy,'fixture-only','explicit fixture-only data policy required');
  assert(options.endpoint,'explicit endpoint required');
  const endpoint=admitModelEndpoint(options.endpoint,options.keyEnv!==undefined);
  const loopback=['127.0.0.1','[::1]','localhost'].includes(endpoint.hostname);
  assert(loopback||options.allowPaid,'external model calls require --allow-paid');
  assert(!options.keyEnv||options.allowPaid,'credential use requires --allow-paid');
  if(options.keyEnv)assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.keyEnv),'invalid key environment name');
 }else assert(!options.allowPaid&&!options.keyEnv,'credentials require an explicit positive call allowance');
 return Object.freeze(options);
}
async function installedInputs({selection,strategy}){
 const directory=join(root,'examples');
 const inventory=JSON.parse(await readFile(join(directory,'inventory.json'),'utf8'));
 const read=async path=>{const row=inventory.files.find(x=>x.path===path);assert(row,'missing parser inventory entry');const bytes=await readFile(join(directory,path));assert.equal(hash(bytes),row.sha256,'parser artifact changed');return bytes;};
 const folder='parser-construction/';
 const inputSchema=decodeSchema(await read(folder+'input-schema.bin'));
 return{image:await read(folder+(strategy!=='recursive'?`${strategy}.bpi3`:selection==='single'?'program.bpi3':`select-${selection}.bpi3`)),inputSchema,resultSchema:decodeSchema(await read(folder+'result-schema.bin')),input:decodeValue(inputSchema,await read(folder+'task.args'))};
}
export async function runParser(args){
 const options=parseParserOptions(args);
 const runtime=verifyRuntime(resolve(options.runtime));
 const world=await import(pathToFileURL(runtime.entrypoint));
 const installed=await installedInputs(options);
 const input=structuredClone(installed.input),spent={models:0,checks:0,quanta:0,contextBytes:0,modelRequestBytes:0,modelReplyBytes:0,questions:0};
 const observations=[];
 const participantFor=operation=>operation==='agent.parser.target-read.v1'?'completion':
  operation==='agent.interaction.exchange.v1.parser.eof'?'clarification':
  options.strategy==='react'?'react':operation==='agent.model.invoke.v3'?'producer':
   operation==='agent.parser.reference.v1'?'reference':
    ['agent.parser.probe.v1','agent.parser.execution.v1'].includes(operation)?'consumer':null;
 let tools,delivery,area,apiKey;const bindings=new Map();
 try{
 if(options.calls){
  tools=await createParserTools({eofPolicy:options.eofPolicy==='emit'?'emit':'strict'});
  if(tools.kind!=='qualified')return{format:'agent-parser-run/v1',status:'unresolved',reason:'executor-unavailable',capability:tools,spent};
  if(options.keyEnv){apiKey=process.env[options.keyEnv];assert(apiKey,'selected credential is unavailable');}
  area=await mkdtemp(join(tmpdir(),'agent-parser-fixture-'));
  await writeFile(join(area,'parser.mjs'),tools.evidence.reference);
  delivery=await createParserDelivery({root:area,eofPolicy:options.eofPolicy==='emit'?'emit':'strict'});
  bindings.set(tools.subject(hash(tools.evidence.reference))[4],{tools,delivery});
  input[0]=tools.subject(hash(tools.evidence.reference));input[1][1]=options.model;
  if(options.strategy!=='recursive')input[1][3][1][1]='Propose a complete incremental parser using the required language. Later feedback may request experiments or revised complete source. Use only offered operations.';
  input[1][3].push([2,`Frozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}`]);
  input[2]=[[[92],false],[[110,10],false],[[],true]];
  input[1][3].push([2,`Concrete consumer trace: ${JSON.stringify(input[2])}`]);
  input[3]=(randomBytes(8).readBigUInt64LE()&((1n<<63n)-1n))||1n;input[4]=BigInt(options.calls);
  if(options.eofPolicy==='ask'){
   const alternative=await createParserTools({eofPolicy:'emit'});
   if(alternative.kind!=='qualified')return{format:'agent-parser-run/v1',status:'unresolved',reason:'executor-unavailable',capability:alternative,spent};
   const alternateModel=structuredClone(installed.input[1]);alternateModel[1]=options.model;
   if(options.strategy!=='recursive')alternateModel[3][1][1]=input[1][3][1][1];
   alternateModel[3].push([2,`Frozen batch reference:\n${alternative.evidence.reference}\nRequired behavior:\n${alternative.evidence.requirements}`]);
   alternateModel[3].push([2,`Concrete consumer trace: ${JSON.stringify(input[2])}`]);
   input[9]={tag:1,value:[alternative.subject(input[0][0]),alternateModel]};
   bindings.set(contractFor('emit'),{tools:alternative,delivery:await createParserDelivery({root:area,eofPolicy:'emit'})});
  }
 }
 const bytes=new Uint8Array(await readFile(runtime.kernelPath));
 let identity=(randomBytes(8).readBigUInt64LE()&((1n<<63n)-1n))||1n;
 const fresh=()=>world.Kernel.create({bytes,expectedSha256:runtime.kernelSha256,instanceId:identity++});
 let kernel=await fresh(),prepared=kernel.prepare(installed.image),session=kernel.start(prepared,encodeValue(installed.inputSchema,input));kernel.releasePrepared(prepared);
 const report=extra=>({format:'agent-parser-run/v1',selection:options.selection,strategy:options.strategy,...extra,spent:{...spent},observations,metrics:tools?{physicalExecutions:[...bindings.values()].reduce((n,b)=>n+b.tools.metrics().physicalExecutions,0),qualificationExecutions:[...bindings.values()].reduce((n,b)=>n+b.tools.metrics().qualificationExecutions,0)}:undefined,kernelSha256:runtime.kernelSha256,imageSha256:hash(installed.image),paidAuthorization:options.allowPaid});
 let control='none',value=new Uint8Array(),pendingView=null;
 const park=reason=>report({status:'unresolved',reason,pending:pendingView,state:Buffer.from(kernel.checkpoint(session,{transfer:true})).toString('base64'),resume:{control,value:Buffer.from(value).toString('base64')},environment:'ephemeral batch fixture; no automatic retry or resume'});
  while(spent.quanta<options.quanta){
   const out=world.decodeOutcome(kernel.drive(session,{control,value,quantum:100,checkpoint:true}));spent.quanta++;
   control='none';value=new Uint8Array(); // The previous ingress has been consumed.
   if(out.kind==='completed'){
    const result=decodeValue(installed.resultSchema,out.value);kernel.close(session);assert.equal(kernel.usage().workingLive,0n);
    return report({status:result.tag===4&&result.value.tag===4?'validated-artifact':'unresolved',result});
   }
   if(out.kind==='failed'||out.kind==='cancelled'){kernel.close(session);return report({status:out.kind});}
   assert(['progressed','requested'].includes(out.kind));
   if(out.kind==='requested'){
    const request=await world.decodeRequest(out.request);let reply;
    pendingView={authoritative:false,participant:participantFor(request.semanticIdentity),
     operation:request.semanticIdentity,requestDigest:hash(out.request)};
    if(request.semanticIdentity==='agent.model.invoke.v3'){
     pendingView.demand='model contribution';
     if(spent.models>=options.calls)return park('model-call-allowance');
     const invocation=decodeModelInvocation(request.payload);
     pendingView.demand=invocation.messages.at(-1)?.content??'';
     assert.equal(invocation.model,options.model);spent.models++;
     spent.contextBytes+=invocation.messages.reduce((n,message)=>n+Buffer.byteLength(message.content),0);spent.modelRequestBytes+=request.payload.length;
     reply=await performModelInvocation(request.payload,{endpoint:options.endpoint,...(apiKey===undefined?{}:{apiKey}),signal:AbortSignal.timeout(60000)});
     spent.modelReplyBytes+=reply.length;
    }else{
     const payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);let result;
     if(request.semanticIdentity==='agent.parser.reference.v1')pendingView.demand={trace:payload[2]};
     else if(['agent.parser.probe.v1','agent.parser.execution.v1'].includes(request.semanticIdentity))
      pendingView.demand={occurrence:payload[1],candidateVersion:payload[2][1],sourceDigest:hash(payload[2][0]),operation:payload[3]};
     if(request.semanticIdentity==='agent.interaction.exchange.v1.parser.eof'){
      spent.questions++;const reader=createInterface({input:process.stdin,output:process.stderr});
      const answer=await new Promise(done=>{
       reader.once('line',text=>done({kind:'line',text}));reader.once('close',()=>done({kind:'closed'}));reader.once('SIGINT',()=>done({kind:'aborted'}));
       process.stderr.write(payload[3][1]+'\n[1 / 2 / other / unsure] ');
      });reader.close();
      if(answer.kind!=='line')result={tag:answer.kind==='closed'?2:1,value:null};
      else {const text=answer.text.trim();result={tag:0,value:text==='1'||text==='2'?{tag:0,value:BigInt(text)}:{tag:text==='other'?1:2,value:null}};}
     }else if(request.semanticIdentity==='agent.parser.reference.v1'){const binding=bindings.get(payload[0][4]);assert(binding,'unbound EOF contract');result=await binding.tools.reference(payload);}
     else if(['agent.parser.probe.v1','agent.parser.execution.v1'].includes(request.semanticIdentity)){
      if(spent.checks>=options.checks)return park('experiment-allowance');spent.checks++;
      const binding=bindings.get(payload[0][4]);assert(binding,'unbound EOF contract');
      result=await(request.semanticIdentity==='agent.parser.probe.v1'?binding.tools.probe(payload):binding.tools.execute(payload));
      const outcome=result[2];
      observations.push({participant:participantFor(request.semanticIdentity),operation:request.semanticIdentity,occurrence:payload[1],candidateVersion:payload[2][1],sourceDigest:hash(payload[2][0]),
       ...(outcome.tag===0?{kind:'probe',passed:outcome.value[1],peakStateBytes:outcome.value[2]}:
        outcome.tag===1?{kind:'assessment',passed:outcome.value[0],executed:outcome.value[1],required:outcome.value[2],retentionPassed:outcome.value[3],firstFailure:outcome.value[4]}:
         {kind:'unavailable',reason:['unavailable','invalid','timeout','cancelled','failed','capacity'][outcome.value]})});
     }else if(request.semanticIdentity==='agent.parser.target-read.v1'){const binding=bindings.get(payload[2][4]);assert(binding,'unbound EOF contract');result=await binding.delivery.read(payload);}
     else throw Error('Unexpected environmental operation; no delivery authority granted');
     reply=encodeValue(decodeSchema(request.resumeSchema),result);
    }
    control='reply';value=await world.encodeResult(out.request,reply);
   }else{control='none';value=new Uint8Array();pendingView=null;}
   assert.deepEqual(kernel.checkpoint(session,{transfer:true}),out.state);
   kernel=await fresh();prepared=kernel.prepare(installed.image);session=kernel.restore(prepared,out.state);kernel.releasePrepared(prepared);
  }
  return park('work-allowance');
 }finally{if(area)await rm(area,{recursive:true,force:true});}
}
if(isMain(import.meta)){
 try{console.log(json(await runParser(process.argv.slice(2))));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
