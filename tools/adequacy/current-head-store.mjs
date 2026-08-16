import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function currentHeadStore(host, root) {
  return new (class extends host.BranchHeadStore {
    async readHead(runId, branchId) {
      const path = headPath(root, runId, branchId);
      try {
        return host.makeHead(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    }

    async advanceHeadIfCurrent(runId, branchId, expected, next) {
      const current = await this.readHead(runId, branchId);
      if (!sameHead(current, expected)) {
        return Object.freeze({ advanced: false, current });
      }
      const admitted = host.makeHead(next);
      const requiredGeneration = current === null ? 0 : current.generation + 1;
      if (admitted.generation !== requiredGeneration) throw new Error("adequacy_head_generation");
      if (current !== null && admitted.applicationId !== current.applicationId) {
        throw new Error("adequacy_head_application");
      }
      const directory = join(root, "heads");
      await mkdir(directory, { recursive: true });
      const destination = headPath(root, runId, branchId);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const line = `${JSON.stringify(admitted)}\n`;
      await writeFile(temporary, line, { encoding: "utf8", flag: "wx" });
      await rename(temporary, destination);
      await appendFile(historyPath(root, runId, branchId), line, "utf8");
      return Object.freeze({ advanced: true, current: admitted });
    }
  })();
}

function headPath(root, runId, branchId) {
  return join(root, "heads", `${identity(runId, branchId)}.json`);
}

function historyPath(root, runId, branchId) {
  return join(root, "heads", `${identity(runId, branchId)}.history.jsonl`);
}

function identity(runId, branchId) {
  return createHash("sha256")
    .update("agent-adequacy-head-v1\0")
    .update(String(runId))
    .update("\0")
    .update(String(branchId))
    .digest("hex");
}

function sameHead(left, right) {
  if (left === null || right === null) return left === right;
  return left.generation === right.generation &&
    left.applicationId === right.applicationId &&
    left.frameId === right.frameId &&
    left.frameRef.algorithm === right.frameRef.algorithm &&
    left.frameRef.checksum === right.frameRef.checksum &&
    left.frameRef.byteLength === right.frameRef.byteLength &&
    left.status === right.status &&
    left.journalBindingId === right.journalBindingId;
}
