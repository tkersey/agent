import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const executable=process.argv[2];
assert.ok(executable);
for(const mode of ['producer-drop','producer-duplicate']) {
  const result=spawnSync(executable,[mode],{encoding:'utf8',maxBuffer:1<<20});
  assert.ifError(result.error);
  assert.notEqual(result.status,0,`${mode} must not compile`);
  assert.equal(result.stdout,'','a rejected owner must not publish an object');
  assert.match(result.stderr,/error: (InvalidOwnership|UnavailableSlot)/);
  console.log(`${mode}: ${result.stderr.split('\n')[0]}`);
}
