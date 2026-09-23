import {createParserKernel} from '../../runtime/parser_kernel.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {verifyRuntime} from '../../tools/agent4/dependencies.mjs';
import {parseParserOptions} from '../../runtime/parser_cli.mjs';
import {bufferUntilEOF,emitFinalRecord,decodedFields,rawRecords} from '../consumers/incremental-parser/candidates.mjs';
const runtime=resolve(process.env.AGENT4_WORLD_RUNTIME??'.agent4-recursive-integrated/out/world-runtime');
test('parser provider configuration is explicit and credentials are not implicit',()=>{
 assert.equal(parseParserOptions(['--world-runtime',runtime]).calls,0);
 assert.equal(parseParserOptions(['--world-runtime',runtime]).selection,'single');
 assert.equal(parseParserOptions(['--world-runtime',runtime]).strategy,'recursive');
 assert.throws(()=>parseParserOptions(['--world-runtime',runtime,'--strategy','react','--selection','last']),/selection requires/);
 assert.equal(parseParserOptions(['--world-runtime',runtime,'--selection','last']).calls,0);
 assert.throws(()=>parseParserOptions(['--world-runtime',runtime,'--selection','best']),/selection policy/);
 const common=['--world-runtime',runtime,'--model','fixture','--max-model-calls','1','--data-policy','fixture-only'];
 assert.throws(()=>parseParserOptions([...common,'--endpoint','https://api.openai.com/v1/responses']),/allow-paid/);
 assert.throws(()=>parseParserOptions([...common,'--endpoint','http://127.0.0.1:1234','--key-env','TEST_KEY','--allow-paid']),/OpenAI Responses endpoint/);
 assert.throws(()=>parseParserOptions(['--world-runtime',runtime,'--max-model-calls','0','--allow-paid']),/positive call allowance/);
 assert.throws(()=>parseParserOptions([...common,'--endpoint','http://127.0.0.1:1234','--max-checks','17']),/out of range/);
 assert.throws(()=>parseParserOptions(['--world-runtime',runtime,'--unknown','x']),/unknown/);
});
async function run(cwd,args,timeout=30000,input){
 const child=spawn(process.execPath,['runtime/parser_cli.mjs','--world-runtime',runtime,...args],{cwd,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']});
 if(input!==undefined)child.stdin.end(input);
 let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 try{const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done);});assert.equal(code,0,error);return JSON.parse(output);}finally{clearTimeout(timer);}
}
test('parked participant view is diagnostic and cannot redirect resumption',async t=>{
 if(process.platform!=='darwin')return;
 const area=await mkdtemp(join(tmpdir(),'parser-cli-view-'));t.after(()=>rm(area,{recursive:true,force:true}));
 execFileSync('tar',['-xzf',resolve('zig-out/agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz'),'-C',area]);
 const cwd=join(area,(await readdir(area))[0]);let stopped;
 for(let budget=1;budget<=8;budget++){
  const result=await run(cwd,['--endpoint','http://127.0.0.1:1','--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1','--max-quanta',String(budget)]);
  assert.equal(result.spent.models,0);if(result.resume?.control==='reply'){stopped=result;break;}
 }
 assert(stopped);assert.equal(stopped.pending.authoritative,false);
 assert.equal(stopped.pending.participant,'reference');assert.equal(stopped.pending.operation,'agent.parser.reference.v1');
 assert.deepEqual(stopped.pending.demand.trace,[[[92],false],[[110,10],false],[[],true]]);
 assert.match(stopped.pending.requestDigest,/^[a-f0-9]{64}$/);
 const selected=verifyRuntime(runtime),world=await import(pathToFileURL(selected.entrypoint));
 const kernel=await createParserKernel(world.Kernel, {bytes:await readFile(selected.kernelPath),expectedSha256:selected.kernelSha256,instanceId:999n});
 const program=kernel.prepare(await readFile(join(cwd,'examples/parser-construction/program.bpi3')));
 const session=kernel.restore(program,Buffer.from(stopped.state,'base64'));kernel.releasePrepared(program);
 stopped.pending.participant='forged completion';stopped.pending.operation='target-write';
 assert.throws(()=>kernel.drive(stopped.pending),{code:'WORLD_HANDLE_INVALID'});
 let next=world.decodeOutcome(kernel.drive(session,{control:stopped.resume.control,value:Buffer.from(stopped.resume.value,'base64'),quantum:100,checkpoint:true}));
 for(let i=0;next.kind==='progressed'&&i<8;i++)next=world.decodeOutcome(kernel.drive(session,{quantum:100,checkpoint:true}));
 assert.equal(next.kind,'requested');assert.equal((await world.decodeRequest(next.request)).semanticIdentity,'agent.model.invoke.v3');
 kernel.checkpoint(session,{transfer:true});assert.equal(kernel.usage().workingLive,0n);
});

