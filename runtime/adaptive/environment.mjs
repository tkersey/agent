// Frozen launch inputs and pure leaf bindings for the single authored image.
import assert from 'node:assert/strict';
import {openSync, closeSync, fstatSync, readSync, constants} from 'node:fs';
import {hash, codecs} from './codec.mjs';
import {digest, identities, policy as admitPolicy, catalog as admitCatalog, same} from './admission.mjs';
import {parseJsonStrict} from '../model.mjs';
import {canonical} from './json.mjs';
import * as snapshots from './snapshot.mjs';
import {instructions as renderInstructions} from './preparation.mjs';
import {reference} from './work.mjs';

const utf8 = bytes => new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
export function readFile(path, maximum, privateFile = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert(before.isFile() && before.size <= BigInt(maximum), 'regular bounded file required');
    if (privateFile) assert(before.uid === BigInt(process.getuid()) && (before.mode & 0o077n) === 0n && before.nlink === 1n, 'private credential file required');
    const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
    const after = fstatSync(fd, {bigint: true});
    assert(BigInt(length) === before.size && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]), 'file changed while reading');
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}

export function application(bytes, image) {
  assert(bytes.length <= 16 * 1024 * 1024);
  const value = parseJsonStrict(utf8(bytes));
  assert(value.format === 'agent-native-application/v1' && value.application_id === 'adaptive-agent' && value.application_version === '1.0.0');
  assert.equal(value.program_sha256, hash(image));
  const codec = codecs(value), resources = new Map();
  for (const item of value.resources) {
    const body = Buffer.from(item.base64url, 'base64url');
    assert(body.toString('base64url') === item.base64url && body.length === item.bytes && hash(body) === item.sha256 && !resources.has(item.id));
    resources.set(item.id, body);
  }
  for (const [field, type] of [['input', 'Input'], ['output', 'Output'], ['answer', 'Answer'], ['message', 'Message'], ['failure', 'Failure']])
    assert.equal(value[field].wire_sha256, hash(codec.schema(type)), 'application schema mismatch');
  return {value, bytes, image, codec, resources, tools: codec.constant('tools', 'Tools')};
}

const fixtureProfile = (id, model) => ({id, model, reasoning_mode: 'standard', reasoning_context: 'auto', efforts: ['medium', 'high'],
  effort_update: false, explicit_cache: true, additional_tools: true, cache_diagnostics: true, opaque_family: 'fixture',
  max_output_tokens: 4096, request_bytes: 256 * 1024, response_bytes: 512 * 1024, timeout_ms: 1000});

