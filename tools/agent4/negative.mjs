import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { verifyBoundary } from './dependencies.mjs';
const root=resolve(import.meta.dirname,'../..');
const [boundary,kind,zig,...rest]=process.argv.slice(2);
assert(boundary && ['source','package'].includes(kind) && zig && !rest.length,
  'usage: negative.mjs BOUNDARY source|package ZIG');
const options=kind==='source'?{sourceRoot:boundary}:{packageRoot:boundary};
const before=verifyBoundary(options);
const cache=join(root,'.agent4/cache/negative');
mkdirSync(cache,{recursive:true});
const cases=[
 ['model_runtime_callback',"Agent model declaration has unknown field 'execute'"],
 ['model_unsupported_codec',"Agent model codec is unsupported for 'value'"],
 ['model_unknown_parameter',"agent model parameters contain unsupported field 'provider_magic'"],
 ['model_unknown_field',"agent.model unknown source field 'paramters'"],
 ['model_noncanonical_temperature','agent model temperature must be a canonical decimal from 0 through 2'],
 ['prompt_unknown_field',"agent.prompt.literal unknown source field 'contents'"],
 ['skill_unknown_field',"agent.skill unknown source field 'actons'"],
];
try {
  for(const [name,message] of cases){
    const args=['test','-fno-emit-bin','-OReleaseSafe','--dep','agent',
      '-Mroot='+join(root,`test/agent4/${name}.zig`),
      '-OReleaseSafe','--dep','boundary','--dep','boundary_data_v2','--dep','agent_contracts',
      '-Magent='+join(root,'src/agent4.zig'),
      '-OReleaseSafe','--dep','boundary_data_v2','-Mboundary='+join(boundary,'src/v2/root.zig'),
      '-OReleaseSafe','-Mboundary_data_v2='+join(boundary,'src/v2/data/root.zig'),
      '-OReleaseSafe','--dep','boundary_data_v2','-Magent_contracts='+join(root,'src/contracts.zig'),
      '--cache-dir',join(cache,'local'),'--global-cache-dir',join(cache,'global')];
    const result=spawnSync(zig,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
    if(result.error)throw result.error;
    assert.notEqual(result.status,0,`${name} unexpectedly compiled`);
    assert(result.stderr.includes(message),`${name}: expected ${message}\n${result.stderr}`);
    console.log(`${name}: rejected at authoring admission`);
  }
} finally {assert.deepEqual(verifyBoundary(options),before);}
