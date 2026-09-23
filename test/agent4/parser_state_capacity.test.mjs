import assert from 'node:assert/strict';
import {createParserExecutor} from '../../runtime/parser_executor.mjs';
const executor=await createParserExecutor();assert.equal(executor.kind,'qualified',JSON.stringify(executor));
const trace=[{chunk:[],endOfInput:true}];
const sources={
 oversizedInitial:"export const initial=()=> 'x'.repeat(131073);export const step=()=>({next_state:{},newly_completed_records:[],status:'complete'});",
 exactInitial:"export const initial=()=> 'x'.repeat(131070);export const step=()=>({next_state:{},newly_completed_records:[],status:'complete'});",
 oversizedStep:"export const initial=()=>({});export const step=()=>({next_state:'x'.repeat(131073),newly_completed_records:[],status:'complete'});",
 exactStep:"export const initial=()=>({});export const step=()=>({next_state:'x'.repeat(131070),newly_completed_records:[],status:'complete'});",
 fixedTable:"export const initial=()=>({lookup:'x'.repeat(3072)});export const step=s=>({next_state:s,newly_completed_records:[],status:'complete'});",
};
const results=[];
for(const [name,source]of Object.entries(sources)){
 const result=await executor.probe(source,trace),oversized=name.startsWith('oversized');
 assert.equal(result.kind,oversized?'execution_failed':'completed',name);
 assert.equal(result.passed,!oversized,name);
 if(name==='exactStep')assert.equal(result.rows[0].stateBytes,131072);
 results.push({name,kind:result.kind,passed:result.passed});
}
console.log(JSON.stringify({results,metrics:executor.metrics()}));