export function configure(app, options, saved = null) {
  assert(!options.offline || (!options.config && !options.credential && !options.testTrustRoot), 'offline inputs are fixed fixtures');
  let config = null, configDigest = null;
  if (options.config) {
    const parsed = parseJsonStrict(utf8(readFile(options.config, 256 * 1024)));
    config = app.codec.fromClient('Configuration', parsed); configDigest = hash(canonical(parsed));
  }
  const mode = options.offline ? 'offline' : options.testTrustRoot ? 'controlled-test' : 'live';
  let profile, resources;
  if (saved) { profile = saved.profile; resources = saved.resources; }
  else {
    assert(options.offline || config !== null, 'approved configuration required');
    const contents = Buffer.from('pub fn main() void {\n    // The offline fixture has no external effects.\n}\n');
    const snapshot = config ? snapshots.capture(app.codec, config.snapshot_root) : app.codec.encode('Snapshot', {version: 1, excluded_entries: 0,
      files: [{path: 'src/main.zig', sha256: digest(contents), contents}]});
    resources = [snapshot];
    const skills = (config?.skills ?? ['repository-orientation', 'invariant-review', 'technical-reporting'].map(id => ({id, version: '1', description: id,
      tools: app.tools.map(tool => id === 'invariant-review' && tool.name === 'inspect')}))).map(skill => {
      const body = config ? readFile(skill.markdown, 32 * 1024) : app.resources.get(skill.id);
      assert(body && body.length && body.length <= 32 * 1024); utf8(body); resources.push(body);
      return {id: skill.id, version: skill.version, description: skill.description, instructions: reference(body), tools: skill.tools};
    });
    const catalog = app.codec.encode('Catalog', {skills}); resources.push(catalog);
    const policy = {schema: identities.policy, endpoint: config?.endpoint ?? 'https://offline.invalid/v1/responses', audience: config?.audience ?? 'offline-fixture',
      profiles: config?.profiles ?? [fixtureProfile('analysis', 'fixture-model-a'), fixtureProfile('deep', 'fixture-model-b')], catalog: reference(catalog),
      core_tools: app.tools.map(tool => tool.name !== 'inspect'), permitted_tools: app.tools.map(() => true),
      model_attempts: config?.maximum_model_calls ?? 16, control_transitions: config?.maximum_control_revision ?? 16};
    profile = canonical({mode, application: app.value.application_id, assets: hash(app.bytes), configuration_digest: configDigest ?? hash(Buffer.from('adaptive-agent.offline.v1')),
      workspace: config?.workspace ?? 'offline-fixture', snapshot: {digest: digest(snapshot), bytes: String(snapshot.length)},
      adaptive: app.codec.toClient('Policy', policy), initial_profile: config?.initial_profile ?? 'analysis', initial_effort: config?.initial_effort ?? 'medium'});
  }
  assert(profile.length <= 256 * 1024);
  const root = parseJsonStrict(utf8(profile));
  assert(root.mode === mode && root.application === app.value.application_id && root.assets === hash(app.bytes), 'frozen configuration mismatch');
  if (configDigest !== null) assert.equal(root.configuration_digest, configDigest);
  const policy = admitPolicy(app.codec, app.codec.fromClient('Policy', root.adaptive));
  assert(policy.model_attempts <= 16 && policy.control_transitions <= 16 && policy.profiles.every(entry => !entry.effort_update), 'unqualified capacity or effort-update profile');
  if (!options.offline) {
    const endpoint = new URL(policy.endpoint);
    if (options.testTrustRoot) assert(!options.credential && endpoint.protocol === 'https:' && ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname) && endpoint.pathname === '/v1/responses' && endpoint.port && !endpoint.search);
    else assert.equal(policy.endpoint, 'https://api.openai.com/v1/responses');
  }
  assert(resources.length >= 2 && same(root.snapshot.digest, digest(resources[0])) && BigInt(root.snapshot.bytes) === BigInt(resources[0].length));
  assert(resources.reduce((total, bytes) => total + bytes.length, 0) <= 16 * 1024 * 1024, 'frozen resource byte capacity');
  const objects = new Map(resources.map(bytes => [hash(bytes), bytes]));
  const object = ref => { const bytes = objects.get(Buffer.from(ref.digest).toString('hex')); assert(bytes, 'missing frozen resource'); return bytes; };
  const catalog = admitCatalog({codec: app.codec, object}, policy);
  assert(catalog.skills.length <= 14, 'frozen resource count capacity');
  assert(resources.length === catalog.skills.length + 2 && same(policy.catalog.digest, digest(resources.at(-1))) && BigInt(policy.catalog.bytes) === BigInt(resources.at(-1).length));
  catalog.skills.forEach((skill, index) => {
    const body = resources[index + 1]; assert(same(skill.instructions.digest, digest(body)) && BigInt(skill.instructions.bytes) === BigInt(body.length)); utf8(body);
  });
  const selected = policy.profiles.find(entry => entry.id === root.initial_profile);
  assert(selected && selected.efforts.includes(root.initial_effort), 'invalid initial inference selection');
  const initial = {selection: {profile_id: selected.id, profile_digest: digest(app.codec.encode('Profile', selected)), effective_effort: root.initial_effort, control_revision: 0},
    top_effort: root.initial_effort, epoch: 0, epoch_reason: 'initial', eviction_generation: 0, skills: []};
  const instructions = utf8(app.resources.get('adaptive-agent.instructions'));
  renderInstructions(instructions, policy, catalog);
  let token = options.testTrustRoot ? 'qualification-only' : '';
  if (options.credential) token = utf8(readFile(options.credential, 16 * 1024, true)).replace(/^[\r\n]+|[\r\n]+$/g, '');
  if (options.credential) {
    assert(/^[\x21-\x7e]{1,4096}$/.test(token), 'invalid explicit credential');
    const contains = value => typeof value === 'string' ? value.includes(token) : value && typeof value === 'object' ?
      Object.entries(value).some(([key, child]) => key.includes(token) || contains(child)) : false;
    assert(!contains(root), 'credential embedded in task profile');
    assert([...resources, profile].every(bytes => !Buffer.from(bytes).includes(token)), 'credential embedded in task resources');
  }
  const testTrustRoot = options.testTrustRoot ? readFile(options.testTrustRoot, 64 * 1024) : undefined;
  return {codec: app.codec, tools: app.tools, profile, resources, policy, catalog, snapshot: snapshots.open(app.codec, resources[0]), initial, instructions, tenant: 'local',
    object, mode, offline: !!options.offline, provider: {enabled: !!options.authorizeInference, token, endpoint: policy.endpoint, testTrustRoot},
    fixture: options.offline ? parseJsonStrict(utf8(app.resources.get('adaptive-agent.offline-responses'))) : null};
}

export function bindings(ctx) {
  return ctx.codec.encode('Bindings', {policy: digest(ctx.profile), snapshot: ctx.snapshot.identity, files: ctx.snapshot.files.length,
    excluded_entries: ctx.snapshot.excluded_entries, profiles: ctx.policy.profiles.map(entry => ({profile: {id: entry.id, efforts: entry.efforts,
      effort_update: entry.effort_update}, digest: digest(ctx.codec.encode('Profile', entry))})),
    catalog: {skills: ctx.catalog.skills.map(({id, version, instructions}) => ({id, version, instructions}))}, initial: ctx.initial,
    maximum_model_calls: ctx.policy.model_attempts, maximum_revision: ctx.policy.control_transitions,
    instructions: renderInstructions(ctx.instructions, ctx.policy, ctx.catalog),
    status: `Initial profile: ${ctx.initial.selection.profile_id}; effort: ${ctx.initial.selection.effective_effort}; control revision: 0. Snapshot: ${ctx.snapshot.files.length} files, ${ctx.snapshot.excluded_entries} excluded entries. Read-only work allowance: 12; inference allowance: ${ctx.policy.model_attempts}.`});
}
