// Link and execute from objects/use archive with authoring and emitter roots denied.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp,readdir,mkdir,cp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
assert.equal(process.platform,'darwin','this source-denial witness requires macOS sandbox-exec');
const source=await realpath(resolve(import.meta.dirname,'../..'));
const runtime=resolve(process.argv[2]??'.agent4-multishot/out/world-runtime');
assert(process.argv[3],'native World invocation tool is required');
const native=resolve(process.argv[3]);
const area=await mkdtemp(join(tmpdir(),'parser-source-free-'));
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
 execFileSync('tar',['-xzf',join(source,'zig-out/agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz'),'-C',area]);
 const root=join(area,(await readdir(area))[0]),objects=join(root,'objects');await mkdir(objects);
 await cp(join(source,'zig-out/bin/link-parser'),join(root,'link-parser'));
 await cp(runtime,join(area,'world-runtime'),{recursive:true});
 await cp(native,join(root,'world-invoke'));
 const fixture=join(root,'zig-out/agent4/parser-construction');await mkdir(fixture,{recursive:true});
 for(const name of ['producer.bmo1','consumer.bmo1','consumer-alt.bmo1','reference.bmo1','input-schema.bin','result-schema.bin','model-schema.bin','model-template.bin']){
  await cp(join(source,'zig-out/agent4/parser-construction',name),join(fixture,name));
  if(name.endsWith('.bmo1'))await cp(join(fixture,name),join(objects,name));
 }
 await cp(join(source,'test/agent4/parser_comparison.mjs'),join(root,'test/agent4/parser_comparison.mjs'));
 await mkdir(join(root,'test/consumers/incremental-parser'),{recursive:true});
 await cp(join(source,'test/consumers/incremental-parser/candidates.mjs'),join(root,'test/consumers/incremental-parser/candidates.mjs'));
 const forbidden=join(source,'test/consumers/incremental-parser/main.zig');
 await readFile(forbidden); // Ensure denial is not merely a missing-file result.
 const profile=`(version 1) (allow default) (deny file-read* (subpath ${JSON.stringify(source)})) (deny process-exec (subpath ${JSON.stringify(source)}))`;
 const denied=spawnSync('/usr/bin/sandbox-exec',['-p',profile,'/bin/cat',forbidden],{cwd:root,encoding:'utf8'});
 assert.notEqual(denied.status,0);assert.match(denied.stderr,/not permitted|denied/i);
 const producerBefore=hash(await readFile(join(objects,'producer.bmo1'))),runs=[];
 for(const [consumer,strategy,image]of [['consumer.bmo1','recursive','program.bpi3'],['consumer-alt.bmo1','alternate','alternate.bpi3']]){
  const linked=spawnSync('/usr/bin/sandbox-exec',['-p',profile,join(root,'link-parser'),join(objects,'producer.bmo1'),join(objects,consumer),join(objects,'reference.bmo1')],{cwd:root,maxBuffer:16<<20});
  assert.equal(linked.status,0,linked.stderr.toString());assert(linked.stdout.length>0);
  await writeFile(join(fixture,image),linked.stdout);
  const run=spawnSync(process.execPath,['test/agent4/parser_comparison.mjs',join(area,'world-runtime'),strategy,'consumer-partial',join(root,'world-invoke'),source,'file'],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1<<20});
  assert.equal(run.status,0,run.stderr);runs.push(JSON.parse(run.stdout));
 }
 assert.equal(hash(await readFile(join(objects,'producer.bmo1'))),producerBefore);
 console.log(JSON.stringify({sourceDenied:true,producer:producerBefore,linkOnlyExecutable:true,runs}));
}finally{await rm(area,{recursive:true,force:true});}
