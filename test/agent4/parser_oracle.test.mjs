import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBatch } from '../../fixtures/incremental-parser-v1/batch.mjs';
import { observations, mandatoryTraces, admitTrace, traceIdentity, contractFor } from '../../runtime/parser_oracle.mjs';
const bytes = text => [...Buffer.from(text)];

test('selected EOF meanings differ only at a non-escaped unfinished final record',()=>{
  const trace=[{chunk:[97,10,98,44],endOfInput:true},{chunk:[],endOfInput:true}];
  assert.deepEqual(observations(trace,'emit'),[
    {newly_completed_records:[[[97]],[[98],[]]],status:'complete'},
    {newly_completed_records:[],status:'complete'},
  ]);
  assert.equal(observations(trace)[0].error.code,'UnterminatedRecord');
  for(const chunk of [[],[10],[92],[92,120],[97,10,92]])
    assert.deepEqual(observations([{chunk,endOfInput:true}],'emit'),observations([{chunk,endOfInput:true}],'strict'));
  assert.notEqual(contractFor('strict'),contractFor('emit'));
  assert.notEqual(traceIdentity(trace,'strict'),traceIdentity(trace,'emit'));
  assert.throws(()=>contractFor('unknown'),TypeError);
});

test('batch meaning preserves bytes, escapes, empty fields and prefix records', () => {
  assert.deepEqual(parseBatch([]), { records: [], status: 'complete' });
  assert.deepEqual(parseBatch([10]), { records: [[[]]], status: 'complete' });
  assert.deepEqual(parseBatch(bytes('a\\,b,\\n,\\\\\r\n')), {
    records: [[bytes('a,b'), [10], [92, 13]]], status: 'complete',
  });
  assert.deepEqual(parseBatch([255, 0, 10, 92, 120, 10]), {
    records: [[[255, 0]]], status: 'failed', error: { code: 'InvalidEscape', offset: 4 },
  });
  assert.deepEqual(parseBatch(bytes('a\n\\')), {
    records: [[[97]]], status: 'failed', error: { code: 'DanglingEscape', offset: 2 },
  });
  assert.deepEqual(parseBatch(bytes('a\nb')), {
    records: [[[97]]], status: 'failed', error: { code: 'UnterminatedRecord', offset: 3 },
  });
});

test('feed observations include immediate emission, split escapes and closed calls', () => {
  const trace = [{ chunk: [97, 10, 92], endOfInput: false },
    { chunk: [], endOfInput: false }, { chunk: [110, 10], endOfInput: true },
    { chunk: [98, 10], endOfInput: false }];
  assert.deepEqual(observations(trace), [
    { newly_completed_records: [[[97]]], status: 'open' },
    { newly_completed_records: [], status: 'open' },
    { newly_completed_records: [[[10]]], status: 'complete' },
    { newly_completed_records: [], status: 'complete' },
  ]);
});

test('finite generated partitions preserve final batch observations and error offsets', () => {
  const cases = mandatoryTraces();
  assert.ok(cases.length > 400);
  assert.deepEqual(cases, mandatoryTraces());
  for (const { trace } of cases) {
    const final = trace.findIndex(call => call.endOfInput);
    const expected = parseBatch(trace.slice(0, final + 1).flatMap(call => call.chunk));
    const rows = observations(trace);
    assert.deepEqual(rows.flatMap(row => row.newly_completed_records), expected.records);
    assert.equal(rows.at(-1).status, expected.status);
    assert.deepEqual(rows.at(-1).error, expected.error);
  }
});

test('trace admission rejects malformed data before any execution', () => {
  for (const trace of [[], [{ chunk: [256], endOfInput: true }],
    [{ chunk: [1], endOfInput: 1 }], [{ chunk: [], endOfInput: true, extra: 0 }]])
    assert.throws(() => admitTrace(trace), TypeError);
  assert.notEqual(traceIdentity([{ chunk: [], endOfInput: true }]),
    traceIdentity([{ chunk: [], endOfInput: false }]));
});

test('reserved evaluation inputs are disjoint and immutable while mandatory cases remain',async()=>{
  const {evaluationPlan}=await import('../../runtime/parser_oracle.mjs');
  const development=evaluationPlan(),heldout=evaluationPlan('heldout');
  assert.deepEqual(development.traces,mandatoryTraces());
  assert.notEqual(development.metadata.traceDigest,heldout.metadata.traceDigest);
  assert.equal(development.metadata.required,536);
  const anchors=development.traces.filter(row=>Number(row.name.split('-')[1])<15);
  assert.deepEqual(heldout.traces.slice(0,anchors.length),anchors);
  const seen=new Set(development.traces.map(row=>JSON.stringify(row.trace)));
  const reserved=heldout.traces.slice(anchors.length);assert(reserved.length>0);
  for(const row of reserved){const key=JSON.stringify(row.trace);assert(!seen.has(key));seen.add(key);}
  assert.equal(reserved.length,heldout.metadata.reservedInputs);
  assert.throws(()=>heldout.traces[0].trace[0].chunk.push(7),TypeError);
  assert.throws(()=>{heldout.metadata.seed=0;},TypeError);
  assert.throws(()=>evaluationPlan('unknown'),TypeError);
});
