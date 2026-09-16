// Caller-owned target authority. World owns approval; this adapter enforces the
// exact logical target and the final cooperative filesystem precondition.
import { createDocumentEnvironment } from "./document.mjs";

export async function createInquiryDelivery({ root, target }) {
  if (typeof target !== "string" || !target.isWellFormed() || !target.length || Buffer.byteLength(target) > 64)
    throw new TypeError("expected a nonempty logical target identity");
  const files = await createDocumentEnvironment({ root, maximumContentBytes: 4096 });
  function scope(path, identity) {
    if (path !== "session.mjs" || identity !== target) throw new TypeError("foreign delivery scope");
  }
  return Object.freeze({
    async read(proposal) {
      const [path, , candidate, principal, attempt, identity] = proposal;
      scope(path, identity);
      const result = await files.read({ path });
      return result.kind === "success" ? { kind: "success", proposal: [path,
        [result.observation.content, result.observation.digest], candidate, principal, attempt, identity] } : result;
    },
    async replace([path, base, candidate, , , identity]) {
      scope(path, identity);
      return files.replace({ path, base: { content: base[0], digest: base[1] }, replacement: candidate[0] });
    },
  });
}
