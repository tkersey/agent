// Declared parser leaves only: no producer/consumer scheduling or target writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createParserExecutor } from './parser_executor.mjs';
import { parserContract, observations, admitTrace, traceIdentity } from './parser_oracle.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const variant = (tag,value=null) => ({tag,value});
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const occurrence = value => typeof value === 'bigint' && value > 0n && value <= 0xffffffffffffffffn;
function traceValue(encoded) {
  if (!Array.isArray(encoded) || encoded.length > 64) throw new TypeError('trace call capacity');
  return admitTrace(encoded.map(row => {
    if (!Array.isArray(row) || row.length !== 2 || !Array.isArray(row[0]) || row[0].length > 4096)
      throw new TypeError('trace shape');
    return {chunk:row[0].map(x => typeof x === 'bigint' ? Number(x) : x),endOfInput:row[1]};
  }));
}
function rowsValue(rows) {
  const codes = {InvalidEscape:0,DanglingEscape:1,UnterminatedRecord:2};
  if(!Array.isArray(rows))throw new TypeError('observation rows');
  if(rows.length>64)throw new RangeError('observation capacity');
  for(const row of rows) {
    if(!row||!Array.isArray(row.newly_completed_records)||!['open','complete','failed'].includes(row.status))
      throw new TypeError('observation shape');
    if(row.newly_completed_records.length>256)throw new RangeError('record capacity');
    for(const record of row.newly_completed_records) {
      if(!Array.isArray(record))throw new TypeError('record shape');
      if(record.length>256)throw new RangeError('field capacity');
      for(const field of record) {
        if(!Array.isArray(field)||field.some(x=>!Number.isInteger(x)||x<0||x>255))throw new TypeError('field bytes');
        if(field.length>65536)throw new RangeError('field byte capacity');
      }
    }
    if(row.error && (!Object.hasOwn(codes,row.error.code)||!Number.isSafeInteger(row.error.offset)||row.error.offset<0))
      throw new TypeError('error shape');
  }
  return rows.map(row => [row.newly_completed_records.map(record => record.map(field => [...field])),
    {open:0,complete:1,failed:2}[row.status], row.error ? variant(1,[codes[row.error.code],BigInt(row.error.offset)]) : variant(0)]);
}
function unavailable(kind) {
  return {unavailable:0,invalid:1,timeout:2,cancelled:3,capacity:5}[kind] ?? 4;
}

export async function createParserTools(options = {}) {
  const executor = await createParserExecutor(options);
  if (executor.kind !== 'qualified') return executor;
  const reference = await readFile(new URL('../fixtures/incremental-parser-v1/batch.mjs',import.meta.url));
  const requirements = await readFile(new URL('../fixtures/incremental-parser-v1/requirements.md',import.meta.url));
  const expected = [hash(reference),hash(requirements),executor.runner,parserContract];
  function checkSubject(subject) {
    if (!Array.isArray(subject) || subject.length !== 5 || !digest(subject[0])) throw new TypeError('subject shape');
    assert.deepEqual(subject.slice(1),expected,'subject selects another reference, requirement or runner');
  }
  return Object.freeze({kind:'qualified',runner:executor.runner,
    evidence:Object.freeze({reference:reference.toString('utf8'),requirements:requirements.toString('utf8')}),
    subject(base) { if(!digest(base))throw new TypeError('base digest');return [base,...expected]; },
    async reference(request) {
      if(!Array.isArray(request)||request.length!==3||!occurrence(request[1]))throw new TypeError('reference request');
      const [subject,id,encoded]=request;checkSubject(subject);
      const rows=observations(traceValue(encoded));
      try { return [id,variant(0,rowsValue(rows))]; }
      catch(error) { if(error instanceof RangeError)return [id,variant(1,unavailable('capacity'))];throw error; }
    },
    async execute(request,{signal}={}) {
      if(!Array.isArray(request)||request.length!==4||!occurrence(request[1]))throw new TypeError('execution request');
      const [subject,id,candidate,check]=request;checkSubject(subject);
      if(!Array.isArray(candidate)||candidate.length!==3||typeof candidate[0]!=='string'||
        Buffer.byteLength(candidate[0])>8192||!occurrence(candidate[1])||
        ![0,1,0n,1n].includes(candidate[2])||!check||![0,1].includes(check.tag)||
        Object.keys(check).sort().join(',')!=='tag,value')throw new TypeError('candidate/check shape');
      const [source,version,complete]=candidate;
      if(check.tag===1 && (Number(complete)!==1||check.value!==null))return [id,version,variant(2,unavailable('invalid'))];
      const trace=check.tag===0?traceValue(check.value):null;
      const result=trace?await executor.probe(source,trace,{signal}):await executor.validate(source,{signal});
      assert.equal(result.sourceDigest,hash(source));assert.equal(result.runner,executor.runner);
      assert.equal(result.acceptanceContract,parserContract);
      if(trace) {
        assert.equal(result.traceDigest,traceIdentity(trace));
        if(result.kind!=='completed')return [id,version,variant(2,unavailable(result.kind))];
        try { return [id,version,variant(0,[rowsValue(result.rows),result.passed,
          BigInt(Math.max(0,...result.rows.map(row=>row.stateBytes)))])]; }
        catch(error) {
          if(error instanceof TypeError||error instanceof RangeError)
            return [id,version,variant(2,unavailable(error instanceof RangeError?'capacity':'invalid'))];
          throw error;
        }
      }
      const unavailableCheck=[...result.checks,...result.retention].find(item=>item.kind!=='completed');
      if(unavailableCheck)return [id,version,variant(2,unavailable(unavailableCheck.kind))];
      const first=result.checks.find(item=>!item.passed)??result.retention.find(item=>!item.passed);
      const reason=first?`${first.name}: ${first.failures?.[0]?.reason??'retained state'}`:'';
      return [id,version,variant(1,[result.passed,result.executed,result.required,
        result.retention.length===2&&result.retention.every(item=>item.passed),reason.slice(0,256)])];
    },
    metrics:executor.metrics,
  });
}
