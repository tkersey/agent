// Operator-only external trials run the normal origin service and never answer for the person.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readRegular } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue } from '../values.mjs';
import { parse, closed, requireThat, identifier } from './canonical.mjs';
import { hash } from './protocol.mjs';
import { openDeployment, pumpDeployment, validateDeployment } from './deployment.mjs';

export function admitQualification(input, { deployed = false, live = false } = {}) {
  closed(input, ['format', 'lanes', 'source', 'external', 'maximumSeconds']);
  requireThat(input.format === 'agent.repository.qualification/v1' && Array.isArray(input.lanes) && input.lanes.length > 0 &&
    new Set(input.lanes).size === input.lanes.length && input.lanes.every(lane => ['deployed', 'live'].includes(lane)), 'QualificationLanes');
  requireThat(Number.isInteger(input.maximumSeconds) && input.maximumSeconds > 0 && input.maximumSeconds <= 7200, 'QualificationDeadline');
  const external = input.lanes.filter(lane => ['deployed', 'live'].includes(lane));
  requireThat(external.length <= 1 && (!external.includes('deployed') || deployed) && (!external.includes('live') || live), 'QualificationOptInRequired');
  requireThat(!deployed || external.includes('deployed'), 'QualificationOptInMismatch');
  requireThat(!live || external.includes('live'), 'QualificationOptInMismatch');
  requireThat(input.source === null, 'QualificationSource');
  if (external.length) {
    closed(input.external, ['origin', 'peers', 'principal', 'tenant', 'cases']);
    identifier(input.external.principal); identifier(input.external.tenant);
    requireThat(Array.isArray(input.external.peers) && input.external.peers.length > 0 && input.external.peers.length <= 16 &&
      Array.isArray(input.external.cases) && input.external.cases.length > 0 && input.external.cases.length <= 32 &&
      new Set(input.external.cases.map(row => row.id)).size === input.external.cases.length, 'QualificationCorpus');
    for (const row of input.external.cases) {
      closed(row, ['id', 'entry', 'base', 'mode', 'goal', 'expected']); identifier(row.id); identifier(row.entry);
      requireThat(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(row.base) && ['inspect', 'propose', 'publish'].includes(row.mode) &&
        typeof row.goal === 'string' && row.goal.trim().length > 0 && Buffer.byteLength(row.goal) <= 4096, 'QualificationCorpus');
      closed(row.expected, ['kind', 'proposalTree', 'published']);
      requireThat(['completed', 'failed', 'cancelled'].includes(row.expected.kind) && typeof row.expected.published === 'boolean' &&
        (row.expected.proposalTree === null || /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(row.expected.proposalTree)) &&
        (!row.expected.published || row.mode === 'publish' && row.expected.kind === 'completed' && row.expected.proposalTree !== null), 'QualificationExpectedResult');
    }
  } else requireThat(input.external === null, 'QualificationCorpus');
  return structuredClone(input);
}
export function assessQualificationResult(test, kind, report, delivery = null) {
  const proposal = report?.[5] ? JSON.parse(report[5]) : null;
  const publication = report?.[6], published = publication?.tag === 1 && publication.value?.tag === 0 && publication.value.value?.tag === 0;
  const receipt = published ? JSON.parse(publication.value.value.value) : null;
  return { outcome: kind === test.expected.kind && (kind === 'completed' ? Array.isArray(report) && report.length === 7 : report === null), mode: report === null || report[2] === ['inspect', 'propose', 'publish'].indexOf(test.mode),
    tree: (proposal?.core?.candidate?.tree ?? null) === test.expected.proposalTree,
    publication: published === test.expected.published && (published ? receipt.status === 'Published' && receipt.tree === test.expected.proposalTree &&
      typeof proposal?.digest === 'string' && /^[a-f0-9]{64}$/.test(proposal.digest) && typeof proposal.commitOid === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(proposal.commitOid) &&
      receipt.proposal === proposal.digest && receipt.commit === proposal.commitOid : test.mode !== 'publish' || kind === 'completed' && delivery === null) };
}
export async function qualifyApplication(filename, output, options = {}) {
  const configBytes = readRegular(filename, 1 << 20), config = admitQualification(parse(configBytes, { maximum: 1 << 20, canonicalOnly: false }), options);
  const path = value => { requireThat(typeof value === 'string' && value.length > 0, 'QualificationPath'); return resolve(dirname(resolve(filename)), value); };
  const directory = resolve(output), report = { format: 'agent.repository.qualification-result/v1', config: hash(configBytes), lanes: config.lanes.map(lane => ({ lane, status: 'not-run' })), complete: false,
    limitations: ['Passing selected lanes is not completion of every acceptance requirement.', 'No synthetic human answers are supplied in external lanes.', 'A wait deadline does not cancel or roll back a run.'] };
  // Opt-ins and corpus shape are checked before creating output or opening hosts.
  await mkdir(directory, { mode: 0o700 });
  const save = () => writeFile(join(directory, 'report.json'), JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n', { mode: 0o600 });
  try {
    await save();
    const lane = config.lanes[0];
    if (lane) {
      const external = config.external, peerFiles = external.peers.map(path), originPath = path(external.origin);
      const modelsFor = validation => external.cases.map(test => {
        const selected = validation.providerProfiles.filter(profile => profile.entry === test.entry && profile.principal === external.principal && profile.tenant === external.tenant);
        requireThat(selected.length === 1, 'QualificationTaskScope');
        requireThat(typeof selected[0].version === 'string' && /^[a-f0-9]{64}$/.test(selected[0].version), 'QualificationProviderVersion');
        requireThat(selected[0].mode === (lane === 'live' ? 'openai-live' : 'loopback-fixture'), 'QualificationProviderMode');
        return selected[0];
      });
      modelsFor(await validateDeployment(originPath, { peerConfigs: peerFiles }));
      const preflight = await validateDeployment(originPath, { peerConfigs: peerFiles, contactPeers: true }), models = modelsFor(preflight);
      const row = report.lanes.find(row => row.lane === lane); Object.assign(row, { status: 'running', cases: external.cases.map(value => ({ ...value, status: 'not-run' })), providerProfiles: models, preflight }); await save();
      const host = await openDeployment(originPath);
      try {
        requireThat(host.config.execution === 'browser' && host.sessions && host.catalogue && host.journal.recover().length === 0, 'QualificationFreshOriginRequired');
        const service = await host.serve(), identity = { principal: external.principal, tenant: external.tenant, audiences: [host.config.browser.audience] };
        for (const expected of external.cases) {
          const result = row.cases.find(row => row.id === expected.id); result.status = 'running'; await save();
          try {
            const entry = host.catalogue.list(identity).find(entry => entry.id === expected.entry);
            requireThat(entry?.base === expected.base && entry.modes.includes(expected.mode), 'QualificationTaskScope');
            const run = await host.catalogue.start(identity, { entry: expected.entry, mode: expected.mode, goal: expected.goal }); result.run_id = run.run_id; await save();
            console.log(JSON.stringify({ qualificationCase: expected.id, run_id: run.run_id, browser: service.browser_url, interaction: 'Use an operator-issued login and the browser; the qualifier never answers or approves.' }));
            const deadline = Date.now() + config.maximumSeconds * 1000;
            while (host.custodian.status(run.run_id).custody !== 'TERMINAL' && Date.now() < deadline) {
              const transitions = await pumpDeployment(host); for (const transition of transitions) if (transition.kind === 'failed') result.lastHostError = transition.reason;
              await new Promise(resolve => setTimeout(resolve, 250));
            }
            const current = host.custodian.authorizeUser(run.run_id, identity); host.catalogue.authorizeView(identity, current);
            result.custody = host.custodian.status(run.run_id); result.originMetrics = host.custodian.metrics(run.run_id);
            if (current.status !== 'TERMINAL') { result.status = 'incomplete'; result.reason = 'wait-deadline'; await save(); break; }
            const outcome = host.world.decodeOutcome(host.journal.artifact(current.tenant_ref, current.outcome_digest)); result.kind = outcome.kind;
            result.report = outcome.kind === 'completed' ? decodeValue(decodeSchema(host.catalogue.resultSchema(current.image_digest)), outcome.value) : null;
            result.acceptance = assessQualificationResult(expected, outcome.kind, result.report, result.custody.delivery ?? null);
            result.status = Object.values(result.acceptance).every(Boolean) ? 'passed' : 'failed';
          } catch (error) { result.status = 'failed'; result.reason = error.code ?? 'QualificationCaseFailed'; }
          await save();
        }
        if (row.cases.every(result => result.status === 'passed')) {
          row.postflight = await validateDeployment(originPath, { peerConfigs: peerFiles, contactPeers: true });
          requireThat(row.postflight.config === preflight.config && JSON.stringify(modelsFor(row.postflight)) === JSON.stringify(models), 'QualificationConfigurationChanged');
        }
        row.status = row.cases.every(result => result.status === 'passed') ? 'passed' : row.cases.some(result => result.status === 'failed') ? 'failed' : 'incomplete';
      } finally { await host.close(); }
    }
    report.complete = report.lanes.length === config.lanes.length && report.lanes.every(row => row.status === 'passed'); await save(); return report;
  } catch (error) {
    report.failure = error.code ?? 'QualificationFailed';
    for (const row of report.lanes) if (row.status === 'running') row.status = 'failed';
    await save(); throw error;
  }
}
