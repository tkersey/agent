// Environmental adapter loop only; construction, selection and acceptance live in BPI3.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
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
 const options={calls:0,checks:0,quanta:10000,allowPaid:false};const seen=new Set();
 const fields=new Map([['--world-runtime','runtime'],['--model','model'],['--endpoint','endpoint'],['--data-policy','dataPolicy'],['--key-env','keyEnv'],['--max-model-calls','calls'],['--max-checks','checks'],['--max-quanta','quanta']]);
 for(let i=0;i<args.length;i++){
  const name=args[i];assert(!seen.has(name),'repeated option');seen.add(name);
  if(name==='--allow-paid'){options.allowPaid=true;continue;}
  const field=fields.get(name);assert(field&&args[i+1]&&!args[i+1].startsWith('--'),'unknown or missing option');options[field]=args[++i];
 }
 for(const name of ['calls','checks','quanta']){assert(/^\d+$/.test(String(options[name])),'invalid allowance');options[name]=Number(options[name]);assert(Number.isSafeInteger(options[name])&&options[name]>=0&&options[name]<=(name==='quanta'?10000:16),'allowance out of range');}
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
async function installedInputs(){
 const directory=join(root,'examples');
 const inventory=JSON.parse(await readFile(join(directory,'inventory.json'),'utf8'));
 const read=async path=>{const row=inventory.files.find(x=>x.path===path);assert(row,'missing parser inventory entry');const bytes=await readFile(join(directory,path));assert.equal(hash(bytes),row.sha256,'parser artifact changed');return bytes;};
 const folder='parser-construction/';
 const inputSchema=decodeSchema(await read(folder+'input-schema.bin'));
 return{image:await read(folder+'program.bpi3'),inputSchema,resultSchema:decodeSchema(await read(folder+'result-schema.bin')),input:decodeValue(inputSchema,await read(folder+'task.args'))};
}
export async function runParser(args){
 const options=parseParserOptions(args);
 const runtime=verifyRuntime(resolve(options.runtime));
 const world=await import(pathToFileURL(runtime.entrypoint));
 const installed=await installedInputs();
 const input=structuredClone(installed.input),spent={models:0,checks:0,quanta:0,contextBytes:0,modelRequestBytes:0,modelReplyBytes:0};
 let tools,delivery,area,apiKey;
 try{
 if(options.calls){
  tools=await createParserTools();
  if(tools.kind!=='qualified')return{format:'agent-parser-run/v1',status:'unresolved',reason:'executor-unavailable',capability:tools,spent};
  if(options.keyEnv){apiKey=process.env[options.keyEnv];assert(apiKey,'selected credential is unavailable');}
  area=await mkdtemp(join(tmpdir(),'agent-parser-fixture-'));
  await writeFile(join(area,'parser.mjs'),tools.evidence.reference);
  delivery=await createParserDelivery({root:area});
  input[0]=tools.subject(hash(tools.evidence.reference));input[1][1]=options.model;
  input[1][3].push([2,`Frozen batch reference:\n${tools.evidence.reference}\nRequired behavior:\n${tools.evidence.requirements}`]);
  input[2]=[[[92],false],[[110,10],false],[[],true]];
  input[1][3].push([2,`Concrete consumer trace: ${JSON.stringify(input[2])}`]);
  input[3]=(randomBytes(8).readBigUInt64LE()&((1n<<63n)-1n))||1n;input[4]=BigInt(options.calls);
 }
 const bytes=new Uint8Array(await readFile(runtime.kernelPath));
 let identity=(randomBytes(8).readBigUInt64LE()&((1n<<63n)-1n))||1n;
 const fresh=()=>world.Kernel.create({bytes,expectedSha256:runtime.kernelSha256,instanceId:identity++});
 let kernel=await fresh(),prepared=kernel.prepare(installed.image),session=kernel.start(prepared,encodeValue(installed.inputSchema,input));kernel.releasePrepared(prepared);
 const report=extra=>({format:'agent-parser-run/v1',...extra,spent:{...spent},metrics:tools?.metrics(),kernelSha256:runtime.kernelSha256,imageSha256:hash(installed.image),paidAuthorization:options.allowPaid});
 let control='none',value=new Uint8Array();
 const park=reason=>report({status:'unresolved',reason,state:Buffer.from(kernel.checkpoint(session,{transfer:true})).toString('base64'),resume:{control,value:Buffer.from(value).toString('base64')},environment:'ephemeral batch fixture; no automatic retry or resume'});
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
    if(request.semanticIdentity==='agent.model.invoke.v3'){
     if(spent.models>=options.calls)return park('model-call-allowance');
     const invocation=decodeModelInvocation(request.payload);assert.equal(invocation.model,options.model);spent.models++;
     spent.contextBytes+=invocation.messages.reduce((n,message)=>n+Buffer.byteLength(message.content),0);spent.modelRequestBytes+=request.payload.length;
     reply=await performModelInvocation(request.payload,{endpoint:options.endpoint,...(apiKey===undefined?{}:{apiKey}),signal:AbortSignal.timeout(60000)});
     spent.modelReplyBytes+=reply.length;
    }else{
     const payload=decodeValue(decodeSchema(request.payloadSchema),request.payload);let result;
     if(request.semanticIdentity==='agent.parser.reference.v1'){assert(tools);result=await tools.reference(payload);}
     else if(['agent.parser.probe.v1','agent.parser.execution.v1'].includes(request.semanticIdentity)){
      if(spent.checks>=options.checks)return park('experiment-allowance');spent.checks++;
      result=await(request.semanticIdentity==='agent.parser.probe.v1'?tools.probe(payload):tools.execute(payload));
     }else if(request.semanticIdentity==='agent.parser.target-read.v1'){assert(delivery);result=await delivery.read(payload);}
     else throw Error('Unexpected environmental operation; no delivery authority granted');
     reply=encodeValue(decodeSchema(request.resumeSchema),result);
    }
    control='reply';value=await world.encodeResult(out.request,reply);
   }else{control='none';value=new Uint8Array();}
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
