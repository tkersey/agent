// Leaf operations for the authored repository replacement gate. Approval and
// working-set policy stay in the Program; document.mjs owns filesystem safety.
import { createDocumentEnvironment } from "./document.mjs";

/** Uses the same isolated-root, cooperative-writer contract as document.mjs.
 * Results use the portable Read/Delivery declaration ordinals. No live evidence
 * or approval is reconstructed here, and uncertain writes are never retried. */
export async function createRepositoryDelivery({ root }) {
  const files = await createDocumentEnvironment({ root, maximumContentBytes: 32 * 1024 });
  const conflict = (request, actual) => [request[0], request[1], actual.digest];
  return Object.freeze({
    async read(input) {
      const proposal = admit(input), request = proposal[0];
      const result = await files.read({ path: request[0] });
      if (result.kind !== "success") return { tag: 2, value: result.code };
      if (result.observation.digest !== request[1])
        return { tag: 1, value: conflict(request, result.observation) };
      return { tag: 0, value: proposal };
    },
    async replace(input) {
      const [request] = admit(input);
      const current = await files.read({ path: request[0] });
      if (current.kind !== "success") return { tag: 2, value: current.code };
      if (current.observation.digest !== request[1])
        return { tag: 1, value: conflict(request, current.observation) };
      const result = await files.replace({
        path: request[0], base: current.observation, replacement: request[2],
      });
      switch (result.kind) {
        case "success": return { tag: 0, value: [request[0], request[1], result.observation.digest, false] };
        case "conflict": return { tag: 1, value: conflict(request, result.observation) };
        case "failure": return { tag: 2, value: result.code };
        case "uncertain": return { tag: 3, value: result.code };
        default: throw new Error("unknown document delivery result");
      }
    },
  });
}

function admit(input) {
  if (!Array.isArray(input) || input.length !== 2 ||
      !Array.isArray(input[0]) || input[0].length !== 4)
    throw new TypeError("expected repository replacement proposal");
  const [request, principal] = input;
  for (const [index, limit] of [256, 64, 32 * 1024, 4096].entries())
    if (typeof request[index] !== "string" || !request[index].isWellFormed() ||
        Buffer.byteLength(request[index]) > limit)
      throw new TypeError("replacement field exceeds its text contract");
  if (!/^[a-f0-9]{64}$/.test(request[1])) throw new TypeError("expected SHA-256 hex digest");
  if (typeof principal !== "bigint" || principal < 0n || principal > 0xffffffffffffffffn)
    throw new TypeError("expected u64 principal");
  // Snapshot caller-owned arrays before the first await, including the echo.
  return [[...request], principal];
}
