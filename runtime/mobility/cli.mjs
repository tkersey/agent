import { readRegular } from '../../tools/agent4/dependencies.mjs';
import { isMain } from '../cli.mjs';
import { openDeployment, pumpDeployment, validateDeployment } from './deployment.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath, writeFile } from 'node:fs/promises';
import { parse, closed, requireThat } from './canonical.mjs';
import { provisionRepository } from '../repository_snapshot.mjs';
import { createZigRepositorySandbox } from '../repository_zig_sandbox.mjs';
import { describeRepositoryCheckProfile } from '../repository_checks.mjs';
import { selectZig } from '../../tools/agent4/toolchain.mjs';
import { decodeSchema, decodeValue } from '../values.mjs';
import { configureRepository } from './repository_setup.mjs';
import { qualifyApplication } from './qualification.mjs';

const help = `Usage: node runtime/mobility/cli.mjs COMMAND CONFIG [ARGUMENTS]
  init CONFIG                         explicitly create empty local custody storage
  validate CONFIG [PEER_CONFIG ...] [--peers]  validate locally; opt in to authenticated read-only peer preflight
  provision-repository CONFIG         import one approved local commit into a new managed store
  qualify-check CONFIG                qualify a configured runner and print its profile identities
  configure-repository CONFIG OUTPUT  generate both host configs and typed task inputs in a new directory
  repository-template OUTPUT          create an operator setup template with inference disabled
  qualify-application CONFIG OUTPUT [--deployed|--live]  run selected qualification lanes and retain evidence
  login-issue CONFIG PRINCIPAL TENANT  locally issue a one-use browser login credential
  serve CONFIG                        recover and serve authenticated configured peers
  start CONFIG REGISTRATION IMAGE ARGS start an issuer-authorized run
  tasks CONFIG PRINCIPAL TENANT       list operator-authorized task configurations
  task CONFIG PRINCIPAL TENANT ENTRY MODE GOAL  start a task from the catalogue
  export CONFIG PRINCIPAL TENANT RUN  export an authorized completed report and publication receipt
  status CONFIG [RUN]                  inspect custody without executing
  metrics CONFIG RUN                   inspect scoped counts, pins and ambiguity
  recover CONFIG                      fence interrupted effects and inspect custody
  retry CONFIG TRANSFER               retry only the saved offer
  receipt CONFIG TRANSFER             print the saved signed receipt as base64url
  withdraw CONFIG TRANSFER            request a permanent destination decision
  cancel CONFIG RUN REASON             request cancellation at the known custodian
Stop the service before using a local custody mutation command. Login issuance is independent. No force-resume exists.
`;
export async function main(argv) {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { console.log(help); return; }
  const [command, config, ...args] = argv;
  if (command === 'qualify-application') {
    requireThat(config && args.length >= 1 && args.length <= 2 && (!args[1] || ['--deployed', '--live'].includes(args[1])), 'OperatorArguments');
    const report = await qualifyApplication(config, args[0], { deployed: args[1] === '--deployed', live: args[1] === '--live' });
    console.log(JSON.stringify({ complete: report.complete, report: resolve(args[0], 'report.json') }));
    if (!report.complete) process.exitCode = 1; return;
  }
  if (command === 'validate') {
    requireThat(config && args.length <= 17 && args.filter(arg => arg === '--peers').length <= 1 && args.every(arg => !arg.startsWith('--') || arg === '--peers'), 'OperatorArguments');
    try { console.log(JSON.stringify(await validateDeployment(config, { peerConfigs: args.filter(arg => arg !== '--peers'), contactPeers: args.includes('--peers') }))); }
    catch (error) { console.log(JSON.stringify({ valid: false, reason: error.code ?? 'DeploymentValidationFailed', ...(error.operation ? { operation: error.operation } : {}) })); process.exitCode = 1; }
    return;
  }
  if (command === 'repository-template') {
    requireThat(config && args.length === 0, 'OperatorArguments');
    await writeFile(config, readRegular(fileURLToPath(new URL('../../docs/mobile-repository-setup.example.json', import.meta.url))), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ template: resolve(config), inferenceEnabled: false })); return;
  }
  if (command === 'configure-repository') {
    requireThat(config && args.length === 1, 'OperatorArguments');
    console.log(JSON.stringify(await configureRepository(config, args[0]))); return;
  }
  if (['provision-repository', 'qualify-check'].includes(command)) {
    requireThat(config && args.length === 0, 'OperatorArguments');
    const input = parse(readRegular(config, 1 << 20), { maximum: 1 << 20, canonicalOnly: false });
    const path = value => { requireThat(typeof value === 'string' && value.length > 0, 'DeploymentPath'); return resolve(dirname(resolve(config)), value); };
    if (command === 'provision-repository') {
      closed(input, ['directory', 'sourceGitDirectory', 'base', 'gitExecutable', 'repository', 'generation', 'managedRef', 'readPaths', 'writablePaths',
        ...(Object.hasOwn(input, 'protectedPaths') ? ['protectedPaths'] : []), ...(Object.hasOwn(input, 'limits') ? ['limits'] : []), ...(Object.hasOwn(input, 'storage') ? ['storage'] : [])]);
      const receipt = await provisionRepository({ ...input, directory: path(input.directory), sourceGitDirectory: path(input.sourceGitDirectory), gitExecutable: path(input.gitExecutable) });
      console.log(JSON.stringify(receipt));
    } else {
      closed(input, ['sandbox', 'checkProfile']);
      const profile = describeRepositoryCheckProfile(input.checkProfile), selected = input.sandbox;
      closed(selected, ['zigExecutable', 'libraryDirectory', 'launcher', 'processLock', 'scratchRoot', 'timeoutMs', 'maximumOutputBytes', 'scratchBytes']);
      for (const helper of [selected.launcher, selected.processLock]) closed(helper, ['path', 'sha256']);
      const sandbox = await createZigRepositorySandbox({ ...selected,
        toolchain: selectZig(['--zig-exe', path(selected.zigExecutable), '--zig-lib', path(selected.libraryDirectory)], { inherited: null, inheritedLibrary: null }),
        scratchRoot: path(selected.scratchRoot), launcher: { ...selected.launcher, path: await realpath(path(selected.launcher.path)) },
        processLock: { ...selected.processLock, path: await realpath(path(selected.processLock.path)) } });
      console.log(JSON.stringify({ ...sandbox, execute: undefined, profile }));
      requireThat(sandbox.kind === 'qualified', 'EnvironmentUnavailable');
    }
    return;
  }
  const arity = { init: [0], serve: [0], start: [3], tasks: [2], task: [5], export: [3], status: [0, 1], metrics: [1], recover: [0], retry: [1], receipt: [1], withdraw: [1], cancel: [2], 'login-issue': [2] };
  if (!config || !arity[command]?.includes(args.length)) throw new Error(help);
  const host = await openDeployment(config, { create: command === 'init', qualifyChecks: command === 'serve' });
  const print = value => console.log(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
  let serving = false;
  try {
    if (command === 'init') print({ initialized: host.config.hostId });
    else if (command === 'login-issue') { if (!host.sessions) throw new Error('BrowserSessionsNotConfigured'); print(host.sessions.issue({ principal: args[0], tenant: args[1], audience: host.config.browser.audience })); }
    else if (command === 'tasks' || command === 'task') {
      if (!host.catalogue) throw new Error('TaskIntakeUnavailable');
      const identity = { principal: args[0], tenant: args[1] };
      print(command === 'tasks' ? host.catalogue.list(identity) : await host.catalogue.start(identity, { entry: args[2], mode: args[3], goal: args[4] }));
    }
    else if (command === 'export') {
      requireThat(host.catalogue && host.config.browser, 'ResultExportUnavailable');
      const identity = { principal: args[0], tenant: args[1], audiences: [host.config.browser.audience] };
      const run = host.custodian.authorizeUser(args[2], identity);
      host.catalogue.authorizeView(identity, run);
      const outcome = host.world.decodeOutcome(host.journal.artifact(run.tenant_ref, run.outcome_digest));
      const delivery = host.custodian.status(run.run_id).delivery ?? null;
      requireThat(outcome.kind === 'completed' || delivery !== null, 'ResultNotAvailable');
      const schema = host.catalogue.resultSchema(run.image_digest); requireThat(schema, 'ResultSchemaUnavailable');
      print({ format: 'agent.repository.export/v1', run_id: run.run_id, principal: run.principal_ref, tenant: run.tenant_ref,
        image: run.image_digest, program: run.program_id, outcome: run.outcome_digest, classification: run.classification,
        kind: outcome.kind, report: outcome.kind === 'completed' ? decodeValue(decodeSchema(schema), outcome.value) : null, delivery });
    }
    else if (command === 'status') print(args.length ? host.custodian.status(args[0]) : host.journal.recover().map(({ run }) => host.custodian.status(run.run_id)));
    else if (command === 'metrics') print(host.custodian.metrics(args[0]));
    else if (command === 'recover') print(host.custodian.recover());
    else if (command === 'start') { const run = await host.custodian.registerRun(...args.map(path => readRegular(path))); print(host.custodian.status(run.run_id)); }
    else if (command === 'retry') print(await host.custodian.retryTransfer(args[0]));
    else if (command === 'withdraw') print(await host.custodian.withdrawTransfer(args[0]));
    else if (command === 'cancel') print(await host.custodian.cancelRun(...args));
    else if (command === 'receipt') {
      const transfer = host.journal.transfer(args[0]);
      print({ transfer_id: args[0], receipt: transfer?.receipt ? Buffer.from(transfer.receipt).toString('base64url') : null });
    } else {
      host.custodian.recover(); const service = await host.serve(); serving = true;
      let stopped = false, wake;
      const stop = () => { stopped = true; wake?.(); };
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      print({ listening: service.url, browser: service.browser_url, host_id: host.config.hostId });
      try {
        while (!stopped) {
          try {
            for (const result of await pumpDeployment(host))
              if (result.kind === 'failed') console.error(JSON.stringify(result));
          }
          catch (error) { console.error(JSON.stringify({ error: error.code ?? 'HostOperationFailed' })); }
          if (!stopped) await new Promise(resolve => { const timer = setTimeout(resolve, 250); wake = () => { clearTimeout(timer); resolve(); }; });
        }
      } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
    }
  } finally { await host.close(); if (serving) print({ stopped: host.config.hostId, statistics: host.statistics() }); }
}
if (isMain(import.meta)) main(process.argv.slice(2)).catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
