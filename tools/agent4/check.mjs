import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { withVerifiedDependencies } from './dependencies.mjs';

const root = resolve(import.meta.dirname, '../..');
const [mode, ...args] = process.argv.slice(2);
assert(['authoring', 'integration'].includes(mode), 'expected authoring or integration');
const flags = new Map([['--boundary-source','boundarySource'], ['--boundary-package','boundaryPackage'],
  ['--world-runtime','worldRuntime'], ['--world-source','worldSource'], ['--fixtures','fixtures'], ['--native','native']]);
const options = {}, seen = new Set();
for(let i=0;i<args.length;i++) {
  const key=flags.get(args[i]);
  assert(key && !seen.has(key) && args[i+1] && !args[i+1].startsWith('--'), `InvalidOption: ${args[i]}`);
  seen.add(key); options[key]=resolve(args[++i]);
}
const fixtures=options.fixtures ?? join(root,'.agent4/out');
delete options.fixtures;
const native=options.native;
delete options.native;
options.authoringOnly=mode==='authoring';
if(mode==='integration') assert(options.worldRuntime, '--world-runtime is required');
const env={...process.env, AGENT4_WORLD_RUNTIME:options.worldRuntime,
  AGENT4_FIXTURES:fixtures, AGENT4_DIALOGUE_DIR:join(fixtures,'dialogue'),
  AGENT4_REVIEW_IMAGES:join(fixtures,'review'),
  AGENT4_APPROVAL_IMAGE:join(fixtures,'approval/approval.bpi2'),
  AGENT4_APPROVAL_EVIDENCE_IMAGE:join(fixtures,'approval/approval-evidence.bpi2'),
  AGENT4_APPROVAL_SCOPED_IMAGE:join(fixtures,'approval/approval-scoped.bpi2'),
  AGENT4_NATIVE:native,
  AGENT4_MULTI_INSPECTOR:resolve(fixtures,'../bin/agent4-multi')};
const results=[];
async function run(command,argv,extra={}) {
  let output='';
  const child=spawn(command,argv,{cwd:root,env,stdio:['ignore','pipe','pipe'],...extra});
  child.stdout.on('data',data=>{output+=data;process.stdout.write(data);});
  child.stderr.on('data',data=>{output+=data;process.stderr.write(data);});
  const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done);});
  results.push({command:[command,...argv],exit:code});
  assert.equal(code,0,`${command} ${argv.join(' ')} failed`);
  return output;
}
await withVerifiedDependencies(options, async dependencies=>{
  if(mode==='authoring') {
    await run('node',['--test','test/agent4/values.test.mjs','test/agent4/model.test.mjs']);
  } else {
    await run('node',['--test','test/agent4/dependencies.test.mjs','test/agent4/setup.test.mjs',
      'test/agent4/bridge.test.mjs','test/agent4/runner.test.mjs','test/agent4/approval.test.mjs',
      'test/agent4/document.test.mjs','test/agent4/review_runtime.mjs']);
    await run('node',['test/agent4/dialogue_runtime.test.mjs',options.worldRuntime,join(fixtures,'dialogue')]);
    await run('node',['test/agent4/multi_runtime.mjs']);
    await run('node',['test/agent4/document_runtime.mjs',options.worldRuntime,join(fixtures,'document/document.bpi2')]);
    await run('node',['test/agent4/independent.mjs',options.worldRuntime,fixtures]);
  }
  const output=join(root,'.agent4/out/checks');
  await mkdir(output,{recursive:true});
  await writeFile(join(output,`${mode}.json`),JSON.stringify({mode,dependencies,results},null,2)+'\n');
});
