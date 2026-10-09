import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {isMain} from '../cli.mjs';
import {parseJsonStrict} from '../model.mjs';
import {application, configure, readFile} from './environment.mjs';
import {AdaptiveRunner} from './runner.mjs';

const help = `Usage: node runtime/adaptive/cli.mjs COMMAND [OPTIONS]
  demo              run the shared offline provider scenario in a new state directory
  validate-config   validate frozen policy/resources without inference or state creation
  run               start an ordinary task from --input-json in a new state directory
  resume            resume the saved task; never repeat unknown delivery
  status            inspect the saved task without inference
  observations      inspect bounded capture metrics without prompt text or inference
  message           queue --message-json using a stable --operation-id
  respond           save --answer-json for --question-id and --request-digest
  cancel            request cancellation with --reason and --operation-id

Common: --world-runtime PATH --state-dir PATH [--application FILE --image FILE]
Policy: --offline | --config FILE [--credential-file FILE --authorize-inference]
Controlled HTTPS tests: --test-provider --trust-root-file DER
Inputs are the same typed client JSON values as the native application.
Use one private state directory per task. Stop a running CLI before another
local mutation. This thin CLI does not advertise agent-host/1.0 or read native
state. Live inference requires explicit authorization on every execution launch.
`;
const argumentNames = new Map([
  ['--world-runtime', 'worldRuntime'], ['--state-dir', 'stateDir'], ['--application', 'application'], ['--image', 'image'],
  ['--config', 'config'], ['--credential-file', 'credential'], ['--trust-root-file', 'trustRoot'],
  ['--input-json', 'input'], ['--message-json', 'message'], ['--answer-json', 'answer'],
  ['--operation-id', 'operationId'], ['--question-id', 'questionId'], ['--request-digest', 'requestDigest'], ['--reason', 'reason'],
]);
const flags = new Map([['--offline', 'offline'], ['--authorize-inference', 'authorizeInference'], ['--test-provider', 'testProvider']]);
const print = value => console.log(JSON.stringify(value, (_key, child) => typeof child === 'bigint' ? String(child) : child));

export async function main(argv) {
  if (argv.length === 0 || argv.length === 1 && ['--help', '-h'].includes(argv[0])) { console.log(help); return; }
  const [command, ...args] = argv, options = {};
  assert(['demo', 'validate-config', 'run', 'resume', 'status', 'observations', 'message', 'respond', 'cancel'].includes(command), 'unknown command');
  for (let i = 0; i < args.length; i++) {
    const key = flags.get(args[i]) ?? argumentNames.get(args[i]); assert(key && !Object.hasOwn(options, key), 'unknown or duplicate option');
    if (flags.has(args[i])) options[key] = true;
    else { const value = args[++i]; assert(typeof value === 'string' && value.length && !value.includes('\0'), 'missing option value'); options[key] = value; }
  }
  options.application ??= fileURLToPath(new URL('../../examples/adaptive-agent/application.json', import.meta.url));
  options.image ??= join(dirname(options.application), 'program.bpi3');
  assert(!!options.testProvider === !!options.trustRoot, 'controlled test needs both --test-provider and --trust-root-file');
  options.testTrustRoot = options.testProvider ? options.trustRoot : undefined;
  if (command === 'demo') assert(options.offline && !options.input, 'demo requires --offline');
  if (command === 'validate-config') {
    assert(!options.credential && !options.authorizeInference, 'configuration validation does not need credentials');
    const app = application(readFile(options.application, 16 * 1024 * 1024), readFile(options.image, 16 * 1024 * 1024));
    const configured = configure(app, options);
    print({valid: true, application: app.value.application_id, profiles: configured.policy.profiles.map(({id, model, efforts}) => ({id, model, efforts})),
      skills: configured.catalog.skills.map(({id, version}) => ({id, version})), live_provider: false}); return;
  }
  assert(options.worldRuntime && options.stateDir, 'runtime and state directory are required');
  if (['message', 'respond', 'cancel'].includes(command)) assert(options.operationId, 'stable operation ID is required');
  options.create = ['run', 'demo'].includes(command);
  const runner = await AdaptiveRunner.open(options);
  const interrupt = () => { try { runner.interrupt('Interrupted by operator.'); } catch {} };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    if (command === 'observations') { print({observations: runner.observations(), metrics: runner.metrics()}); return; }
    if (command === 'run' || command === 'demo') {
      const input = command === 'demo' ? {task: 'Explain the fixture entry point using source evidence and exercise the approved adaptive controls.'} : parseJsonStrict(options.input ?? 'null');
      await runner.start(input);
    }
    if (command === 'message') {
      assert(options.message, '--message-json is required'); print(runner.message(options.operationId, parseJsonStrict(options.message))); return;
    }
    if (command === 'respond') {
      assert(options.answer && /^[1-9][0-9]{0,3}$/.test(options.questionId ?? '') && /^[a-f0-9]{64}$/.test(options.requestDigest ?? ''), 'complete question binding is required');
      print(runner.respond(options.operationId, Number(options.questionId), options.requestDigest, parseJsonStrict(options.answer))); return;
    }
    if (command === 'cancel') { assert(options.reason, '--reason is required'); runner.cancel(options.operationId, options.reason); }
    let status = command === 'status' ? runner.status() : await runner.drive();
    if (command === 'demo' && status.question) {
      runner.respond('offline-demo-answer', status.question.id, status.question.request_digest, {message: 'Focus on observable behavior.'});
      status = await runner.drive();
    }
    print(status);
    if (command !== 'status' && status.kind !== 'completed') process.exitCode = 2;
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); await runner.close(); }
}

if (isMain(import.meta)) main(process.argv.slice(2)).catch(error => {
  // Do not print assertion dumps: they may contain prompts or opaque records.
  const reasons = new Map([
    ['approved configuration required', 'Supply --config or choose --offline.'],
    ['frozen configuration mismatch', 'The launch does not match the saved immutable task profile.'],
    ['invalid initial inference selection', 'Choose an initial profile and effort from the approved catalog.'],
    ['unqualified capacity or effort-update profile', 'Use at most 16 attempts/revisions and effort_update: false.'],
    ['frozen resource count capacity', 'The deployment admits at most 14 approved skill bodies.'],
    ['frozen resource byte capacity', 'Snapshot, skill bodies and catalog together must fit 16 MiB.'],
    ['credential embedded in task profile', 'The selected credential appears in the task profile.'],
    ['credential embedded in task resources', 'The selected credential appears in the task resources.'],
    ['closed record', 'Object fields must match the published application contract.'],
    ['incompatible JS state', 'This state belongs to a different application, image or runtime.'],
  ]);
  const code = error.code === 'EADDRINUSE' ? 'StateInUse' : error.code === 'ERR_ASSERTION' ?
    process.argv[2] === 'validate-config' ? 'InvalidConfiguration' : 'InvalidStateOrInput' : error.code ?? 'AdaptiveExecutionFailed';
  const reason = reasons.get(String(error.message).split('\n')[0]);
  print({error: {code, ...(reason ? {reason} : {})}});
  process.exitCode = 1;
});
