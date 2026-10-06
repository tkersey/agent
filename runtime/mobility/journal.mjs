// Small reference custody store. All externally actionable transitions serialize
// in one local SQLite transaction; no caller-supplied SQL or transaction callback.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, openSync, closeSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { canonical, parse, requireThat, identifier, digest, counter, labels, closed } from './canonical.mjs';
import { hash, opaqueId, verifyRecord, signRecord, validate, matchesDecision } from './protocol.mjs';
import { encodeArrival, encodeRefusal, schemas, observationValue } from './values.mjs';
import { encodeValue, decodeSchema, encodeSchema } from '../values.mjs';
import * as core from './custody.mjs';
const equal = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const json = value => new TextDecoder().decode(canonical(value));
const readJson = value => value === null || value === undefined ? null : parse(new TextEncoder().encode(value));
function artifactLimits(limits, image, outcome) {
  requireThat(image.length <= limits.maximum_image_bytes && outcome.length <= limits.maximum_outcome_bytes, 'ArtifactCapacity');
}
function policyState(run, { cleanupRequirements, classification, deploymentLimits, policyRevision }) {
  labels(cleanupRequirements, 16); cleanupRequirements.forEach(digest); labels(classification);
  requireThat(run.classification.every(label => classification.includes(label)), 'ClassificationDowngrade');
  for (const key of Object.keys(run.deployment_limits)) requireThat(deploymentLimits[key] <= run.deployment_limits[key], 'LimitsWidened');
  return { ...run, cleanup_requirements: [...cleanupRequirements], classification: [...classification], deployment_limits: { ...deploymentLimits }, policy_revision: policyRevision };
}

