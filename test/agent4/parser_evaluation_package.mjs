import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {rejectAll} from '../consumers/incremental-parser/candidates.mjs';
const area=await mkdtemp(join(tmpdir(),'parser-evaluation-package-'));
try {
  execFileSync('tar',['-xzf',resolve('zig-out/agent4-release/agent-v4.0.0-dev.0-resumable-interactions-v1.tar.gz'),'-C',area]);
  const cwd=join(area,(await readdir(area))[0]),candidate=join(area,'candidate.mjs');
  await writeFile(candidate,rejectAll);
  const run=spawnSync(process.execPath,['runtime/parser_evaluation.mjs','--candidate',candidate],{cwd,encoding:'utf8',timeout:30000,maxBuffer:1<<20});
  assert.equal(run.status,1,run.stderr);
  const result=JSON.parse(run.stdout);assert.equal(result.status,'rejected');assert.equal(result.evaluation.split,'heldout');
  assert.equal(result.sourceDigest,createHash('sha256').update(rejectAll).digest('hex'));
  assert.equal(result.evaluation.reservedInputs,491);assert.equal(result.executed,1);assert.equal(result.required,559);
  console.log(JSON.stringify({extracted:true,...result}));
}finally{await rm(area,{recursive:true,force:true});}
