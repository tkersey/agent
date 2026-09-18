// Leaf bindings for a caller-owned repository and explicit file capabilities.
// The Program owns decision order, working memory, approval and completion.
import { realpath } from "node:fs/promises";
import { createDocumentEnvironment } from "./document.mjs";
import { createRepositoryDelivery } from "./repository_delivery.mjs";
import { runRepositoryTests } from "./repository_tests.mjs";

export async function createRepositoryEnvironment({ root, paths }) {
  if (!Array.isArray(paths) || paths.length > 4096 || paths.some(path => !text(path, 256) || !path))
    throw new TypeError("expected at most 4096 explicitly admitted file paths");
  const admitted = [...paths].sort();
  const scope = new Set(admitted);
  if (scope.size !== admitted.length) throw new TypeError("duplicate repository path");
  const files = await createDocumentEnvironment({ root, maximumContentBytes: 32 * 1024 });
  const delivery = await createRepositoryDelivery({ root });
  const directory = await realpath(root);
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
    pathInScope(proposal?.[0]?.[0]);
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
      if (!Array.isArray(input) || input.length !== 1 || input[0] !== 0)
        throw new TypeError("unsupported repository test suite");
      // This preserved executor is qualified for the range-repair fixture only.
      // Missing capabilities, failed sandbox launch and incomplete reports throw;
      // none are observations that could satisfy the authored failing-baseline gate.
      await observe("src/range.mjs");
      await observe("test/range.test.mjs");
      return runRepositoryTests(directory);
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
