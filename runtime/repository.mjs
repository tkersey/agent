// Leaf bindings for a caller-owned repository and explicit file capabilities.
// The Program owns decision order, working memory, approval and completion.
import { createDocumentEnvironment } from "./document.mjs";
import { createRepositoryDelivery } from "./repository_delivery.mjs";
import { runRepositorySnapshot } from "./repository_tests.mjs";

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