test('extracted parser command uses the real provider adapter without paid inference',{timeout:360000},async t=>{
 const area=await mkdtemp(join(tmpdir(),'parser-cli-package-'));t.after(()=>rm(area,{recursive:true,force:true}));
 execFileSync('tar',['-xzf',resolve('zig-out/agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz'),'-C',area]);
 const cwd=join(area,(await readdir(area))[0]);
 const zero=await run(cwd,[]);assert.equal(zero.status,'unresolved');assert.equal(zero.spent.models,0);assert.equal(zero.spent.checks,0);assert.deepEqual(zero.observations,[]);
 for(const strategy of ['react','complete']){const baseline=await run(cwd,['--strategy',strategy]);assert.equal(baseline.strategy,strategy);assert.equal(baseline.status,'unresolved');assert.equal(baseline.spent.models,0);}
 if(process.platform!=='darwin')return;
 let calls=0,repair=false,repairCalls=0,baseline=false;
 const providerErrors=[];
 const server=createServer(async(req,res)=>{
  try{
   assert.equal(req.headers.authorization,undefined);let body='';for await(const chunk of req)body+=chunk;
   const input=JSON.parse(body);assert.equal(input.model,'fixture-model');assert.match(body,/Frozen batch reference/);
   const later=baseline||repair&&repairCalls>0;
   assert.deepEqual(input.tools.map(x=>x.name),baseline?['complete_candidate','unresolved']:later?['fragment','complete_candidate','experiment','unresolved']:['fragment','unresolved']);calls++;
   const name=baseline?'complete_candidate':repair?(repairCalls===0?'fragment':repairCalls===1?'experiment':'complete_candidate'):'unresolved';
   const args=baseline?{source:decodedFields,explanation:'A complete candidate for independent acceptance.'}:!repair?{reason:'Fixture cannot establish a complete parser.'}:repairCalls===1?
    {input_hex:'610a',first_chunk_bytes:1,chunk_bytes:1,finalize:true,reason:'Check record termination at final input.'}:
    {source:repairCalls===0?bufferUntilEOF:emitFinalRecord,explanation:'Provider fixture proposes source; the real evaluator decides acceptance.'};
   if(repair){assert.match(body,/EOF_POLICY = 'emit'/);assert.match(body,/unfinished record is emitted at EOF/);}
   if(repair&&repairCalls===2){assert.match(body,/earlier required check FAILED/);assert.match(body,/Hex bytes: 610a/);}
   if(repair)repairCalls++;
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'completed',error:null,output:[{type:'function_call',status:'completed',call_id:'fixture-id',name,arguments:JSON.stringify(args)}]}));
  }catch(error){providerErrors.push(error.message);res.writeHead(500);res.end(error.message);}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 let stopped;
 for(let budget=1;budget<=8;budget++){
  const candidate=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1','--max-quanta',String(budget)]);
  assert.equal(candidate.spent.models,0);
  if(candidate.resume?.control==='reply'){stopped=candidate;break;}
 }
 assert(stopped,'a bounded stop must expose the completed reference reply');
 assert.equal(stopped.status,'unresolved');assert.equal(stopped.reason,'work-allowance');assert.equal(stopped.resume.control,'reply');assert.ok(stopped.resume.value.length>0);
 // A fresh World instance consumes the saved real reference result. The next
 // request must be the model, never a repeated reference operation.
 const selected=verifyRuntime(runtime),world=await import(pathToFileURL(selected.entrypoint));
 const kernel=await createParserKernel(world.Kernel, {bytes:await readFile(selected.kernelPath),expectedSha256:selected.kernelSha256,instanceId:999n});
 const program=kernel.prepare(await readFile(join(cwd,'examples/parser-construction/program.bpi3')));
 const session=kernel.restore(program,Buffer.from(stopped.state,'base64'));kernel.releasePrepared(program);
 let next=world.decodeOutcome(kernel.drive(session,{control:stopped.resume.control,value:Buffer.from(stopped.resume.value,'base64'),quantum:100,checkpoint:true}));
 for(let i=0;next.kind==='progressed'&&i<8;i++)next=world.decodeOutcome(kernel.drive(session,{quantum:100,checkpoint:true}));
 assert.equal(next.kind,'requested');assert.equal((await world.decodeRequest(next.request)).semanticIdentity,'agent.model.invoke.v3');
 kernel.checkpoint(session,{transfer:true});assert.equal(kernel.usage().workingLive,0n);
 const result=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1']);
 assert.equal(calls,1);assert.equal(result.status,'unresolved');assert.equal(result.spent.models,1);assert.equal(result.spent.checks,0);assert.equal(result.paidAuthorization,false);assert.equal(result.result.tag,3);
 repair=true;
 const completed=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','3','--max-checks','3','--eof-policy','ask'],240000,'2\n');
 assert.equal(calls,4);assert.equal(completed.status,'validated-artifact',JSON.stringify({completed,providerErrors}));assert.equal(completed.spent.models,3);assert.equal(completed.spent.checks,3);
 assert.equal(completed.result.tag,4);assert.equal(completed.result.value.tag,4);assert.equal(completed.result.value.value[0][2],emitFinalRecord);
 assert.deepEqual(completed.observations.map(({kind,passed})=>[kind,passed]),[['probe',false],['probe',true],['assessment',true]]);
 assert.equal(completed.metrics.physicalExecutions,540);assert.equal(completed.paidAuthorization,false);
 assert.equal(completed.spent.questions,1);
 assert.equal(completed.result.value.value[2][4],'agent.incremental-byte-parser-emit-eof/v1');
 assert.ok(completed.spent.contextBytes>0);
 assert.ok(completed.spent.modelRequestBytes>=completed.spent.contextBytes);
 assert.ok(completed.spent.modelReplyBytes>0);
 repair=false;
 const clarified=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1','--eof-policy','ask'],30000,'2\n');
 assert.equal(clarified.status,'unresolved');assert.equal(clarified.spent.questions,1);assert.equal(clarified.spent.models,1);
 const unsure=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1','--eof-policy','ask'],30000,'unsure\n');
 assert.equal(unsure.status,'unresolved');assert.equal(unsure.spent.questions,1);assert.equal(unsure.spent.models,0);
 const closed=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1','--eof-policy','ask'],30000,'');
 assert.equal(closed.status,'unresolved');assert.equal(closed.spent.questions,1);assert.equal(closed.spent.models,0);
 baseline=true;const before=calls;
 const direct=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1','--strategy','react'],240000);
 assert.equal(calls,before+1);assert.equal(direct.strategy,'react');assert.equal(direct.status,'validated-artifact',JSON.stringify({direct,providerErrors}));assert.equal(direct.spent.models,1);assert.equal(direct.spent.checks,1);assert.equal(direct.result.value.value[0][2],decodedFields);
});

