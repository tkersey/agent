// Supplemental attribution, not a second end-to-end speed comparison.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, platform, release, arch } from 'node:os';
import { repositoryFixture } from './repository_application_fixture.mjs';
import { comparisonProfile } from './repository_comparison.mjs';
import { serveBrowser } from '../../runtime/mobility/browser.mjs';
import { WorldAdmission } from '../../runtime/mobility/admission.mjs';
import { hash } from '../../runtime/mobility/protocol.mjs';

const output = process.argv[2], smoke = process.argv.includes('--smoke'), pairs = smoke ? 1 : 30;
assert(output && process.env.AGENT_MOBILITY_BROWSER_TOOLS, 'usage: mobile_repository_attribution.mjs OUTPUT.json [--smoke]');
const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.env.AGENT_MOBILITY_BROWSER_TOOLS), 'node_modules/playwright-core/index.mjs')));
const sources = ['test/agent4/mobile_repository_attribution.mjs', 'test/agent4/repository_application_fixture.mjs', 'test/agent4/repository_comparison.mjs',
  ...execFileSync('git', ['ls-files', '-z', '--', 'runtime'], { encoding: 'utf8' }).split('\0').filter(path => path.endsWith('.mjs'))];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async path => [path, hash(await readFile(path))])));
const report = { format: 'mobile-repository-attribution/v1', sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sources: await sourceHashes(),
  publicationGateSha256: hash(await readFile(process.env.AGENT_PUBLICATION_GATE)),
  environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model }, pairs, warmupPairs: smoke ? 0 : 2,
  method: { browser: 'Fresh production Worker restore, parked drive and retirement of the exact W-to-U checkpoint; same bytes in Chromium and Firefox. Warm browser services; worker/module/kernel HTTP loading and message cloning included. Browser/context startup, fixture generation, page setup and Playwright transport excluded.',
    host: 'WorldAdmission.parked on the same image/outcome with runtime/kernel bytes already loaded; measured separately, not an equivalent browser latency baseline.',
    recovery: 'After a real managed publication whose reply is lost, compare retained custodian with local executor/journal close and reopen, then reconciliation and authored return to terminal. Includes Git verification, journals and return execution; excludes fixture setup, whole OS-process startup and native runner qualification.',
    order: 'Two retained warmup pairs; then thirty pairs with alternating engine/recovery order and browser-workload order. Serial collection; no discarded attempts.',
    dwell: 'No live provider or actual person; deterministic fixtures. No WAN or full browser workflow speed claim.',
    quantiles: 'Nearest rank; 30-sample p95 is descriptive, not a precise tail guarantee.' }, browserRows: [], hostRows: [], recoveryRows: [], inputs: {}, summary: {}, complete: false };
