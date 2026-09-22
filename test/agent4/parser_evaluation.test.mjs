import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createParserExecutor} from '../../runtime/parser_executor.mjs';
import {createParserTools} from '../../runtime/parser_tools.mjs';
import {evaluationOptions,evaluateCandidateFile} from '../../runtime/parser_evaluation.mjs';
import {rejectAll,decodedFields,rawRecords} from '../consumers/incremental-parser/candidates.mjs';
const development=await createParserExecutor(),heldout=await createParserExecutor({evaluation:'heldout'});
assert.equal(development.kind,'qualified');assert.equal(heldout.kind,'qualified');
assert.notEqual(development.runner,heldout.runner);assert.notEqual(development.evaluation.traceDigest,heldout.evaluation.traceDigest);
const before=development.metrics().physicalExecutions;
await assert.rejects(()=>development.validate(rejectAll,{seed:1}),/fixed at executor construction/);
await assert.rejects(()=>development.validate(rejectAll,{evaluation:'heldout'}),/fixed at executor construction/);
assert.equal(development.metrics().physicalExecutions,before);
assert.throws(()=>{heldout.evaluation.seed=1;},TypeError);
const normal=await createParserTools(),reserved=await createParserTools({evaluation:'heldout'});
assert.equal(normal.kind,'qualified');assert.equal(reserved.kind,'qualified');
const subject=normal.subject('0'.repeat(64));
await assert.rejects(()=>reserved.reference([subject,1n,[[[],true]]]),/another reference, requirement or runner/);
assert.equal(reserved.metrics().physicalExecutions,0);
assert.throws(()=>evaluationOptions(['--candidate','x','--split','unknown']),TypeError);
assert.throws(()=>evaluationOptions(['--candidate','x','--seed','1']),TypeError);
const area=await mkdtemp(join(tmpdir(),'parser-heldout-'));
try {
 const results=[];
 for(const [name,source,status]of [['reject-all',rejectAll,'rejected'],['decoded-fields',decodedFields,'accepted'],['raw-records',rawRecords,'accepted']]){
  const path=join(area,name+'.mjs');await writeFile(path,source);
  const result=await evaluateCandidateFile(evaluationOptions(['--candidate',path]));
  assert.equal(result.status,status,JSON.stringify(result));assert.equal(result.evaluation.split,'heldout');
  assert.equal(result.runner,heldout.runner);results.push({name,...result});
 }
 console.log(JSON.stringify({bindingRejected:true,results}));
}finally{await rm(area,{recursive:true,force:true});}
