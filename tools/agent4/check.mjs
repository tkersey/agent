import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { withVerifiedDependencies } from './dependencies.mjs';

const root = resolve(import.meta.dirname, '../..');
const [mode, ...args] = process.argv.slice(2);
assert(['authoring', 'integration'].includes(mode), 'expected authoring or integration');
const flags = new Map([['--boundary-source','boundarySource'], ['--boundary-package','boundaryPackage'],
  ['--world-runtime','worldRuntime'], ['--world-source','worldSource'], ['--world-archive','worldArchive'],
  ['--fixtures','fixtures'], ['--native','native']]);
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
  AGENT4_INQUIRY_IMAGES:join(fixtures,'inquiry'),
  AGENT4_APPROVAL_IMAGE:join(fixtures,'approval/approval.bpi3'),
  AGENT4_APPROVAL_EVIDENCE_IMAGE:join(fixtures,'approval/approval-evidence.bpi3'),
  AGENT4_APPROVAL_SCOPED_IMAGE:join(fixtures,'approval/approval-scoped.bpi3'),
  AGENT4_APPROVAL_SCOPED_EVIDENCE_IMAGE:join(fixtures,'approval/approval-scoped-evidence.bpi3'),
  AGENT4_NATIVE:native,
  AGENT4_ARCHIVE:resolve(fixtures,'../agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz'),
  AGENT4_MULTI_INSPECTOR:resolve(fixtures,'../bin/agent4-multi')};
// Each requested test command owns a fresh runner, even when this build was
// launched by another node:test process.
delete env.NODE_TEST_CONTEXT;
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
      'test/agent4/document.test.mjs','test/agent4/review_runtime.mjs', 'test/agent4/package_commands.test.mjs',
      'test/agent4/consumer_build.test.mjs', 'test/agent4/inquiry_cli.test.mjs', 'test/agent4/parser_cli.test.mjs']);
    await run('node',['test/agent4/dialogue_runtime.test.mjs',options.worldRuntime,join(fixtures,'dialogue')]);
    await run('node',['test/agent4/multi_runtime.mjs']);
    await run('node',['test/agent4/document_runtime.mjs',options.worldRuntime,join(fixtures,'document/document.bpi3')]);
    await run('node',['test/agent4/consequence_runtime.mjs',options.worldRuntime,join(fixtures,'document/consequence.bpi3')]);
    await run('node',['test/agent4/independent.mjs',options.worldRuntime,fixtures]);
  }
  const output=join(root,'.agent4/out/checks');
  await mkdir(output,{recursive:true});
  const inquiryExecution = mode === 'authoring' ? {status:'not-requested'} : process.platform === 'darwin'
    ? {status:'passed',profile:'macos-seatbelt-session-v1'}
    : {status:'unavailable',reason:'unsupported_host',positiveExecutionCases:'not-run'};
  if(inquiryExecution.status==='unavailable') console.log(JSON.stringify({inquiryExecution}));
  await writeFile(join(output,`${mode}.json`),JSON.stringify({mode,dependencies,results,inquiryExecution},null,2)+'\n');
});
