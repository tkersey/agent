// Leaf bindings for a caller-owned repository and explicit file capabilities.
// The Program owns decision order, working memory, approval and completion.
import { createDocumentEnvironment } from "./document.mjs";
import { createRepositoryDelivery } from "./repository_delivery.mjs";
import { runRepositorySnapshot } from "./repository_tests.mjs";
import { openRepositorySnapshotStore } from "./repository_snapshot.mjs";
export { provisionRepository } from "./repository_snapshot.mjs";

/** Snapshot leaves for the mobile application. Their actual dispatch remains
 * under the mobility policy/current occurrence; these resource IDs are data. */
export async function createManagedRepositoryEnvironment(options) {
  const { resourceOwner, classification, ...storage } = options;
  if (!text(resourceOwner, 128) || !resourceOwner || !Array.isArray(classification) ||
      classification.length > 16 || classification.some(label => !text(label, 128) || !label) ||
      new Set(classification).size !== classification.length) throw new TypeError('invalid repository classification/owner');
  const labels = [...classification].sort(), store = await openRepositorySnapshotStore(storage);
  const bytes = hex => Array.from(Buffer.from(hex, 'hex'));
  const evidence = value => [bytes(value.snapshot), value.path, bytes(value.digest), value.content, value.truncated];
  function request(input, length) {
    if (!Array.isArray(input) || input.length !== length) throw new TypeError('repository query request mismatch');
    return snapshotValue(input[0]);
  }
  function cursor(value) {
    if (!text(value, 2048)) throw new TypeError('repository cursor mismatch');
    return value === '' ? null : value;
  }
  function integer(value) {
    const number = typeof value === 'bigint' ? Number(value) : value;
    if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('repository query bounds');
    return number;
  }
  function snapshotValue(value) {
    if (!Array.isArray(value) || value.length !== 9 || value[0] !== storage.repository || value[1] !== storage.generation ||
        JSON.stringify(value[7]) !== JSON.stringify(labels) || value[8] !== resourceOwner || ![0, 1].includes(value[2]) ||
        ![value[5], value[6]].every(digest => Array.isArray(digest) && digest.length === 32 && digest.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)))
      throw new TypeError('repository snapshot binding mismatch');
    return { repository: value[0], generation: value[1], objectFormat: value[2] === 0 ? 'sha1' : 'sha256', base: value[3], tree: value[4],
      manifest: Buffer.from(value[5]).toString('hex'), scopeManifest: Buffer.from(value[6]).toString('hex') };
  }
  return Object.freeze({
    async snapshot(input) {
      if (!Array.isArray(input) || input.length !== 2 || input[0] !== storage.repository) throw new TypeError('repository snapshot request mismatch');
      const value = await store.snapshot(input[1]);
      return [value.repository, value.generation, value.objectFormat === 'sha1' ? 0 : 1, value.base, value.tree,
        bytes(value.manifest), bytes(value.scopeManifest), [...labels], resourceOwner];
    },
    async read(input) {
      return evidence(await store.read(request(input, 2), input[1]));
    },
    async readWindow(input) {
      const selected = request(input, 4);
      const value = await store.read(selected, input[1], { offset: integer(input[2]), maximum: integer(input[3]) });
      return [evidence(value), value.offset, value.nextOffset, value.bytes];
    },
    async list(input) {
      const selected = request(input, 3);
      const value = await store.list(selected, { prefix: input[1], after: cursor(input[2]) });
      return [bytes(selected.manifest), value.entries.map(row => [row[0], row[1], row[2], row[3], bytes(row[4])]), value.cursor ?? '', value.total];
    },
    async search(input) {
      const selected = request(input, 4);
      const value = await store.search(selected, { query: input[1], prefix: input[2], after: cursor(input[3]) });
      return [bytes(selected.manifest), value.entries.map(hit => [hit.path, bytes(hit.digest), hit.line, hit.excerpt, hit.truncated]), value.cursor ?? '', value.truncated];
    },
  });
}

// Identity of the qualified default range suite, independent of writable input.
const suiteDigest = "556d27be95a9db73d36bc21f621870327dc64097b42f2c6ad6fc2407ac78e7fd";

