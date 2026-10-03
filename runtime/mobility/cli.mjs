import { readRegular } from '../../tools/agent4/dependencies.mjs';
import { isMain } from '../cli.mjs';
import { openDeployment, pumpDeployment } from './deployment.mjs';

const help = `Usage: node runtime/mobility/cli.mjs COMMAND CONFIG [ARGUMENTS]
  init CONFIG                         explicitly create empty local custody storage
  serve CONFIG                        recover and serve authenticated configured peers
  start CONFIG REGISTRATION IMAGE ARGS start an issuer-authorized run
  status CONFIG [RUN]                  inspect custody without executing
  metrics CONFIG RUN                   inspect scoped counts, pins and ambiguity
  recover CONFIG                      fence interrupted effects and inspect custody
  retry CONFIG TRANSFER               retry only the saved offer
  receipt CONFIG TRANSFER             print the saved signed receipt as base64url
  withdraw CONFIG TRANSFER            request a permanent destination decision
  cancel CONFIG RUN REASON             request cancellation at the known custodian
Stop the service before using a local mutation command. No force-resume exists.
`;
export async function main(argv) {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { console.log(help); return; }
  const [command, config, ...args] = argv;
  const arity = { init: [0], serve: [0], start: [3], status: [0, 1], metrics: [1], recover: [0], retry: [1], receipt: [1], withdraw: [1], cancel: [2] };
  if (!config || !arity[command]?.includes(args.length)) throw new Error(help);
  const host = await openDeployment(config, { create: command === 'init' });
  const print = value => console.log(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
  let serving = false;
  try {
    if (command === 'init') print({ initialized: host.config.hostId });
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
      print({ listening: service.url, host_id: host.config.hostId });
      try {
        while (!stopped) {
          try { await pumpDeployment(host); }
          catch (error) { console.error(JSON.stringify({ error: error.code ?? 'HostOperationFailed' })); }
          if (!stopped) await new Promise(resolve => { const timer = setTimeout(resolve, 250); wake = () => { clearTimeout(timer); resolve(); }; });
        }
      } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
    }
  } finally { await host.close(); if (serving) print({ stopped: host.config.hostId, statistics: host.statistics() }); }
}
if (isMain(import.meta)) main(process.argv.slice(2)).catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
