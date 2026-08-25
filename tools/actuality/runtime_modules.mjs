import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadActualityCapabilities(root) {
  const [protocol, router, codecs, fixture, workspace] = await Promise.all([
    "src/v1/protocol.mjs",
    "src/v1/router.mjs",
    "src/v1/actuality/repository_repair_codecs.mjs",
    "src/v1/actuality/repository_repair_fixture_binding.mjs",
    "src/v1/actuality/repository_workspace_binding.mjs"
  ].map((path) => import(pathToFileURL(join(root, path)))));
  return Object.freeze({
    ...protocol,
    ...router,
    ...fixture,
    ...workspace,
    decodeRepositoryReplaceRequest: codecs.decodeReplaceRequest,
    decodeRepositoryRepairFinalResult: codecs.decodeFinalResult,
    encodeRepositoryRepairAction: codecs.encodeAction
  });
}
