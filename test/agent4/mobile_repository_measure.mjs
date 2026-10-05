// Serial, paired mechanics comparison. Live providers and human dwell are absent.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, platform, release, arch } from 'node:os';
import { repositoryFixture } from './repository_application_fixture.mjs';
import { comparisonProfile } from './repository_comparison.mjs';
import { hash } from '../../runtime/mobility/protocol.mjs';

const workloads = {
  base: { repositoryBytes: 64, extraReads: 0, replayPaddingBytes: 0 },
  repository: { repositoryBytes: 65536, extraReads: 0, replayPaddingBytes: 0 },
  reads: { repositoryBytes: 64, extraReads: 3, replayPaddingBytes: 0 },
  checkpoint: { repositoryBytes: 64, extraReads: 0, replayPaddingBytes: 16384 },
};
const networks = { local: { latencyMs: 0, bytesPerSecond: Infinity }, metro: { latencyMs: 5, bytesPerSecond: 10 << 20 }, wide: { latencyMs: 25, bytesPerSecond: 1 << 20 } };
async function bytesAt(path) {
  const stat = await lstat(path); if (!stat.isDirectory()) return stat.size;
  let sum = 0; for (const entry of await readdir(path)) sum += await bytesAt(join(path, entry)); return sum;
}
async function sample(topology, cache, workload, network) {
  const cleanup = [], t = { after: fn => cleanup.push(fn), diagnostic() {} };
  const comparison = comparisonProfile(t, { topology, workload: workloads[workload], ...networks[network] });
  try {
    const f = await repositoryFixture(t, { mobile: true, mode: 1, comparison });
    if (cache === 'warm') { assert.equal((await f.run()).kind, 'terminal'); comparison.result(); await f.registerFresh(); }
    assert.equal((await f.run()).kind, 'terminal');
    const measured = comparison.result(), report = f.outcome(), proposal = JSON.parse(report[5]);
    comparison.assertStationary(f.id);
    assert.equal(report[2], 1); assert.equal(f.modelCalls, 3 + workloads[workload].extraReads); assert.equal(f.counts.check, 1);
    assert.equal(f.modelAllowance().used.attempts, f.modelCalls); assert.equal(f.checkAllowance().used.attempts, 1);
    assert.equal(f.counts.publish, 0); assert.equal(f.cleanupCalls, 1); assert.equal(await f.store.current(), f.base);
    assert.equal(f.moves.length, topology === 'mobile' ? 2 : 0); assert.equal(measured.endingWorkingLiveBytes, 0);
    if (cache === 'warm') assert.equal(measured.traffic.image, 0);
    assert.equal(proposal.core.validation[0].status, 'Passed');
    assert.deepEqual(proposal.core.diff.map(row => [row.path,row.operation,row.oldContent,row.newContent]), [['fix.txt','replace','before\n','independently checked\n']]);
    return { status: 'pass', topology, cache, workload, network, ...measured, imageBytes: f.image.length, imageSha256: hash(f.image), taskSha256: hash(f.initialArgs), base: f.base,
      patchSha256: hash(Buffer.from(JSON.stringify(proposal.core.diff))), modelCalls: f.modelCalls, checks: f.counts.check, humanResponses: f.counts.human,
      allowances: { model: f.modelAllowance().limit, check: f.checkAllowance().limit },
      retainedApparentBytes: { managed: await bytesAt(join(f.root,'managed')), U: await bytesAt(join(f.root,'U')), W: await bytesAt(join(f.root,'W')) },
      processMemoryAtEnd: process.memoryUsage(), processResourceUsage: process.resourceUsage(), runtime: { kernel: f.identity.kernelSha256, inventory: f.identity.inventorySha256 } };
  } catch (error) { return { status: 'fail', topology, cache, workload, network, error: { code: error.code ?? error.name, message: error.message } }; }
  finally { for (const close of cleanup.reverse()) await close(); }
}
if (process.argv[2] === '--sample') console.log(JSON.stringify(await sample(...process.argv.slice(3))));
else {
  const output = process.argv[2], pairs = Number(process.argv[3] ?? 30); assert(output && Number.isInteger(pairs) && pairs >= 30 && pairs <= 100, 'usage: mobile_repository_measure.mjs OUTPUT.json [PAIRS>=30]');
  const cells = [];
  for (const cache of ['cold','warm']) for (const network of Object.keys(networks)) cells.push({ cache, network, workload: 'base' });
  for (const workload of ['repository','reads','checkpoint']) cells.push({ cache:'warm',network:'local',workload });
  const root = resolve(import.meta.dirname,'../..');
  const report = { format:'mobile-repository-comparison/v1', sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    measurementSources: Object.fromEntries(await Promise.all(['repository_application_fixture.mjs','repository_comparison.mjs','mobile_repository_measure.mjs'].map(async name => [name,hash(await readFile(join(import.meta.dirname,name)))]))),
    environment:{ node:process.version,platform:platform(),release:release(),arch:arch(),cpu:cpus()[0].model }, pairs, warmupPairs:2, workloads,
    networks:JSON.parse(JSON.stringify(networks,(_,value)=>value===Infinity?'unlimited':value)),
    method: { mode:'propose', origin:'Node WASM custodian; browser execution measured separately', transport:'real local mutual TLS; emulated serial service delay after each completed RPC using observed application-protocol bytes and request count',
      bytes:'application bodies plus mobility protocol header; HTTP/TLS framing excluded equally', timing:'from signed run registration through terminal report; process start, provisioning, certificates, module import, compilation and teardown excluded; first connection TLS setup included',
      cache:'cold=fresh journals and image store; warm=second fresh run after a complete task in the same journals; runtime/JIT and retained history effects are not isolated from image caching',
      authority:'distinct signed policy revisions; stationary proxy rechecks the U journal and policy in process before W I/O, preserves the exact typed request, and charges cumulative delegated allowances at U; no W run owner',
      dwell:'deterministic unattended human replies; no actual-person dwell or provider latency', quantiles:'nearest rank ceil(q*n)-1; descriptive p95, not a precise tail guarantee',
      metrics:'instrumented spans can nest and must not be added as independent phases; kernel live memory sampled at method boundaries; storage is apparent retained file bytes',
      ordering:'two unreported-distribution warmup pairs per cell retained below; then 30+ pairs, alternating topology order; all processes and attempts retained',
      limitations:['single machine','no WAN claim','no live-model quality claim','30-sample tails are descriptive','no speedup inferred for the complete browser/person workflow'] }, rows:[], summary:[] };
  const childEnv={...process.env};for(const name of ['NODE_TEST_CONTEXT','AGENT_MOBILE_NATIVE','AGENT_MOBILE_PACKAGE','AGENT_MOBILITY_BROWSER_TOOLS'])delete childEnv[name];
  for (let iteration=-2;iteration<pairs;iteration++) for (const cell of cells) {
    const pair=[];
    for (const topology of iteration%2===0?['mobile','stationary']:['stationary','mobile']) {
      const child=spawnSync(process.execPath,[import.meta.filename,'--sample',topology,cell.cache,cell.workload,cell.network],{env:childEnv,encoding:'utf8',timeout:120000,maxBuffer:8<<20});
      let row;try { assert.equal(child.status,0,child.stderr);row=JSON.parse(child.stdout); } catch(error){row={status:'fail',topology,...cell,error:{code:child.error?.code??'SampleProcessFailed',message:String(child.stderr||error.message).slice(0,4096)}};}
      row.iteration=iteration;row.warmup=iteration<0;report.rows.push(row);pair.push(row);
      await writeFile(output,JSON.stringify(report,null,2)+'\n');
    }
    if(pair.every(row=>row.status==='pass')) for(const key of ['imageSha256','taskSha256','base','patchSha256','modelCalls','checks','humanResponses','allowances','leafTrace']) {
      try { assert.deepEqual(pair[0][key],pair[1][key]); } catch { for(const row of pair){row.status='fail';row.error={code:'UnmatchedWorkload',message:key};} }
    }
    await writeFile(output,JSON.stringify(report,null,2)+'\n');console.error(`pair ${iteration+1}/${pairs} ${cell.workload}/${cell.cache}/${cell.network}: ${pair.map(row=>row.status).join('/')}`);
  }
  const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*q)-1)];
  const stats=values=>values.length?{n:values.length,p50:quantile(values,.5),p95:quantile(values,.95),min:Math.min(...values),max:Math.max(...values)}:null;
  for(const cell of cells) {
    const rows=report.rows.filter(row=>!row.warmup&&Object.keys(cell).every(key=>row[key]===cell[key]));
    const summaries=Object.fromEntries(['mobile','stationary'].map(topology=>{const values=rows.filter(row=>row.topology===topology&&row.status==='pass');return [topology,{attempts:rows.filter(row=>row.topology===topology).length,failures:rows.filter(row=>row.topology===topology&&row.status!=='pass').length,elapsedMs:stats(values.map(row=>row.elapsedMs)),protocolBytes:stats(values.map(row=>row.traffic.body+row.traffic.metadata))}];}));
    const differences=[];for(let i=0;i<pairs;i++){const pair=rows.filter(row=>row.iteration===i);if(pair.length===2&&pair.every(row=>row.status==='pass'))differences.push(pair.find(row=>row.topology==='mobile').elapsedMs-pair.find(row=>row.topology==='stationary').elapsedMs);}
    report.summary.push({...cell,...summaries,pairedMobileMinusStationaryMs:stats(differences)});
  }
  report.complete=report.rows.length===(pairs+2)*cells.length*2&&report.rows.every(row=>row.status==='pass');await writeFile(output,JSON.stringify(report,null,2)+'\n');
  if(!report.complete)process.exitCode=1;
}
