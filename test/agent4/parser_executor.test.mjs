import assert from 'node:assert/strict';
import { createParserExecutor } from '../../runtime/parser_executor.mjs';
import * as candidates from '../consumers/incremental-parser/candidates.mjs';
const executor = await createParserExecutor();
assert.equal(executor.kind, 'qualified', JSON.stringify(executor));
const results = [];
for (const [name, expected] of [['decodedFields',true], ['rawRecords',true], ['fixedTable',true], ['lazyTable',true],
  ['rejectAll',false], ['bufferUntilEOF',false], ['wrongOffset',false], ['globalState',false], ['keepsHistory',false]]) {
  const result = await executor.validate(candidates[name]);
  assert.equal(result.passed, expected, `${name}: ${JSON.stringify(result.checks.find(c=>!c.passed) ?? result.retention)}`);
  results.push({name,passed:result.passed,required:result.required,executed:result.executed,
    failures:result.checks.find(c=>!c.passed)?.failures,
    retention:result.retention.map(r=>({name:r.name,passed:r.passed,baseline:r.baseline,peak:r.peak,growth:r.growth}))});
  console.log(JSON.stringify(results.at(-1)));
}
console.log(JSON.stringify({runner:executor.runner,metrics:executor.metrics(),results}));
