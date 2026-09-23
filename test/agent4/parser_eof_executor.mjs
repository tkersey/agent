import assert from 'node:assert/strict';
import {createParserExecutor} from '../../runtime/parser_executor.mjs';
import {decodedFields,emitFinalRecord} from '../consumers/incremental-parser/candidates.mjs';
const strict=await createParserExecutor(),emit=await createParserExecutor({eofPolicy:'emit'});
assert.equal(strict.kind,'qualified');assert.equal(emit.kind,'qualified');assert.notEqual(strict.runner,emit.runner);
const trace=[{chunk:[97],endOfInput:true},{chunk:[],endOfInput:true}];
for(const[executor,candidate,expected]of [[strict,decodedFields,true],[strict,emitFinalRecord,false],[emit,decodedFields,false],[emit,emitFinalRecord,true]]){
 const result=await executor.probe(candidate,trace);assert.equal(result.passed,expected);
}
const accepted=await emit.validate(emitFinalRecord);assert.equal(accepted.passed,true,JSON.stringify(accepted.checks.find(x=>!x.passed)??accepted.retention));
console.log(JSON.stringify({check:'EOF policy discrimination and full alternate acceptance',required:accepted.required,executed:accepted.executed,strict:strict.metrics(),emit:emit.metrics()}));
