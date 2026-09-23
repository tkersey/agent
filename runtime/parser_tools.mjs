// Declared parser leaves only: no producer/consumer scheduling or target writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createParserExecutor, evaluationDisposition } from './parser_executor.mjs';
import { contractFor, observations, admitTrace, traceIdentity } from './parser_oracle.mjs';
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
  const eofPolicy = options.eofPolicy ?? 'strict';
  const parserContract = contractFor(eofPolicy);
  const executor = await createParserExecutor(options);
  if (executor.kind !== 'qualified') return executor;
  const source = await readFile(new URL('../fixtures/incremental-parser-v1/batch.mjs',import.meta.url),'utf8');
  assert(source.includes("export const EOF_POLICY = 'strict';"));
  const reference = Buffer.from(source.replace("export const EOF_POLICY = 'strict';",`export const EOF_POLICY = '${eofPolicy}';`));
  let requirements = await readFile(new URL('../fixtures/incremental-parser-v1/requirements.md',import.meta.url),'utf8');
  if(eofPolicy==='emit')requirements=requirements.replace('unfinished record fails as UnterminatedRecord at the end offset.','unfinished record is emitted at EOF as a final record.');
  requirements=Buffer.from(requirements);
  const expected = [hash(reference),hash(requirements),executor.runner,parserContract];
  function checkSubject(subject) {
    if (!Array.isArray(subject) || subject.length !== 5 || !digest(subject[0])) throw new TypeError('subject shape');
    assert.deepEqual(subject.slice(1),expected,'subject selects another reference, requirement or runner');
  }
  const tools={kind:'qualified',runner:executor.runner,evaluation:executor.evaluation,
    evidence:Object.freeze({reference:reference.toString('utf8'),requirements:requirements.toString('utf8')}),
    subject(base) { if(!digest(base))throw new TypeError('base digest');return [base,...expected]; },
    async reference(request) {
      if(!Array.isArray(request)||request.length!==3||!occurrence(request[1]))throw new TypeError('reference request');
      const [subject,id,encoded]=request;checkSubject(subject);
      const rows=observations(traceValue(encoded),eofPolicy);
      try { return [id,variant(0,rowsValue(rows))]; }
      catch(error) { if(error instanceof RangeError)return [id,variant(1,unavailable('capacity'))];throw error; }
    },
    async execute(request,{signal,probeOnly=false}={}) {
      if(!Array.isArray(request)||request.length!==4||!occurrence(request[1]))throw new TypeError('execution request');
      const [subject,id,candidate,check]=request;checkSubject(subject);
      if(!Array.isArray(candidate)||candidate.length!==3||typeof candidate[0]!=='string'||
        Buffer.byteLength(candidate[0])>8192||!occurrence(candidate[1])||
        ![0,1,0n,1n].includes(candidate[2])||!check||![0,1,2].includes(check.tag)||
        Object.keys(check).sort().join(',')!=='tag,value')throw new TypeError('candidate/check shape');
      const [source,version,complete]=candidate;
      if(probeOnly&&check.tag===1)return [id,version,variant(2,unavailable('invalid'))];
      if(check.tag===1 && (Number(complete)!==1||check.value!==null))return [id,version,variant(2,unavailable('invalid'))];
      let trace;
      try { trace=check.tag===0?traceValue(check.value):check.tag===2?traceValue(experimentTrace(check.value)):null; }
      catch(error) {
        if(error instanceof TypeError||error instanceof RangeError)
          return [id,version,variant(2,unavailable(error instanceof RangeError?'capacity':'invalid'))];
        throw error;
      }
      const result=trace?await executor.probe(source,trace,{signal}):await executor.validate(source,{signal});
      assert.equal(result.sourceDigest,hash(source));assert.equal(result.runner,executor.runner);
      assert.equal(result.acceptanceContract,parserContract);
      if(trace) {
        assert.equal(result.traceDigest,traceIdentity(trace,eofPolicy));
        if(result.kind!=='completed')return [id,version,variant(2,unavailable(result.kind))];
        const maximum = BigInt(Math.max(0,...result.rows.map(row=>row.stateBytes)));
        const failure = result.failures[0]?.reason ?? '';
        try { return [id,version,variant(0,[variant(1,rowsValue(result.rows)),result.passed,
          maximum,failure])]; }
        catch(error) {
          if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
          if (!result.passed) return [id,version,variant(0,[variant(0),false,maximum,
            ('candidate observations: '+error.message).slice(0,256)])];
          return [id,version,variant(2,unavailable(error instanceof RangeError?'capacity':'invalid'))];
        }
      }
      const disposition=evaluationDisposition(result);
      if(disposition.status==='unavailable')
        return [id,version,variant(2,unavailable(disposition.first?.kind??'unavailable'))];
      const first=disposition.first;
      const reason=first?`${first.name}: ${first.failures?.[0]?.reason??'retained state growth'}`:'';
      return [id,version,variant(1,[disposition.status==='accepted',result.executed,result.required,
        result.retention.length===2&&result.retention.every(item=>item.passed),reason.slice(0,256)])];
    },
    probe(request,options={}) { return tools.execute(request,{...options,probeOnly:true}); },
    metrics:executor.metrics,
  };
  return Object.freeze(tools);
}

/** Expand an untrusted flat model experiment into the existing typed trace.
 * No code runs here, and invalid/capacity cases never become empty experiments. */
export function experimentTrace(proposal) {
  if(!Array.isArray(proposal)||proposal.length!==5)throw new TypeError('experiment shape');
  const [hex,first,width,finalize,reason]=proposal;
  if(typeof hex!=='string'||hex.length>8192||hex.length%2||!/^([0-9a-fA-F]{2})*$/.test(hex)||
    !Number.isInteger(first)||first<0||first>0xffffffff||!Number.isInteger(width)||width<1||width>4096||
    typeof finalize!=='boolean'||typeof reason!=='string'||Buffer.byteLength(reason)>512)
    throw new TypeError('invalid experiment');
  const bytes=[...Buffer.from(hex,'hex')],trace=[];
  const cut=Math.min(first,bytes.length);
  trace.push([bytes.slice(0,cut),false]);
  for(let offset=cut;offset<bytes.length;offset+=width) {
    if(trace.length===64)throw new RangeError('experiment trace capacity');
    trace.push([bytes.slice(offset,offset+width),false]);
  }
  if(trace[0][0].length>4096)throw new RangeError('experiment chunk capacity');
  trace.at(-1)[1]=finalize;
  traceValue(trace);
  return trace;
}
