import { readRegular } from '../../tools/agent4/dependencies.mjs';
import { isMain } from '../cli.mjs';
import { openDeployment, pumpDeployment } from './deployment.mjs';
import { dirname, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { parse, closed, requireThat } from './canonical.mjs';
import { provisionRepository } from '../repository_snapshot.mjs';
import { createZigRepositorySandbox } from '../repository_zig_sandbox.mjs';
import { describeRepositoryCheckProfile } from '../repository_checks.mjs';
import { selectZig } from '../../tools/agent4/toolchain.mjs';

const help = `Usage: node runtime/mobility/cli.mjs COMMAND CONFIG [ARGUMENTS]
  init CONFIG                         explicitly create empty local custody storage
  provision-repository CONFIG         import one approved local commit into a new managed store
  qualify-check CONFIG                qualify a configured runner and print its profile identities
  login-issue CONFIG PRINCIPAL TENANT  locally issue a one-use browser login credential
  serve CONFIG                        recover and serve authenticated configured peers
  start CONFIG REGISTRATION IMAGE ARGS start an issuer-authorized run
  tasks CONFIG PRINCIPAL TENANT       list operator-authorized task configurations
  task CONFIG PRINCIPAL TENANT ENTRY MODE GOAL  start a task from the catalogue
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
  if (['provision-repository', 'qualify-check'].includes(command)) {
    requireThat(config && args.length === 0, 'OperatorArguments');
    const input = parse(readRegular(config, 1 << 20), { maximum: 1 << 20, canonicalOnly: false });
    const path = value => { requireThat(typeof value === 'string' && value.length > 0, 'DeploymentPath'); return resolve(dirname(resolve(config)), value); };
    if (command === 'provision-repository') {
      closed(input, ['directory', 'sourceGitDirectory', 'base', 'gitExecutable', 'repository', 'generation', 'managedRef', 'readPaths', 'writablePaths',
        ...(Object.hasOwn(input, 'protectedPaths') ? ['protectedPaths'] : []), ...(Object.hasOwn(input, 'limits') ? ['limits'] : [])]);
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
  const arity = { init: [0], serve: [0], start: [3], tasks: [2], task: [5], status: [0, 1], metrics: [1], recover: [0], retry: [1], receipt: [1], withdraw: [1], cancel: [2], 'login-issue': [2] };
  if (!config || !arity[command]?.includes(args.length)) throw new Error(help);
  const host = await openDeployment(config, { create: command === 'init' });
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
