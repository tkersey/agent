import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function repositoryWriteHelper() {
  const path = process.env.AGENT_PUBLICATION_GATE;
  assert(path, 'build with the installed repository publication gate');
  return { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
}
