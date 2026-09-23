import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluationDisposition,completedHistoryGrowth} from '../../runtime/parser_executor.mjs';
const good={kind:'completed',passed:true};
const rejected={name:'completed-history',kind:'completed',passed:false};
const timeout={name:'unfinished-field',kind:'timeout',passed:false};
const result=retention=>({required:1,checks:[good],retention});
test('a completed rejection survives later or earlier unavailable evidence',()=>{
 for(const rows of [[rejected,timeout],[timeout,rejected]]) {
  const actual=evaluationDisposition(result(rows));
  assert.equal(actual.status,'rejected');assert.equal(actual.first,rejected);
 }
});
test('acceptance requires every required check and both retention observations',()=>{
 assert.equal(evaluationDisposition(result([good,good])).status,'accepted');
 for(const partial of [result([good,timeout]),result([good]),{...result([good,good]),required:2},
  {required:0,checks:[],retention:[],passed:true}])
  assert.equal(evaluationDisposition(partial).status,'unavailable');
});
test('completed-history growth does not reject fixed initial state',()=>{
 for(const fixed of [0,3072,32768]) {
  const actual=completedHistoryGrowth([{stateBytes:fixed+90},{stateBytes:fixed+94}]);
  assert.equal(actual.growth,4);assert(actual.growth<=actual.maximumGrowth);
 }
 const accumulating=completedHistoryGrowth([{stateBytes:100},{stateBytes:5000}]);
 assert(accumulating.growth>accumulating.maximumGrowth);
});