export async function createRepositoryEnvironment({ root, paths, writablePaths }) {
  if (!Array.isArray(paths) || paths.length > 4096 || paths.some(path => !text(path, 256) || !path))
    throw new TypeError("expected at most 4096 explicitly admitted file paths");
  const admitted = [...paths].sort();
  const scope = new Set(admitted);
  if (scope.size !== admitted.length) throw new TypeError("duplicate repository path");
  if (!Array.isArray(writablePaths) || writablePaths.length > 4 ||
      writablePaths.some(path => !scope.has(path)) || new Set(writablePaths).size !== writablePaths.length)
    throw new TypeError("expected at most four distinct writable paths within the read capability");
  const writable = new Set(writablePaths);
  const files = await createDocumentEnvironment({ root, maximumContentBytes: 32 * 1024 });
  const delivery = await createRepositoryDelivery({ root });
  function pathInScope(path) {
    if (!text(path, 256) || !scope.has(path)) throw new TypeError("file outside repository capability");
    return path;
  }
  async function observe(path) {
    const result = await files.read({ path: pathInScope(path) });
    if (result.kind !== "success") throw new Error(`repository read unavailable: ${result.code}`);
    return result.observation;
  }
  function proposalInScope(proposal) {
    const path = pathInScope(proposal?.[0]?.[0]);
    if (!writable.has(path)) throw new TypeError("file outside repository write capability");
    return proposal;
  }
  return Object.freeze({
    async list(input) {
      if (input !== null) throw new TypeError("listing requires unit");
      const entries = [];
      for (const path of admitted.slice(0, 32)) {
        await observe(path);
        entries.push([path, 0]);
      }
      return [entries, admitted.length > entries.length];
    },
    async read(input) {
      if (!Array.isArray(input) || input.length !== 2 || !Number.isInteger(input[0]) || input[0] < 0 || input[0] > 2)
        throw new TypeError("read requires a document role and path");
      const [role, path] = input;
      const value = await observe(path);
      return [role, role, path, value.digest, value.content];
    },
    async search(input) {
      if (!Array.isArray(input) || input.length !== 2 || !input.every(value => text(value, 256)))
        throw new TypeError("search requires bounded query and path prefix");
      const [query, prefix] = input;
      if (!query.length) return [[], false];
      const hits = [];
      let truncated = false;
      for (const path of admitted) {
        if (!path.startsWith(prefix)) continue;
        const lines = (await observe(path)).content.split("\n");
        for (const [index, line] of lines.entries()) {
          if (!line.includes(query)) continue;
          if (hits.length === 8) return [hits, true];
          const excerpt = prefixBytes(line, 256);
          truncated ||= excerpt.length !== line.length;
          hits.push([path, index + 1, excerpt]);
        }
      }
      return [hits, truncated];
    },
    async test(input) {
      if (!Array.isArray(input) || input.length !== 2 ||
          !Array.isArray(input[0]) || input[0].length !== 1 || input[0][0] !== 0)
        throw new TypeError("unsupported repository test suite");
      const expected = input[1];
      if (!expected || ![0, 1].includes(expected.tag) ||
          (expected.tag === 0 ? expected.value !== null :
            !Array.isArray(expected.value) || expected.value.length !== 2 ||
            expected.value[0] !== "src/range.mjs" || !/^[a-f0-9]{64}$/.test(expected.value[1])))
        throw new TypeError("unsupported repository test source binding");
      const expectedDigest = expected.tag === 1 ? expected.value[1] : null;
      // This preserved executor is qualified for the range-repair fixture only.
      // Missing capabilities, failed sandbox launch and incomplete reports throw;
      // none are observations that could satisfy the authored failing-baseline gate.
      const source = await observe("src/range.mjs");
      const suite = await observe("test/range.test.mjs");
      if (suite.digest !== suiteDigest) throw new Error("repository test suite changed");
      const boundDigest = expectedDigest ?? source.digest;
      if (source.digest !== boundDigest) throw new Error("repository test source changed");
      async function unchanged() {
        if ((await observe("src/range.mjs")).digest !== boundDigest)
          throw new Error("repository test source changed");
        if ((await observe("test/range.test.mjs")).digest !== suiteDigest)
          throw new Error("repository test suite changed");
      }
      await unchanged();
      const result = await runRepositorySnapshot(source.content, suite.content);
      await unchanged();
      return result;
    },
    current: proposal => delivery.read(proposalInScope(proposal)),
    replace: proposal => delivery.replace(proposalInScope(proposal)),
  });
}

function text(value, limit) {
  return typeof value === "string" && value.isWellFormed() && Buffer.byteLength(value) <= limit;
}

function prefixBytes(value, limit) {
  let result = "", bytes = 0;
  for (const scalar of value) {
    const size = Buffer.byteLength(scalar);
    if (bytes + size > limit) break;
    result += scalar; bytes += size;
  }
  return result;
}
