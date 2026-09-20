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
import {bufferUntilEOF,decodedFields} from '../consumers/incremental-parser/candidates.mjs';
const runtime=resolve(process.env.AGENT4_WORLD_RUNTIME??'.agent4-recursive-integrated/out/world-runtime');
test('parser provider configuration is explicit and credentials are not implicit',()=>{
 assert.equal(parseParserOptions(['--world-runtime',runtime]).calls,0);
 const common=['--world-runtime',runtime,'--model','fixture','--max-model-calls','1','--data-policy','fixture-only'];
 assert.throws(()=>parseParserOptions([...common,'--endpoint','https://api.openai.com/v1/responses']),/allow-paid/);
 assert.throws(()=>parseParserOptions([...common,'--endpoint','http://127.0.0.1:1234','--key-env','TEST_KEY','--allow-paid']),/OpenAI Responses endpoint/);
 assert.throws(()=>parseParserOptions(['--world-runtime',runtime,'--max-model-calls','0','--allow-paid']),/positive call allowance/);
 assert.throws(()=>parseParserOptions([...common,'--endpoint','http://127.0.0.1:1234','--max-checks','17']),/out of range/);
 assert.throws(()=>parseParserOptions(['--world-runtime',runtime,'--unknown','x']),/unknown/);
});
async function run(cwd,args,timeout=30000){
 const child=spawn(process.execPath,['runtime/parser_cli.mjs','--world-runtime',runtime,...args],{cwd,stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 try{const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done);});assert.equal(code,0,error);return JSON.parse(output);}finally{clearTimeout(timer);}
}
test('extracted parser command uses the real provider adapter without paid inference',{timeout:300000},async t=>{
 const area=await mkdtemp(join(tmpdir(),'parser-cli-package-'));t.after(()=>rm(area,{recursive:true,force:true}));
 execFileSync('tar',['-xzf',resolve('zig-out/agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz'),'-C',area]);
 const cwd=join(area,(await readdir(area))[0]);
 const zero=await run(cwd,[]);assert.equal(zero.status,'unresolved');assert.equal(zero.spent.models,0);assert.equal(zero.spent.checks,0);
 if(process.platform!=='darwin')return;
 let calls=0,repair=false,repairCalls=0;
 const server=createServer(async(req,res)=>{
  try{
   assert.equal(req.headers.authorization,undefined);let body='';for await(const chunk of req)body+=chunk;
   const input=JSON.parse(body);assert.equal(input.model,'fixture-model');assert.match(body,/Frozen batch reference/);
   const later=repair&&repairCalls>0;
   assert.deepEqual(input.tools.map(x=>x.name),later?['fragment','complete_candidate','unresolved']:['fragment','unresolved']);calls++;
   const name=repair?(later?'complete_candidate':'fragment'):'unresolved';
   const args=repair?{source:later?decodedFields:bufferUntilEOF,explanation:'Provider fixture proposes source; the real evaluator decides acceptance.'}:{reason:'Fixture cannot establish a complete parser.'};
   if(repair)repairCalls++;
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'completed',error:null,output:[{type:'function_call',status:'completed',call_id:'fixture-id',name,arguments:JSON.stringify(args)}]}));
  }catch(error){res.writeHead(500);res.end(error.message);}
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
 const kernel=await world.Kernel.create({bytes:await readFile(selected.kernelPath),expectedSha256:selected.kernelSha256,instanceId:999n});
 const program=kernel.prepare(await readFile(join(cwd,'examples/parser-construction/program.bpi3')));
 const session=kernel.restore(program,Buffer.from(stopped.state,'base64'));kernel.releasePrepared(program);
 let next=world.decodeOutcome(kernel.drive(session,{control:stopped.resume.control,value:Buffer.from(stopped.resume.value,'base64'),quantum:100,checkpoint:true}));
 for(let i=0;next.kind==='progressed'&&i<8;i++)next=world.decodeOutcome(kernel.drive(session,{quantum:100,checkpoint:true}));
 assert.equal(next.kind,'requested');assert.equal((await world.decodeRequest(next.request)).semanticIdentity,'agent.model.invoke.v3');
 kernel.checkpoint(session,{transfer:true});assert.equal(kernel.usage().workingLive,0n);
 const result=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','1','--max-checks','1']);
 assert.equal(calls,1);assert.equal(result.status,'unresolved');assert.equal(result.spent.models,1);assert.equal(result.spent.checks,0);assert.equal(result.paidAuthorization,false);assert.equal(result.result.tag,3);
 repair=true;
 const completed=await run(cwd,['--endpoint',`http://127.0.0.1:${server.address().port}`,'--model','fixture-model','--data-policy','fixture-only','--max-model-calls','2','--max-checks','2'],240000);
 assert.equal(calls,3);assert.equal(completed.status,'validated-artifact');assert.equal(completed.spent.models,2);assert.equal(completed.spent.checks,2);
 assert.equal(completed.result.tag,4);assert.equal(completed.result.value.tag,4);assert.equal(completed.result.value.value[0][2],decodedFields);
 assert.equal(completed.metrics.physicalExecutions,539);assert.equal(completed.paidAuthorization,false);
 assert.ok(completed.spent.contextBytes>0);
 assert.ok(completed.spent.modelRequestBytes>=completed.spent.contextBytes);
 assert.ok(completed.spent.modelReplyBytes>0);
});