test('packaged selection uses one shared call allowance across both constructions',{timeout:360000},async t=>{
 const area=await mkdtemp(join(tmpdir(),'parser-cli-selection-'));t.after(()=>rm(area,{recursive:true,force:true}));
 execFileSync('tar',['-xzf',resolve('zig-out/agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz'),'-C',area]);
 const cwd=join(area,(await readdir(area))[0]);
 for(const policy of ['first','last']){const zero=await run(cwd,['--selection',policy]);assert.equal(zero.selection,policy);assert.equal(zero.status,'unresolved');assert.equal(zero.spent.models,0);}
 if(process.platform!=='darwin')return;
 let calls=0,limited=true;
 const server=createServer(async(req,res)=>{
  try{
   assert.equal(req.headers.authorization,undefined);let body='';for await(const chunk of req)body+=chunk;
   const input=JSON.parse(body);assert.equal(input.model,'fixture-model');calls++;
   const fragment=calls%2===1;
   const name=limited?'unresolved':fragment?'fragment':'complete_candidate';
   const args=limited?{reason:'No complete contribution.'}:{source:calls===1?bufferUntilEOF:calls===2?decodedFields:rawRecords,explanation:'The independent evaluator decides acceptance.'};
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'completed',error:null,output:[{type:'function_call',status:'completed',call_id:'same-provider-id',name,arguments:JSON.stringify(args)}]}));
  }catch(error){res.writeHead(500);res.end(error.message);}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const args=['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--selection','last'];
 const stopped=await run(cwd,[...args,'--max-model-calls','1','--max-checks','1']);
 assert.equal(calls,1);assert.equal(stopped.spent.models,1);assert.equal(stopped.status,'unresolved');assert.equal(stopped.reason,'model-call-allowance');
 calls=0;limited=false;
 const selected=await run(cwd,[...args,'--max-model-calls','4','--max-checks','4'],330000);
 assert.equal(calls,4);assert.equal(selected.selection,'last');assert.equal(selected.status,'validated-artifact',JSON.stringify(selected));assert.equal(selected.spent.models,4);assert.equal(selected.spent.checks,4);
 assert.deepEqual(selected.observations.map(({kind,passed})=>[kind,passed]),[['probe',false],['assessment',true],['probe',true],['assessment',true]]);
 assert.equal(selected.result.value.value[0][2],rawRecords);assert.equal(selected.paidAuthorization,false);assert.equal(selected.metrics.physicalExecutions,1078);
});
