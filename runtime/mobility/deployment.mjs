// Trusted, local deployment configuration. This loader is never reachable from
// a traveling image or peer request. Adapter selection is environmental only.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuntime, readRegular } from '../../tools/agent4/dependencies.mjs';
import { decodeSchema, decodeValue, encodeValue } from '../values.mjs';
import { bindSubject, subjectSchema, READ, CLOSE } from '../text_inspection.mjs';
import { fileBinding } from '../text_file.mjs';
import { WorldAdmission } from './admission.mjs';
import { CustodyJournal } from './journal.mjs';
import { Custodian } from './custodian.mjs';
import { HostPolicy } from './policy.mjs';
import { PeerClient, servePeers } from './transport.mjs';
import { parse, requireThat, closed } from './canonical.mjs';
import { hash } from './protocol.mjs';
import { schemas } from './values.mjs';

export async function openDeployment(configPath, { create = false } = {}) {
  const root = dirname(resolve(configPath)), config = parse(readRegular(configPath, 1 << 20));
  closed(config, ['format', 'hostId', 'trustDomain', 'revision', 'worldRuntime', 'directory', 'deploymentGeneration', 'keys', 'signer', 'deployments', 'bindings', 'labelDestinations', 'revoked', 'peers', 'tls', 'execution']);
  requireThat(config.format === 'agent-mobility-deployment/v1' && ['node', 'browser'].includes(config.execution), 'DeploymentConfiguration');
  const path = value => { requireThat(typeof value === 'string' && value.length > 0, 'DeploymentPath'); return resolve(root, value); };
  const bytes = value => readRegular(path(value));
  // Authenticate the complete installed runtime before importing any of it.
  const runtimePath = path(config.worldRuntime), identity = verifyRuntime(runtimePath);
  const world = await import(pathToFileURL(identity.entrypoint));
  const kernelBytes = bytes(identity.kernelPath);
  const keys = new Map(config.keys.map(entry => {
    closed(entry, ['keyId', 'owner', 'status', 'publicKey']);
    return [entry.keyId, { owner: entry.owner, status: entry.status, publicKey: createPublicKey(bytes(entry.publicKey)) }];
  }));
  requireThat(keys.size === config.keys.length, 'DuplicateKey');
  const statistics = new Map();
  const bindings = await Promise.all(config.bindings.map(async entry => {
    const { adapter, ...metadata } = entry;
    const binding = { ...metadata, payloadSchema: bytes(metadata.payloadSchema), resultSchema: bytes(metadata.resultSchema) };
    const counts = { calls: 0 }; statistics.set(binding.operation, counts);
    if (adapter.kind === 'fixed-reply') {
      closed(adapter, ['kind', 'payloadDigest', 'reply']);
      const reply = bytes(adapter.reply); decodeValue(decodeSchema(binding.resultSchema), reply);
      // Exact typed input admission belongs before dispatch, not after I/O.
      binding.authorize = payload => hash(encodeValue(decodeSchema(binding.payloadSchema), payload)) === adapter.payloadDigest;
      binding.handle = () => { counts.calls++; return Uint8Array.from(reply); };
    } else {
      requireThat(['text-file', 'text-close'].includes(adapter.kind), 'UnknownAdapter');
      closed(adapter, adapter.kind === 'text-file' ? ['kind', 'subject', 'root', 'path'] : ['kind', 'subject']);
      requireThat(binding.operation === (adapter.kind === 'text-file' ? READ : CLOSE), 'AdapterContract');
      const declared = decodeValue(subjectSchema, bytes(adapter.subject));
      requireThat(binding.subject === declared[0] && binding.subjectVersion === Buffer.from(declared[1]).toString('hex'), 'AdapterSubject');
      const leaf = adapter.kind === 'text-file' ? await fileBinding(declared, { root: path(adapter.root), path: adapter.path }) : bindSubject(declared, null);
      binding.authorize = payload => {
        const selected = binding.operation === READ ? payload[0] : payload;
        return selected[0] === declared[0] && selected[2] === declared[2] && Buffer.from(selected[1]).equals(Buffer.from(declared[1]));
      };
      binding.handle = async ({ request }) => { counts.calls++; return leaf.handle(request); };
      counts.text = leaf.counts;
    }
    return binding;
  }));
  const deployments = config.deployments.map(entry => ({ ...entry, cleanup: decodeValue(schemas.requirements, bytes(entry.cleanup)) }));
  const admission = new WorldAdmission(world, { kernelBytes, expectedSha256: identity.kernelSha256 });
  const policy = new HostPolicy({ ...config, runtimeProfile: identity.kernelSha256, deployments, bindings, revoked: new Set(config.revoked) });
  const journal = new CustodyJournal({ directory: path(config.directory), hostId: config.hostId, deploymentGeneration: config.deploymentGeneration, keys,
    signer: { ...config.signer, privateKey: createPrivateKey(bytes(config.signer.privateKey)) }, admission, create });
  const peers = new Map(), clients = [];
  try {
    const tls = { key: bytes(config.tls.key), cert: bytes(config.tls.cert), ca: bytes(config.tls.ca) };
    for (const entry of config.peers) {
      requireThat(!peers.has(entry.hostId), 'DuplicatePeer');
      const client = new PeerClient({ ...entry, ...tls }); clients.push(client); peers.set(entry.hostId, client);
    }
    const custodian = new Custodian({ journal, admission, world, policy, peers });
    let service = null;
    return { config, identity, world, journal, custodian, admission, peers, runtimePath, kernelBytes,
      statistics: () => Object.fromEntries([...statistics].map(([name, value]) => [name, { calls: value.calls, ...(value.text ? value.text() : {}) }])),
      async serve() {
        requireThat(service === null, 'AlreadyServing');
        service = await servePeers(custodian, { ...tls, host: config.tls.host, port: config.tls.port, peerCertificates: new Map(config.peers.map(entry => [entry.fingerprint256, entry.hostId])) });
        return service;
      },
      async close() { if (service) await service.close(); clients.forEach(client => client.close()); custodian.retireAll(); journal.close(); },
    };
  } catch (error) { clients.forEach(client => client.close()); journal.close(); throw error; }
}

// A bounded generic pump. It never chooses domain steps and never thaws an
// ambiguous transfer. Browser hosts leave actual World driving to their Worker.
export async function pumpDeployment(deployment) {
  const results = [];
  for (const { run } of deployment.journal.recover()) {
    if (run.status === 'ACTIVE' && deployment.config.execution === 'node') results.push(await deployment.custodian.run(run.run_id));
    const current = deployment.journal.run(run.run_id);
    if (current.status === 'OFFERED') results.push(await deployment.custodian.retryTransfer(current.transfer_id));
    else if (current.status === 'DEPARTED' && current.cancel_requested !== null && !current.cancel_forwarded) results.push(await deployment.custodian.cancelRun(current.run_id, current.cancel_requested));
  }
  return results;
}
