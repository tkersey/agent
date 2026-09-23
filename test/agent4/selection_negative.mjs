import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [executable,object]=process.argv.slice(2);
const result=spawnSync(executable,['smuggle',object],{encoding:'utf8',maxBuffer:1<<20});
assert.ifError(result.error);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
assert.match(result.stderr,/error: SpeculativeEffect/);
console.log('indirect completion authority in assessment: rejected');
