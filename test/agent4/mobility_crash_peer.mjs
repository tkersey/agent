// Fault-injection subprocess. Test keys and exact World bytes live only in a
// private temporary fixture directory; a signal interrupts the real SQLite path.
import { readFile } from 'node:fs/promises';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyRuntime } from '../../tools/agent4/dependencies.mjs';
import { WorldAdmission } from '../../runtime/mobility/admission.mjs';
import { CustodyJournal } from '../../runtime/mobility/journal.mjs';
import { version } from '../../runtime/mobility/custody.mjs';
const [runtime, inputPath, operation, fault] = process.argv.slice(2);
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const identity = verifyRuntime(runtime), world = await import(pathToFileURL(identity.entrypoint));
const admission = new WorldAdmission(world, { kernelBytes: new Uint8Array(await readFile(identity.kernelPath)), expectedSha256: identity.kernelSha256 });
const token = await admission.parked(new Uint8Array(input.image), new Uint8Array(input.outcome));
const keys = new Map(Object.entries(input.keys).map(([owner, pem]) => [owner, { owner, status: 'active', publicKey: createPublicKey(pem) }]));
const journal = new CustodyJournal({ directory: input.directory, hostId: input.host, deploymentGeneration: 'generation-1', keys,
  signer: { keyId: input.host, privateKey: createPrivateKey(input.privateKey), policyRevision: 'p1' }, admission,
  fault(point) { if (point === fault) process.kill(process.pid, 'SIGKILL'); } });
try {
  if (operation === 'freeze') journal.freeze(input.runId, version(journal.run(input.runId)), new Uint8Array(input.offer), token);
  else if (operation === 'accept') journal.accept(new Uint8Array(input.offer), new Uint8Array(input.registration), token, input.policy);
  else if (operation === 'acquire') journal.recordReply(input.runId, input.attempt, new Uint8Array(input.reply), ['shared']);
  else throw new Error('Unknown crash operation');
  throw new Error('Fault point was not reached');
} finally { journal.close(); }