export class CustodyJournal {
  #db; #host; #keys; #signer; #admission; #fault; #quota; #recordLimit; #staleDispatch = new Map();
  constructor({ directory, hostId, deploymentGeneration, keys, signer, admission, create = false, tenantBytes = 256 << 20, maximumRecords = 10000, fault = () => {} }) {
    identifier(hostId); identifier(deploymentGeneration); requireThat(keys instanceof Map, 'InvalidKeys');
    const root = resolve(directory), path = join(root, 'custody.sqlite');
    if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
    const dir = lstatSync(root);
    requireThat(dir.isDirectory() && !dir.isSymbolicLink() && (dir.mode & 0o077) === 0 && dir.uid === process.getuid(), 'PrivateStateDirectoryRequired');
    let fresh = false;
    try { lstatSync(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      requireThat(create, 'MissingCustodyStorage');
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600); closeSync(fd); fresh = true;
    }
    const stat = lstatSync(path);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'PrivateStateFileRequired');
    this.#host = hostId; this.#keys = keys; this.#signer = signer; this.#admission = admission; this.#fault = fault;
    this.#quota = tenantBytes; this.#recordLimit = maximumRecords;
    this.#db = new DatabaseSync(path, { timeout: 5000, allowExtension: false, enableForeignKeyConstraints: true });
    try {
      this.#db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA fullfsync=ON; PRAGMA trusted_schema=OFF;');
      requireThat(this.#get('PRAGMA journal_mode').journal_mode === 'delete' && this.#get('PRAGMA synchronous').synchronous === 3, 'DurabilityConfiguration');
      if (fresh) this.#transaction('initialize', () => {
        this.#db.exec(`
          CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL) STRICT;
          CREATE TABLE runs (run_id TEXT PRIMARY KEY, tenant TEXT NOT NULL, body TEXT NOT NULL) STRICT;
          CREATE TABLE occurrences (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id), body TEXT NOT NULL) STRICT;
          CREATE TABLE transfers (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tenant TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('source','target')), offer BLOB NOT NULL, receipt BLOB, accepted_core BLOB, decision_keys TEXT NOT NULL) STRICT;
          CREATE TABLE artifacts (tenant TEXT NOT NULL, digest TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(tenant,digest)) STRICT;
          CREATE TABLE outbox (id TEXT PRIMARY KEY REFERENCES transfers(id), offer BLOB NOT NULL) STRICT;
          CREATE TABLE verification_keys (id TEXT PRIMARY KEY, owner TEXT NOT NULL, spki BLOB NOT NULL) STRICT;
        `);
        this.#run('INSERT INTO metadata VALUES (1, ?)', json({ format: 'agent-mobility-journal/v1', host_id: hostId, deployment_generation: deploymentGeneration }));
      });
      const metadata = readJson(this.#get('SELECT body FROM metadata WHERE id=1')?.body);
      requireThat(metadata?.format === 'agent-mobility-journal/v1' && metadata.host_id === hostId && metadata.deployment_generation === deploymentGeneration, 'QuarantinedStorageGeneration');
      this.#db.exec('CREATE TABLE IF NOT EXISTS staging (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, offer BLOB NOT NULL, registration BLOB NOT NULL, predecessor BLOB, observation BLOB NOT NULL, requirements BLOB NOT NULL, constraints BLOB NOT NULL, image_digest TEXT, outcome_digest TEXT) STRICT');
      this.#db.exec('CREATE TABLE IF NOT EXISTS allowances (run_id TEXT NOT NULL REFERENCES runs(run_id), kind TEXT NOT NULL, tenant TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,kind)) STRICT');
      requireThat(this.#get('PRAGMA quick_check').quick_check === 'ok', 'CorruptCustodyStorage');
    } catch (error) { this.#db.close(); throw error; }
  }
  #get(sql, ...params) { const statement = this.#db.prepare(sql); try { return statement.get(...params); } finally { statement.close(); } }
  #all(sql, ...params) { const statement = this.#db.prepare(sql); try { return statement.all(...params); } finally { statement.close(); } }
  #run(sql, ...params) { const statement = this.#db.prepare(sql); try { return statement.run(...params); } finally { statement.close(); } }
  #transaction(name, action) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#fault(`${name}.begin`);
      const value = action(); requireThat(!(value instanceof Promise), 'AsyncCustodyTransaction');
      this.#fault(`${name}.before_commit`); this.#db.exec('COMMIT');
      this.#fault(`${name}.after_commit`); return value;
    } catch (error) { if (this.#db.isTransaction) this.#db.exec('ROLLBACK'); throw error; }
  }
  close() { this.#db.close(); }
  run(runId) { return readJson(this.#get('SELECT body FROM runs WHERE run_id=?', runId)?.body); }
  occurrence(id) { return id === null ? null : readJson(this.#get('SELECT body FROM occurrences WHERE id=?', id)?.body); }
  #occurrence(run) { return run === null ? null : this.occurrence(run.current_occurrence_id); }
  #save(run) { this.#run('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET body=excluded.body', run.run_id, run.tenant_ref, json(run)); }
  #saveOccurrence(occurrence, fresh = false) {
    if (occurrence === null) return;
    if (fresh) this.#run('INSERT INTO occurrences VALUES (?, ?, ?)', occurrence.id, occurrence.run_id, json(occurrence));
    else requireThat(this.#run('UPDATE occurrences SET body=? WHERE id=? AND run_id=?', json(occurrence), occurrence.id, occurrence.run_id).changes === 1, 'OccurrenceMissing');
  }
  #artifact(tenant, bytes) {
    requireThat(bytes instanceof Uint8Array && bytes.length <= (256 << 20), 'ArtifactCapacity');
    const value = hash(bytes), previous = this.#get('SELECT bytes FROM artifacts WHERE tenant=? AND digest=?', tenant, value);
    if (previous) { requireThat(equal(previous.bytes, bytes), 'ArtifactConflict'); return value; }
    const used = this.#get('SELECT coalesce(sum(length(bytes)), 0) AS bytes FROM artifacts WHERE tenant=?', tenant).bytes;
    requireThat(used + bytes.length <= this.#quota, 'TenantStorageCapacity');
    this.#fault('artifact.before'); this.#run('INSERT INTO artifacts VALUES (?, ?, ?)', tenant, value, bytes); this.#fault('artifact.after'); return value;
  }
  artifact(tenant, value) { digest(value); const row = this.#get('SELECT bytes FROM artifacts WHERE tenant=? AND digest=?', tenant, value); requireThat(row !== undefined, 'ArtifactMissing'); requireThat(hash(row.bytes) === value, 'ArtifactCorrupt'); return Uint8Array.from(row.bytes); }
  hasArtifact(tenant, value) { digest(value); return this.#get('SELECT 1 FROM artifacts WHERE tenant=? AND digest=?', tenant, value) !== undefined; }
  registration(bytes) { return this.#registration(bytes); }
  transfer(id) {
    digest(id); const row = this.#get('SELECT offer, receipt FROM transfers WHERE id=?', id);
    return row ? { offer: Uint8Array.from(row.offer), receipt: row.receipt === null ? null : Uint8Array.from(row.receipt) } : null;
  }
  stagedOffer(id) { digest(id); const row = this.#get('SELECT offer FROM staging WHERE id=?', id); return row ? Uint8Array.from(row.offer) : null; }
  #remember(record) {
    const binding = this.#keys.get(record.key_id); if (!binding) return;
    const spki = binding.publicKey.export({ type: 'spki', format: 'der' });
    const old = this.#get('SELECT owner, spki FROM verification_keys WHERE id=?', record.key_id);
    if (old) requireThat(old.owner === binding.owner && equal(old.spki, spki), 'KeyIdRebound');
    else this.#run('INSERT INTO verification_keys VALUES (?, ?, ?)', record.key_id, binding.owner, spki);
  }
  #verify(kind, bytes, historical = null) {
    const record = parse(bytes), keys = new Map(this.#keys);
    if (!keys.has(record.key_id) && historical !== null) {
      const old = this.#get('SELECT owner, spki FROM verification_keys WHERE id=?', record.key_id);
      if (old) keys.set(record.key_id, { owner: old.owner, status: 'retired', publicKey: createPublicKey({ key: old.spki, format: 'der', type: 'spki' }) });
    }
    return verifyRecord(kind, bytes, keys, { historicalDigest: historical === null ? null : hash(historical) });
  }
  #registration(bytes, expectedDigest = null) {
    const parsed = parse(bytes);
    const saved = this.#get('SELECT bytes FROM artifacts WHERE tenant=? AND digest=?', parsed.tenant_ref, hash(bytes));
    const record = this.#verify('run', bytes, saved?.bytes ?? null);
    if (expectedDigest !== null) requireThat(hash(bytes) === expectedDigest, 'RegistrationMismatch');
    return record;
  }
  #lineage(offer, registration, predecessorBytes) {
    if (offer.source_epoch === '0') {
      requireThat(offer.source_host_id === registration.initial_host_id && offer.predecessor_receipt_digest === offer.run_registration_digest, 'InvalidLineage');
      return;
    }
    requireThat(predecessorBytes instanceof Uint8Array && hash(predecessorBytes) === offer.predecessor_receipt_digest, 'InvalidLineage');
    const saved = this.#get('SELECT bytes FROM artifacts WHERE tenant=? AND digest=?', registration.tenant_ref, offer.predecessor_receipt_digest);
    const predecessor = this.#verify('decision', predecessorBytes, saved?.bytes ?? null);
    requireThat(predecessor.decision === 'accepted' && predecessor.run_id === offer.run_id && predecessor.destination_host_id === offer.source_host_id && predecessor.destination_epoch === offer.source_epoch, 'InvalidLineage');
    this.#remember(predecessor);
  }
  #offer(bytes) {
    const parsed = parse(bytes), saved = this.#get('SELECT * FROM transfers WHERE id=?', parsed.transfer_id);
    const staged = this.#get('SELECT offer FROM staging WHERE id=?', parsed.transfer_id);
    if (saved) requireThat(equal(saved.offer, bytes), 'TransferConflict');
    if (staged) requireThat(equal(staged.offer, bytes), 'TransferConflict');
    const offer = this.#verify('offer', bytes, saved?.offer ?? staged?.offer ?? null);
    requireThat(offer.destination_host_id === this.#host || offer.source_host_id === this.#host, 'WrongHost');
    return { offer, saved };
  }
  // Check the transaction's actual records, including replacements, before
  // commit. A rejection rolls back every row and artifact in the operation.
  #recordCapacity(tenant) {
    const count = this.#get('SELECT (SELECT count(*) FROM runs WHERE tenant=?) + (SELECT count(*) FROM transfers WHERE tenant=?) + (SELECT count(*) FROM occurrences JOIN runs USING(run_id) WHERE tenant=?) + (SELECT count(*) FROM staging WHERE tenant=?) + (SELECT count(*) FROM allowances WHERE tenant=?) AS n', tenant, tenant, tenant, tenant, tenant).n;
    requireThat(count <= this.#recordLimit, 'TenantRecordCapacity');
  }
  register(registrationBytes, admitted, policy = null) {
    const data = this.#admission.read(admitted);
    return this.#transaction('register', () => {
      const registration = this.#registration(registrationBytes);
      requireThat(this.run(registration.run_id) === null, 'RunAlreadyRegistered');
      for (const key of ['image_digest', 'program_id', 'trusted_runtime_profile']) requireThat(registration[key] === data.metadata[key], 'RegistrationMismatch');
      const state = core.initial(registration, hash(registrationBytes), this.#host, data.metadata, opaqueId());
      if (policy !== null) state.run = policyState(state.run, policy);
      artifactLimits(state.run.deployment_limits, data.image, data.outcome);
      this.#remember(registration); this.#artifact(registration.tenant_ref, registrationBytes);
      this.#artifact(registration.tenant_ref, data.image); this.#artifact(registration.tenant_ref, data.outcome);
      this.#save(state.run); this.#saveOccurrence(state.occurrence, true);
      this.#recordCapacity(registration.tenant_ref); return state.run;
    });
  }
  attach(runId, wanted = null) { return this.#transaction('attach', () => { const current = this.run(runId); if (wanted !== null) core.expected(current, wanted); const run = core.attach(current); this.#save(run); return run; }); }
  setCleanupRequirements(runId, wanted, requirements) {
    return this.#transaction('cleanup-policy', () => {
      const run = this.run(runId); core.active(run, wanted, false); labels(requirements, 16); for (const item of requirements) digest(item);
      const next = { ...run, cleanup_requirements: [...requirements] }; this.#save(next); return next;
    });
  }
  applyPolicy(runId, wanted, policy) {
    return this.#transaction('policy', () => {
      const run = this.run(runId); core.active(run, wanted, false);
      const next = policyState(run, policy);
      artifactLimits(next.deployment_limits, this.artifact(run.tenant_ref, run.image_digest), this.artifact(run.tenant_ref, run.outcome_digest));
      this.#save(next); return next;
    });
  }
  freeze(runId, wanted, offerBytes, admitted) {
    const data = this.#admission.read(admitted);
    return this.#transaction('freeze', () => {
      const { offer, saved } = this.#offer(offerBytes);
      requireThat(saved === undefined && offer.source_host_id === this.#host, 'TransferAlreadyExists');
      const run = this.run(runId), occurrence = this.#occurrence(run);
      const registration = this.#registration(this.artifact(run.tenant_ref, run.registration_digest));
      this.#lineage(offer, registration, run.custody_epoch === '0' ? null : this.artifact(run.tenant_ref, run.predecessor_receipt_digest));
      requireThat(data.metadata.outcome_digest === run.outcome_digest && data.metadata.image_digest === run.image_digest && data.relocation !== null, 'ArtifactMismatch');
      requireThat(data.image.length === offer.artifact_lengths.image && data.outcome.length === offer.artifact_lengths.outcome, 'ArtifactMismatch');
      requireThat(data.relocation.destination_host_id === offer.destination_host_id && data.relocation.placement_intent_id === offer.placement_intent_id && data.relocation.requirements_digest === offer.requirements_digest && data.relocation.remaining_move_budget > 0, 'RelocationMismatch');
      const next = { ...core.freeze(run, occurrence, wanted, offer, hash(offerBytes)), offered_at_ms: Date.now().toString() };
      this.#remember(offer);
      this.artifact(run.tenant_ref, offer.image_digest); this.artifact(run.tenant_ref, offer.outcome_digest);
      const decisionKeys = [];
      for (const [id, key] of this.#keys) if (key.owner === offer.destination_host_id && key.status === 'active') decisionKeys.push({ id, owner: key.owner, spki: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') });
      requireThat(decisionKeys.length > 0, 'UnknownDestination');
      this.#run('INSERT INTO transfers VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)', offer.transfer_id, offer.run_id, run.tenant_ref, 'source', offerBytes, json(decisionKeys));
      this.#run('INSERT INTO outbox VALUES (?, ?)', offer.transfer_id, offerBytes); this.#save(next);
      this.#recordCapacity(run.tenant_ref); return next;
    });
  }
  beginTransfer(runId, wanted, admitted, { observationDigest, exportPolicyRevision, admissionDeadline = null }) {
    const run = this.run(runId), data = this.#admission.read(admitted);
    requireThat(data.relocation !== null, 'RelocationMismatch');
    const unsigned = { format: 'agent-mobility-offer/v1', run_id: runId, transfer_id: opaqueId(), source_host_id: this.#host,
      destination_host_id: data.relocation.destination_host_id, source_epoch: run.custody_epoch, destination_epoch: (counter(run.custody_epoch) + 1n).toString(), execution_revision: run.execution_revision,
      run_registration_digest: run.registration_digest, predecessor_receipt_digest: run.predecessor_receipt_digest, image_digest: run.image_digest, program_id: run.program_id,
      outcome_digest: run.outcome_digest, state_digest: run.state_digest, request_digest: run.request_digest, relocation_occurrence_id: run.current_occurrence_id,
      placement_intent_id: data.relocation.placement_intent_id, requirements_digest: data.relocation.requirements_digest, destination_observation_digest: observationDigest,
      trusted_runtime_profile: run.trusted_runtime_profile, classification: run.classification, export_policy_revision: exportPolicyRevision,
      deployment_limits: run.deployment_limits, cleanup_requirements: run.cleanup_requirements, resource_pin_summary: run.resource_pins,
      artifact_lengths: { image: data.image.length, outcome: data.outcome.length }, admission_deadline: admissionDeadline, key_id: this.#signer.keyId };
    const offer = signRecord('offer', unsigned, this.#signer.privateKey);
    const frozen = this.freeze(runId, wanted, offer, admitted);
    // No signed offer escapes this operation until freeze/outbox commit succeeds.
    return { run: frozen, offer };
  }
  outbox() { return this.#all('SELECT id, offer FROM outbox ORDER BY id').map(row => ({ id: row.id, offer: Uint8Array.from(row.offer) })); }
  savedDecision(offerBytes) { const { saved } = this.#offer(offerBytes); return saved?.receipt ? Uint8Array.from(saved.receipt) : null; }
  stage(envelope, kind, bytes) {
    requireThat(['image', 'outcome'].includes(kind), 'UnknownArtifact');
    return this.#transaction('stage', () => {
      const { offer, saved } = this.#offer(envelope.offer);
      requireThat(offer.destination_host_id === this.#host, 'WrongHost');
      if (saved?.receipt) return { receipt: Uint8Array.from(saved.receipt) };
      const registration = this.#registration(envelope.registration, offer.run_registration_digest);
      this.#lineage(offer, registration, envelope.predecessor);
      requireThat(bytes instanceof Uint8Array && bytes.length === offer.artifact_lengths[kind] && hash(bytes) === offer[`${kind}_digest`], 'ArtifactMismatch');
      const prior = this.#get('SELECT * FROM staging WHERE id=?', offer.transfer_id);
      if (prior) {
        for (const field of ['registration', 'requirements', 'constraints']) requireThat(equal(prior[field], envelope[field]), 'TransferConflict');
        requireThat(equal(prior.observation, canonical(envelope.observation)) && (prior.predecessor === null ? envelope.predecessor === null : envelope.predecessor !== null && equal(prior.predecessor, envelope.predecessor)), 'TransferConflict');
      } else {
        this.#remember(offer); this.#remember(registration);
        this.#run('INSERT INTO staging VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)', offer.transfer_id, registration.tenant_ref, envelope.offer, envelope.registration, envelope.predecessor, canonical(envelope.observation), envelope.requirements, envelope.constraints);
        this.#recordCapacity(registration.tenant_ref);
      }
      this.#artifact(registration.tenant_ref, envelope.registration);
      if (envelope.predecessor !== null) this.#artifact(registration.tenant_ref, envelope.predecessor);
      const artifactDigest = this.#artifact(registration.tenant_ref, bytes);
      // Column is selected only from the closed local two-artifact enum.
      this.#run(kind === 'image' ? 'UPDATE staging SET image_digest=? WHERE id=?' : 'UPDATE staging SET outcome_digest=? WHERE id=?', artifactDigest, offer.transfer_id);
      return { stored: kind, digest: artifactDigest };
    });
  }
  staged(offerBytes) {
    const { offer } = this.#offer(offerBytes), row = this.#get('SELECT * FROM staging WHERE id=?', offer.transfer_id);
    requireThat(row !== undefined && row.outcome_digest !== null, 'ArtifactsIncomplete');
    return { offer: Uint8Array.from(row.offer), registration: Uint8Array.from(row.registration), predecessor: row.predecessor === null ? null : Uint8Array.from(row.predecessor),
      observation: parse(row.observation), requirements: Uint8Array.from(row.requirements), constraints: Uint8Array.from(row.constraints),
      image: this.artifact(row.tenant, row.image_digest ?? offer.image_digest), outcome: this.artifact(row.tenant, row.outcome_digest) };
  }
  #decision(offer, acceptedCore, reason) {
    const key = this.#keys.get(this.#signer.keyId);
    requireThat(key?.status === 'active' && key.owner === this.#host && equal(key.publicKey.export({ type: 'spki', format: 'der' }), createPublicKey(this.#signer.privateKey).export({ type: 'spki', format: 'der' })), 'InvalidSigningKey');
    const base = { format: 'agent-mobility-decision/v1', run_id: offer.run_id, transfer_id: offer.transfer_id, offer_digest: hash(canonical(offer)),
      source_host_id: offer.source_host_id, destination_host_id: offer.destination_host_id, source_epoch: offer.source_epoch, destination_epoch: offer.destination_epoch,
      outcome_digest: offer.outcome_digest, relocation_occurrence_id: offer.relocation_occurrence_id, decision: acceptedCore === null ? 'refused' : 'accepted',
      target_policy_revision: acceptedCore?.policy_revision ?? this.#signer.policyRevision, key_id: this.#signer.keyId };
    return signRecord('decision', acceptedCore === null ? { ...base, reason_code: reason } : { ...base, accepted_record_digest: hash(canonical(acceptedCore)) }, this.#signer.privateKey);
  }
  refuse(offerBytes, registrationBytes, reason = 'withdrawn') {
    return this.#transaction('refuse', () => {
      const { offer, saved } = this.#offer(offerBytes);
      requireThat(offer.destination_host_id === this.#host, 'WrongHost');
      if (saved?.receipt) return Uint8Array.from(saved.receipt);
      const registration = this.#registration(registrationBytes, offer.run_registration_digest);
      requireThat(offer.run_id === registration.run_id, 'RegistrationMismatch');
      this.#remember(offer); this.#remember(registration);
      const receipt = this.#decision(offer, null, reason); this.#remember(parse(receipt));
      this.#artifact(registration.tenant_ref, registrationBytes);
      this.#artifact(registration.tenant_ref, receipt);
      this.#run('INSERT INTO transfers VALUES (?, ?, ?, ?, ?, ?, NULL, ?)', offer.transfer_id, offer.run_id, registration.tenant_ref, 'target', offerBytes, receipt, '[]');
      this.#run('DELETE FROM staging WHERE id=?', offer.transfer_id);
      this.#recordCapacity(registration.tenant_ref);
      return receipt;
    });
  }
  accept(offerBytes, registrationBytes, admitted, { policyRevision, classification, deploymentLimits, observation, predecessorBytes = null }) {
    return this.#transaction('accept', () => {
      const { offer, saved } = this.#offer(offerBytes);
      requireThat(offer.destination_host_id === this.#host, 'WrongHost');
      if (saved?.receipt) return Uint8Array.from(saved.receipt);
      const data = this.#admission.read(admitted);
      const registration = this.#registration(registrationBytes, offer.run_registration_digest);
      requireThat(offer.run_id === registration.run_id, 'RegistrationMismatch');
      this.#lineage(offer, registration, predecessorBytes);
      for (const key of ['image_digest', 'program_id', 'trusted_runtime_profile']) requireThat(registration[key] === offer[key], 'RegistrationMismatch');
      for (const key of ['image_digest', 'outcome_digest', 'program_id', 'trusted_runtime_profile', 'state_digest', 'request_digest']) requireThat(data.metadata[key] === offer[key], 'ArtifactMismatch');
      requireThat(data.image.length === offer.artifact_lengths.image && data.outcome.length === offer.artifact_lengths.outcome, 'ArtifactMismatch');
      requireThat(data.relocation !== null && data.relocation.destination_host_id === this.#host && data.relocation.placement_intent_id === offer.placement_intent_id && data.relocation.requirements_digest === offer.requirements_digest && data.relocation.remaining_move_budget > 0, 'RelocationMismatch');
      requireThat(offer.resource_pin_summary.length === 0, 'PinnedResource');
      requireThat(hash(encodeValue(schemas.observation, observationValue(observation))) === offer.destination_observation_digest && observation.requirements_digest === offer.requirements_digest && observation.runtime_profile === offer.trusted_runtime_profile && observation.policy_revision === policyRevision, 'ObservationMismatch');
      for (const key of Object.keys(registration.deployment_limits)) requireThat(offer.deployment_limits[key] <= registration.deployment_limits[key], 'LimitsWidened');
      requireThat(registration.initial_classification.every(label => offer.classification.includes(label)), 'ClassificationDowngrade');
      requireThat(offer.admission_deadline === null || counter(offer.admission_deadline) >= BigInt(Date.now()), 'AdmissionExpired');
      const acceptedCore = core.acceptedCore(offer, policyRevision, classification, deploymentLimits);
      artifactLimits(acceptedCore.deployment_limits, data.image, data.outcome);
      const receipt = this.#decision(offer, acceptedCore, null), arrival = encodeArrival(offer, hash(receipt), observation);
      const next = core.accept(this.run(offer.run_id), registration, offer, acceptedCore, hash(receipt), hash(arrival));
      this.#remember(offer); this.#remember(registration); this.#remember(parse(receipt));
      this.#artifact(registration.tenant_ref, registrationBytes); this.#artifact(registration.tenant_ref, data.image); this.#artifact(registration.tenant_ref, data.outcome); this.#artifact(registration.tenant_ref, arrival);
      this.#artifact(registration.tenant_ref, receipt);
      if (predecessorBytes !== null) this.#artifact(registration.tenant_ref, predecessorBytes);
      this.#save(next.run); this.#saveOccurrence(next.occurrence, true);
      this.#run('INSERT INTO transfers VALUES (?, ?, ?, ?, ?, ?, ?, ?)', offer.transfer_id, offer.run_id, registration.tenant_ref, 'target', offerBytes, receipt, canonical(acceptedCore), '[]');
      this.#run('DELETE FROM staging WHERE id=?', offer.transfer_id);
      this.#recordCapacity(registration.tenant_ref);
      return receipt;
    });
  }
  receiveDecision(offerBytes, receiptBytes) {
    return this.#transaction('decision', () => {
      const { offer, saved } = this.#offer(offerBytes);
      requireThat(saved?.direction === 'source', 'UnknownTransfer');
      if (saved.receipt) { requireThat(equal(saved.receipt, receiptBytes), 'DecisionConflict'); return this.run(offer.run_id); }
      const receipt = validate('decision', parse(receiptBytes)); matchesDecision(offer, receipt, hash(offerBytes));
      const keys = new Map(this.#keys), retained = readJson(saved.decision_keys).find(key => key.id === receipt.key_id);
      if (retained && (!keys.has(receipt.key_id) || keys.get(receipt.key_id).status === 'retired')) keys.set(retained.id, { owner: retained.owner, status: 'retired', publicKey: createPublicKey({ key: Buffer.from(retained.spki, 'base64url'), type: 'spki', format: 'der' }) });
      verifyRecord('decision', receiptBytes, keys, { historicalDigest: retained ? hash(receiptBytes) : null });
      const run = this.run(offer.run_id), occurrence = this.#occurrence(run);
      const refusal = receipt.decision === 'refused' ? encodeRefusal(offer.destination_host_id, receipt.reason_code, hash(receiptBytes)) : null;
      const next = core.decideSource(run, occurrence, offer, receipt, hash(receiptBytes), refusal === null ? null : hash(refusal));
      next.run = { ...next.run, last_transfer_id: offer.transfer_id };
      if (refusal !== null) next.occurrence = { ...next.occurrence, refusal_reason: receipt.reason_code };
      if (refusal !== null) this.#artifact(run.tenant_ref, refusal);
      this.#artifact(run.tenant_ref, receiptBytes);
      this.#remember(receipt); this.#save(next.run); this.#saveOccurrence(next.occurrence);
      this.#run('UPDATE transfers SET receipt=? WHERE id=?', receiptBytes, offer.transfer_id); this.#run('DELETE FROM outbox WHERE id=?', offer.transfer_id);
      return next.run;
    });
  }
  admitLeaf(runId, wanted, classification, options = {}) {
    try { return this.#transaction('dispatch', () => {
      const run = this.run(runId), next = core.dispatch(run, this.#occurrence(run), wanted, opaqueId(), classification, options);
      if (options.charge) { this.#charge(run, options.charge); next.occurrence.work_kind = options.charge.kind; }
      this.#save(next.run); this.#saveOccurrence(next.occurrence); return next.occurrence;
    }); } catch (error) {
      // Diagnostics cannot mutate custody or replace the rejected operation.
      if (['StaleExecutor', 'CustodyFrozen'].includes(error.code)) {
        this.noteStaleDispatch(runId);
      }
      throw error;
    }
  }
  allowance(runId, kind) { return readJson(this.#get('SELECT body FROM allowances WHERE run_id=? AND kind=?', runId, kind)?.body); }
  #charge(run, charge) {
    closed(charge, ['owner', 'kind', 'grant', 'limit', 'amount']);
    requireThat(charge.owner === this.#host && ['model', 'check'].includes(charge.kind), 'SpendOwnerMismatch'); digest(charge.grant);
    closed(charge.limit, ['attempts', 'request_bytes', 'output_tokens', 'concurrent']); closed(charge.amount, ['request_bytes', 'output_tokens']);
    requireThat(Number.isSafeInteger(charge.limit.attempts) && charge.limit.attempts > 0 && charge.limit.attempts <= (charge.kind === 'model' ? 32 : 16), 'WorkAllowance');
    for (const field of ['request_bytes', 'output_tokens']) for (const row of [charge.limit, charge.amount])
      requireThat(Number.isSafeInteger(row[field]) && row[field] >= 0, 'WorkAllowance');
    requireThat(Number.isSafeInteger(charge.limit.concurrent) && charge.limit.concurrent > 0 && charge.limit.concurrent <= 8, 'WorkConcurrency');
    const pending = this.#all('SELECT occurrences.body FROM occurrences JOIN runs USING(run_id) WHERE tenant=?', run.tenant_ref)
      .map(row => readJson(row.body)).filter(row => row.work_kind === charge.kind && ['DISPATCHING', 'UNKNOWN'].includes(row.status)).length;
    requireThat(pending < charge.limit.concurrent, 'WorkConcurrency');
    const binding = { registration_digest: run.registration_digest, owner: charge.owner, kind: charge.kind, grant: charge.grant, limit: charge.limit };
    const grantDigest = hash(canonical(binding)), previous = this.allowance(run.run_id, charge.kind);
    requireThat(previous === null || previous.grant_digest === grantDigest, 'WorkAllowanceChanged');
    const used = previous?.used ?? { attempts: 0, request_bytes: 0, output_tokens: 0 };
    const next = Object.fromEntries(Object.entries({ attempts: 1, ...charge.amount }).map(([field, count]) => {
      const value = used[field] + count; requireThat(value <= charge.limit[field], 'WorkAllowanceExhausted'); return [field, value];
    }));
    this.#run('INSERT INTO allowances VALUES (?,?,?,?) ON CONFLICT(run_id,kind) DO UPDATE SET body=excluded.body', run.run_id, charge.kind, run.tenant_ref,
      json({ ...binding, grant_digest: grantDigest, used: next }));
    this.#recordCapacity(run.tenant_ref);
  }
  deferLeaf(runId, wanted, pending, classification) {
    const bytes = canonical(pending, 2 << 20);
    identifier(pending.binding_revision); digest(pending.request_digest);
    requireThat(Object.hasOwn(pending, 'question') && typeof pending.result_schema === 'string' && /^[A-Za-z0-9_-]+$/.test(pending.result_schema), 'InvalidPendingQuestion');
    const schema = Buffer.from(pending.result_schema, 'base64url');
    requireThat(schema.toString('base64url') === pending.result_schema && equal(encodeSchema(decodeSchema(schema)), schema), 'InvalidPendingQuestion');
    requireThat(pending.format === 'agent-deferred-leaf/v1' && typeof pending.audience === 'string' && pending.audience.length > 0, 'InvalidPendingQuestion');
    requireThat(Array.isArray(pending.alternatives) && pending.alternatives.length > 0 && pending.alternatives.length <= 16 && new Set(pending.alternatives).size === pending.alternatives.length, 'InvalidPendingQuestion');
    pending.alternatives.forEach(value => identifier(value));
    requireThat(Number.isSafeInteger(pending.maximum_text_bytes) && pending.maximum_text_bytes >= 0 && pending.maximum_text_bytes <= 8192, 'InvalidPendingQuestion');
    return this.#transaction('defer', () => {
      const run = this.run(runId), next = core.awaiting(run, this.#occurrence(run), wanted, opaqueId(), hash(bytes), classification);
      requireThat(pending.principal === run.principal_ref && pending.tenant === run.tenant_ref && pending.request_digest === run.request_digest, 'QuestionMismatch');
      this.#artifact(run.tenant_ref, bytes); this.#save(next.run); this.#saveOccurrence(next.occurrence); return next.occurrence;
    });
  }
  answerDeferred(runId, wanted, binding, identity, answer, reply, classification) {
    return this.#transaction('answer', () => {
      const run = this.run(runId), occurrence = this.#occurrence(run);
      core.active(run, wanted, false); core.current(run, occurrence);
      requireThat(typeof occurrence.pending_digest === 'string', 'QuestionNotPending');
      const pending = parse(this.artifact(run.tenant_ref, occurrence.pending_digest), { maximum: 2 << 20 });
      requireThat(identity?.principal === run.principal_ref && identity?.tenant === run.tenant_ref && Array.isArray(identity.audiences) && identity.audiences.includes(pending.audience), 'UserDenied');
      requireThat(answer && Object.keys(answer).sort().join(',') === 'choice,text' && pending.alternatives.includes(answer.choice) && typeof answer.text === 'string' && Buffer.byteLength(answer.text) <= pending.maximum_text_bytes, 'InvalidAnswer');
      const next = core.answered(run, occurrence, wanted, binding, hash(canonical(answer)), hash(reply), classification);
      this.#artifact(run.tenant_ref, reply); this.#save(next.run); this.#saveOccurrence(next.occurrence); return next.occurrence;
    });
  }
  markUnknown(runId, attemptId) {
    return this.#transaction('unknown', () => { const run = this.run(runId), next = core.unknown(run, this.#occurrence(run), attemptId); this.#saveOccurrence(next); return next; });
  }
  // Called only by the admitted repository publication leaf while holding its
  // process gate. This transaction is the local cancellation ordering point;
  // it stores the exact intent before that gate holder becomes Git.
  admitPublication(runId, wanted, attemptId, proposal, policyRevision) {
    return this.#transaction('publication-intent', () => {
      const run = this.run(runId), occurrence = this.#occurrence(run);
      core.active(run, wanted); core.current(run, occurrence);
      requireThat(run.cancel_requested === null, 'CancellationPending');
      requireThat(occurrence.operation === 'agent.repository.publish.v1' && occurrence.status === 'DISPATCHING' &&
        occurrence.attempt_id === attemptId && occurrence.publication_intent_digest === undefined && occurrence.cancel_safe !== true, 'PublicationOccurrenceMismatch');
      const binding = proposal?.core?.binding;
      requireThat(binding?.run === runId && binding.principal === run.principal_ref && binding.tenant === run.tenant_ref &&
        binding.policyRevision === policyRevision && policyRevision === run.policy_revision, 'PublicationAuthorityMismatch');
      digest(binding.intent);
      const destination = proposal.core.destination;
      requireThat(!this.publicationRecords(run.tenant_ref, destination.repository, destination.generation, destination.managedRef)
        .some(row => row.intent.proposal.core.binding.intent === binding.intent || row.intent.proposal.commitOid === proposal.commitOid), 'PublicationIntentReused');
      const { digest: proposalDigest, ...body } = proposal;
      requireThat(hash(canonical(body, 2 << 20)) === proposalDigest, 'PublicationProposalMismatch');
      const intent = { format: 'agent.repository.publication-intent/v1', proposal,
        admission: { run_id: runId, occurrence_id: occurrence.id, attempt_id: attemptId, request_digest: run.request_digest,
          registration_digest: run.registration_digest, source_version: core.version(run), policy_revision: policyRevision } };
      const bytes = canonical(intent, 2 << 20), value = this.#artifact(run.tenant_ref, bytes);
      this.#saveOccurrence({ ...occurrence, publication_intent_digest: value });
      return { ...intent.admission, intent_digest: value };
    });
  }
  acquiredReplies(runId, operation) {
    const run = this.run(runId); requireThat(run, 'UnknownRun');
    return this.#all('SELECT body FROM occurrences WHERE run_id=?', runId).map(row => readJson(row.body))
      .filter(row => row.operation === operation && row.reply_digest)
      .map(row => this.artifact(run.tenant_ref, row.reply_digest));
  }
  latestPublication(runId) {
    const run = this.run(runId); requireThat(run, 'UnknownRun');
    const rows = this.#all('SELECT body FROM occurrences WHERE run_id=? ORDER BY rowid DESC', runId);
    for (const row of rows) {
      const occurrence = readJson(row.body);
      if (!occurrence.publication_receipt_digest) continue;
      const receipt = parse(this.artifact(run.tenant_ref, occurrence.publication_receipt_digest), { maximum: 2 << 20 });
      if (receipt.status === 'Published') return receipt;
    }
    return null;
  }
  publicationRecords(tenant, repository, generation, managedRef) {
    // Occurrences already have a tenant-wide record quota. Do not create a
    // second workflow database or infer successful publication from a reflog.
    const rows = this.#all('SELECT occurrences.body FROM occurrences JOIN runs USING(run_id) WHERE tenant=?', tenant);
    const result = [];
    for (const row of rows) {
      const occurrence = readJson(row.body);
      if (!occurrence.publication_intent_digest) continue;
      const intent = parse(this.artifact(tenant, occurrence.publication_intent_digest), { maximum: 2 << 20 });
      const target = intent.proposal.core.destination;
      if (target.repository !== repository || target.generation !== generation || target.managedRef !== managedRef) continue;
      result.push({ intent, intent_digest: occurrence.publication_intent_digest,
        receipt: occurrence.publication_receipt_digest ? parse(this.artifact(tenant, occurrence.publication_receipt_digest), { maximum: 2 << 20 }) : null });
    }
    return result;
  }
  abandonLeaf(runId, attemptId, settlement = {}) {
    return this.#transaction('abandon', () => { const run = this.run(runId), next = core.abandoned(run, this.#occurrence(run), attemptId, settlement); this.#saveOccurrence(next); return next; });
  }
  recordReply(runId, attemptId, reply, classification, reconciliationRef = null, { placementEvidence = null, dispatchVersion = null, publicationReceipt = null } = {}) {
    return this.#transaction('acquire', () => {
      const run = this.run(runId);
      if (dispatchVersion !== null) {
        // Executor attachment can change while the same occurrence is in flight.
        // Semantic progress, custody change, or cancellation cannot.
        requireThat(['run_id', 'custody_epoch', 'execution_revision', 'outcome_digest'].every(field => run[field] === dispatchVersion[field]), 'StaleDispatch');
        requireThat(run.cancel_requested === null, 'CancellationPending');
      }
      const next = core.acquired(run, this.#occurrence(run), attemptId, hash(reply), classification, reconciliationRef);
      if (next.occurrence.publication_intent_digest) {
        const intent = parse(this.artifact(run.tenant_ref, next.occurrence.publication_intent_digest), { maximum: 2 << 20 });
        requireThat(publicationReceipt && ['Published', 'NotApplied', 'Conflict'].includes(publicationReceipt.status) &&
          publicationReceipt.proposal === intent.proposal.digest &&
          (publicationReceipt.status === 'Published' ? publicationReceipt.commit === intent.proposal.commitOid : publicationReceipt.commit === null) &&
          hash(canonical(publicationReceipt.admission)) === hash(canonical({ ...intent.admission, intent_digest: next.occurrence.publication_intent_digest })), 'PublicationReceiptMismatch');
        const receiptBytes = canonical(publicationReceipt, 2 << 20), receiptDigest = hash(receiptBytes);
        requireThat(next.occurrence.publication_receipt_digest === undefined || next.occurrence.publication_receipt_digest === receiptDigest, 'PublicationReceiptConflict');
        next.occurrence = { ...next.occurrence, publication_receipt_digest: this.#artifact(run.tenant_ref, receiptBytes) };
      } else requireThat(publicationReceipt === null, 'PublicationIntentMissing');
      if (placementEvidence !== null) {
        requireThat(next.occurrence.operation === 'agent.mobility.resolve.v1', 'InvalidPlacementEvidence');
        next.run = { ...next.run, placement_evidence: placementEvidence };
      }
      this.#artifact(run.tenant_ref, reply); this.#save(next.run); this.#saveOccurrence(next.occurrence); return next.run;
    });
  }
  settleUnsentRelocation(runId, wanted, admitted, reason) {
    const data = this.#admission.read(admitted);
    return this.#transaction('unsent-refusal', () => {
      const run = this.run(runId), occurrence = this.#occurrence(run); core.active(run, wanted, false); core.current(run, occurrence);
      requireThat(occurrence.status === 'READY' && occurrence.operation === core.RELOCATE && data.relocation !== null && data.metadata.outcome_digest === run.outcome_digest, 'RelocationMismatch');
      const reply = encodeRefusal(data.relocation.destination_host_id, reason), replyDigest = this.#artifact(run.tenant_ref, reply);
      const next = { ...run, reply_digest: replyDigest };
      this.#save(next); this.#saveOccurrence({ ...occurrence, status: 'SETTLED_REPLY', reply_digest: replyDigest, refusal_reason: reason }); return next;
    });
  }
  publishOutcome(runId, wanted, control, admitted) {
    const data = this.#admission.read(admitted);
    return this.#transaction('publish', () => {
      const run = this.run(runId); requireThat(run.image_digest === data.metadata.image_digest && run.program_id === data.metadata.program_id, 'ImageMismatch');
      artifactLimits(run.deployment_limits, data.image, data.outcome);
      requireThat(data.predecessor?.outcome_digest === run.outcome_digest && hash(canonical(data.predecessor.control)) === hash(canonical(control)), 'UnboundSuccessor');
      const next = core.publish(run, this.#occurrence(run), wanted, control, data.metadata, opaqueId());
      this.#artifact(run.tenant_ref, data.outcome); this.#save(next.run); this.#saveOccurrence(next.previous); this.#saveOccurrence(next.occurrence, true);
      if (next.occurrence !== null) this.#recordCapacity(run.tenant_ref);
      return next.run;
    });
  }
  requestCancel(runId, reason) { return this.#transaction('cancel', () => { const next = core.cancel(this.run(runId), reason); this.#save(next); return next; }); }
  cancellationForwarded(runId, epoch) {
    return this.#transaction('cancel-forwarded', () => {
      const run = this.run(runId);
      if (run.custody_epoch === epoch && run.status === 'DEPARTED' && run.cancel_requested !== null) this.#save({ ...run, cancel_forwarded: true });
    });
  }
  retirementIssue(runId, executorVersion, code) {
    requireThat(executorVersion.run_id === runId && /^[A-Za-z0-9_]{1,80}$/.test(code), 'InvalidDiagnostic');
    return this.#transaction('retirement-diagnostic', () => {
      const run = this.run(runId); requireThat(run !== null, 'UnknownRun');
      const issue = { custody_epoch: executorVersion.custody_epoch, executor_incarnation: executorVersion.executor_incarnation, code };
      this.#save({ ...run, retirement_issues: [...(run.retirement_issues ?? []).slice(-7), issue] });
    });
  }
  resourcePin(runId, wanted, name, add) { return this.#transaction('pin', () => { const next = core.pin(this.run(runId), wanted, name, add); this.#save(next); return next; }); }
  recover() { return this.#all('SELECT body FROM runs ORDER BY run_id').map(row => { const run = readJson(row.body); return { run, occurrence: this.#occurrence(run) }; }); }
  noteStaleDispatch(runId) {
    try { if (this.run(runId) && (this.#staleDispatch.has(runId) || this.#staleDispatch.size < this.#recordLimit)) this.#staleDispatch.set(runId, Math.min(Number.MAX_SAFE_INTEGER, (this.#staleDispatch.get(runId) ?? 0) + 1)); } catch {}
  }
  metrics(runId) {
    const run = this.run(runId); requireThat(run !== null, 'UnknownRun');
    const refused = Object.create(null);
    for (const row of this.#all('SELECT body FROM occurrences WHERE run_id=?', runId)) {
      const reason = readJson(row.body).refusal_reason;
      if (reason !== undefined) refused[reason] = (refused[reason] ?? 0) + 1;
    }
    return { run_id: runId, host_id: this.#host, local_move_attempts: run.local_move_attempts, allowances: Object.fromEntries(['model', 'check'].map(kind => [kind, this.allowance(runId, kind)])), ...this.custodyKnowledge(run), refusals_by_reason: refused, stale_dispatch_rejections_since_open: this.#staleDispatch.get(runId) ?? 0 };
  }
  custodyKnowledge(run) {
    const pending = run.status === 'OFFERED', id = run.transfer_id ?? run.last_transfer_id, transfer = id ? this.transfer(id) : null;
    const offer = transfer ? parse(transfer.offer) : null, receipt = transfer?.receipt ? parse(transfer.receipt) : null;
    return { known_custodian: pending ? null : run.status === 'DEPARTED' ? offer?.destination_host_id ?? null : this.#host,
      transfer_destination: offer?.destination_host_id ?? null, transfer_decision: pending ? 'unknown' : receipt?.decision ?? null,
      ambiguity_duration_ms: pending ? run.offered_at_ms === undefined ? null : Math.max(0, Date.now() - Number(run.offered_at_ms)).toString() : '0',
      active_pins: [...run.resource_pins] };
  }
  collectArtifacts(tenant) {
    identifier(tenant);
    return this.#transaction('collect', () => {
      const retained = new Set();
      const retain = value => { if (value !== null && value !== undefined) retained.add(value); };
      for (const row of this.#all('SELECT body FROM runs WHERE tenant=?', tenant)) {
        const run = readJson(row.body);
        for (const key of ['image_digest', 'outcome_digest', 'reply_digest', 'registration_digest', 'predecessor_receipt_digest']) retain(run[key]);
        retain(this.#occurrence(run)?.pending_digest);
      }
      for (const row of this.#all('SELECT occurrences.body FROM occurrences JOIN runs USING(run_id) WHERE tenant=?', tenant)) {
        const occurrence = readJson(row.body);
        // Publication ancestry outlives the originating run. Check results are
        // authority evidence, including while that run is at another host.
        retain(occurrence.publication_intent_digest); retain(occurrence.publication_receipt_digest);
        if (occurrence.operation === 'agent.repository.check.v1') retain(occurrence.reply_digest);
      }
      for (const row of this.#all('SELECT offer, receipt FROM transfers WHERE tenant=?', tenant)) {
        const offer = parse(row.offer); retain(offer.run_registration_digest); retain(offer.predecessor_receipt_digest);
        if (row.receipt !== null) retain(hash(row.receipt));
        if (row.receipt === null || parse(row.receipt).decision === 'accepted') { retain(offer.image_digest); retain(offer.outcome_digest); }
      }
      for (const row of this.#all('SELECT offer FROM staging WHERE tenant=?', tenant)) {
        const offer = parse(row.offer);
        for (const key of ['image_digest', 'outcome_digest', 'run_registration_digest', 'predecessor_receipt_digest']) retain(offer[key]);
      }
      let removed = 0;
      for (const row of this.#all('SELECT digest FROM artifacts WHERE tenant=?', tenant)) if (!retained.has(row.digest)) removed += this.#run('DELETE FROM artifacts WHERE tenant=? AND digest=?', tenant, row.digest).changes;
      return { removed };
    });
  }
}
