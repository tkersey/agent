// Node-only fixture/file shell. The portable binding owns schema/version checks.
import { createDocumentEnvironment } from "./document.mjs";
import { bindSubject } from "./text_inspection.mjs";

export async function fileBinding(declared, { root, path }) {
  const files = await createDocumentEnvironment({ root, maximumContentBytes: 65536 });
  return bindSubject(declared, async () => {
    const current = await files.read({ path });
    return current.kind === "success" ? new TextEncoder().encode(current.observation.content) : null;
  });
}