const persist = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
const stats = values => { const sorted = [...values].sort((a,b) => a-b); assert(sorted.length && sorted.every(Number.isFinite)); return { n: sorted.length, min: sorted[0], p50: sorted[Math.ceil(sorted.length*.5)-1], p95: sorted[Math.ceil(sorted.length*.95)-1], max: sorted.at(-1) }; };
const browsers = {}, contexts = [], cleanup = [];
try {
  await persist();
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) { browsers[name] = await engine.launch({ headless: true }); report.environment[name] = browsers[name].version(); }
  const fixtures = {};
  for (const [name, replayPaddingBytes] of [['base', 0], ['checkpoint', 16384]]) {
    const hooks = [], t = { after: fn => hooks.push(fn), diagnostic() {} };
    cleanup.push(async () => { for (const fn of hooks.reverse()) await fn(); });
    const comparison = comparisonProfile(t, { topology: 'mobile', workload: { repositoryBytes: 64, extraReads: 0, replayPaddingBytes } });
    const transport = comparison.transport.bind(comparison), transfers = []; let environment;
    comparison.transport = async context => {
      environment = context; await transport(context);
      const peer = context.peers.W.get('U'), deliver = peer.deliver.bind(peer);
      peer.deliver = async envelope => { const result = await deliver(envelope); transfers.push({ image: Uint8Array.from(context.image), outcome: Uint8Array.from(envelope.outcome) }); return result; };
    };
    const f = await repositoryFixture(t, { mobile: true, mode: 1, comparison });
    assert.equal((await f.run()).kind, 'terminal'); comparison.result(); assert.equal(transfers.length, 1);
    const sample = transfers[0], decoded = environment.world.decodeOutcome(sample.outcome);
    assert.equal(decoded.kind, 'requested'); assert.equal((await environment.world.decodeRequest(decoded.request)).semanticIdentity, 'agent.mobility.relocate.v1');
    const tlsRoot = join(f.root, 'tls'), origin = await serveBrowser(environment.hosts.U, {
      key: await readFile(join(tlsRoot, 'A.key')), cert: await readFile(join(tlsRoot, 'A.pem')), audience: 'human',
      authenticate: () => ({ sessionId: 'measurement', principal: 'user', tenant: 'tenant', audiences: ['human'] }),
      runtimePath: resolve(process.env.AGENT_MOBILITY_RUNTIME), kernelBytes: await readFile(f.identity.kernelPath) });
    hooks.push(() => origin.close());
    fixtures[name] = { ...sample, environment, identity: f.identity, pages: {} };
    report.inputs[name] = { image: hash(sample.image), outcome: hash(sample.outcome), imageBytes: sample.image.length, outcomeBytes: sample.outcome.length,
      checkpointBytes: decoded.state.length, kernel: f.identity.kernelSha256, runtimeInventory: f.identity.inventorySha256 };
    for (const [engine, browser] of Object.entries(browsers)) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true }); contexts.push(context);
      const page = await context.newPage(); await page.goto(origin.url);
      await page.evaluate(({ image, outcome, runtime }) => { window.probe = { image: new Uint8Array(image), outcome: new Uint8Array(outcome), runtime }; },
        { image: [...sample.image], outcome: [...sample.outcome], runtime: f.identity.kernelSha256 });
      fixtures[name].pages[engine] = page;
    }
  }
  for (let pair = -report.warmupPairs; pair < pairs; pair++) for (const workload of pair % 2 === 0 ? ['base', 'checkpoint'] : ['checkpoint', 'base']) {
    const f = fixtures[workload];
    for (const engine of pair % 2 === 0 ? ['chromium', 'firefox'] : ['firefox', 'chromium']) {
      const row = { pair, warmup: pair < 0, workload, engine, status: 'fail' }; report.browserRows.push(row);
      try {
        Object.assign(row, await f.pages[engine].evaluate(async () => {
          const start = performance.now(), worker = new Worker('/worker.mjs', { type: 'module' });
          const call = data => new Promise((resolve, reject) => { worker.onmessage = ({ data }) => data.error ? reject(Error(data.error)) : resolve(data); worker.onerror = e => reject(Error(e.message)); worker.postMessage(data); });
          const equal = bytes => bytes.length === window.probe.outcome.length && bytes.every((value, i) => value === window.probe.outcome[i]);
          try {
            const restored = await call({ kind: 'restore', image: window.probe.image, outcome: window.probe.outcome, runtime_profile: window.probe.runtime, origin: location.origin });
            const restoredAt = performance.now(); if (!equal(restored.outcome)) throw Error('RestoreMismatch');
            const driveStart = performance.now(), driven = await call({ kind: 'drive', control: 'none', reply: [] });
            const drivenAt = performance.now(); if (!equal(driven.outcome)) throw Error('ParkedOutcomeMismatch');
            const retireStart = performance.now(); await call({ kind: 'retire' }); const retiredAt = performance.now();
            return { status: 'pass', restoreMs: restoredAt-start, parkedDriveMs: drivenAt-driveStart, retireMs: retiredAt-retireStart,
              measuredTotalMs: restoredAt-start + drivenAt-driveStart + retiredAt-retireStart };
          } finally { worker.terminate(); }
        }));
      } catch (error) { row.error = String(error.message).slice(0,4096); }
      await persist();
    }
    const row = { pair, warmup: pair < 0, workload, status: 'fail' }; report.hostRows.push(row);
    try {
      const owner = new WorldAdmission(f.environment.world, { kernelBytes: await readFile(f.identity.kernelPath), expectedSha256: f.identity.kernelSha256 });
      const begin = performance.now(), token = await owner.parked(f.image, f.outcome); row.verificationMs = performance.now()-begin;
      assert.deepEqual(owner.read(token).outcome, f.outcome); row.status = 'pass';
    } catch (error) { row.error = String(error.message).slice(0,4096); }
    await persist(); console.log(`browser attribution pair ${pair + 1}/${pairs}: ${workload}`);
  }
  for (const context of contexts) await context.close(); contexts.length = 0;
  for (const browser of Object.values(browsers)) await browser.close();
  for (const close of cleanup.reverse()) await close(); cleanup.length = 0;
  for (let pair = -report.warmupPairs; pair < pairs; pair++) for (const mode of pair % 2 === 0 ? ['retained', 'reopened'] : ['reopened', 'retained']) {
    const hooks = [], t = { after: fn => hooks.push(fn), diagnostic() {} }, row = { pair, warmup: pair < 0, mode, status: 'fail' }; report.recoveryRows.push(row);
    try {
      const f = await repositoryFixture(t, { mobile: true, mode: 2, sessionTasks: 1, lostReply: true, deterministicBase: true });
      await assert.rejects(f.run(), { code: 'FixtureLostReply' });
      const commit = await f.store.current(); assert.notEqual(commit, f.base);
      row.image = hash(f.image); row.initialArgs = hash(f.initialArgs); row.base = f.base;
      const begin = performance.now(); if (mode === 'reopened') f.restart(); const reopened = performance.now();
      assert.equal((await f.run()).kind, 'terminal'); const end = performance.now();
      row.reopenMs = reopened-begin; row.reconciliationAndReturnMs = end-reopened; row.totalMs = end-begin;
      row.workCounts = { model: f.modelCalls, check: f.counts.check, publication: f.counts.publish, cleanup: f.cleanupCalls };
      assert.equal(await f.store.current(), commit); assert.equal(f.counts.publish, 1); assert.equal(f.counts.check, 1); assert.equal(f.modelCalls, 3); assert.equal(f.cleanupCalls, 1);
      row.status = 'pass';
    } catch (error) { row.error = String(error.message).slice(0,4096); }
    finally { for (const close of hooks.reverse()) await close(); }
    await persist(); console.log(`recovery attribution pair ${pair + 1}/${pairs}: ${mode} ${row.status}`);
  }
  assert.deepEqual(await sourceHashes(), report.sources, 'measurement source changed during collection');
  assert.equal(hash(await readFile(process.env.AGENT_PUBLICATION_GATE)), report.publicationGateSha256, 'publication helper changed during collection');
  for (const rows of [report.browserRows, report.hostRows, report.recoveryRows]) assert(rows.every(row => row.status === 'pass'), 'all attempts retained; failed attribution cannot be accepted');
  for (const workload of ['base','checkpoint']) {
    const rows = report.browserRows.filter(row => !row.warmup && row.workload === workload);
    for (const engine of ['chromium','firefox']) report.summary[`${workload}/${engine}`] = Object.fromEntries(['restoreMs','parkedDriveMs','retireMs','measuredTotalMs'].map(key => [key,stats(rows.filter(row=>row.engine===engine).map(row=>row[key]))]));
    report.summary[`${workload}/firefox-minus-chromium`] = stats(Array.from({length:pairs},(_,pair)=>rows.find(row=>row.pair===pair&&row.engine==='firefox').measuredTotalMs-rows.find(row=>row.pair===pair&&row.engine==='chromium').measuredTotalMs));
    report.summary[`${workload}/host-verification`] = stats(report.hostRows.filter(row=>!row.warmup&&row.workload===workload).map(row=>row.verificationMs));
  }
  for (let pair=0;pair<pairs;pair++) { const rows=report.recoveryRows.filter(row=>row.pair===pair); assert.equal(rows.length,2); for(const key of ['image','initialArgs','base'])assert.equal(rows[0][key],rows[1][key]); }
  for (const mode of ['retained','reopened']) report.summary[`recovery/${mode}`]=Object.fromEntries(['reopenMs','reconciliationAndReturnMs','totalMs'].map(key=>[key,stats(report.recoveryRows.filter(row=>!row.warmup&&row.mode===mode).map(row=>row[key]))]));
  report.summary['recovery/reopened-minus-retained']=stats(Array.from({length:pairs},(_,pair)=>report.recoveryRows.find(row=>row.pair===pair&&row.mode==='reopened').totalMs-report.recoveryRows.find(row=>row.pair===pair&&row.mode==='retained').totalMs));
  report.complete = !smoke; report.smokePassed = smoke; await persist();
} catch (error) {
  report.failure = { code: error.code ?? error.name, message: String(error.message).slice(0,4096) }; await persist(); throw error;
} finally {
  for (const context of contexts) await context.close().catch(()=>{});
  for (const browser of Object.values(browsers)) await browser.close().catch(()=>{});
  for (const close of cleanup.reverse()) await close();
}
