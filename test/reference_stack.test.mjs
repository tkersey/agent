import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readReferenceStackLock } from "../tools/reference_stack.mjs";

const lockPath = "conformance/reference-stack-v1.lock.json";

describe("public reference stack lock", () => {
    test("binds exact stable public release URLs and checksums", () => {
        const lock = readReferenceStackLock(lockPath);
        expect(lock.worldHost.version).toBe("1.0.1");
        expect(lock.worldCapabilities.version).toBe("2.2.0");
        expect(lock.worldHost.url).not.toContain("/releases/assets/");
        expect(lock.worldCapabilities.url).not.toContain("/releases/assets/");
    });

    test("rejects private, mismatched, duplicate, and incomplete identities", () => {
        const original = JSON.parse(readFileSync(lockPath, "utf8"));
        for (const mutate of [
            (lock) => { lock.worldHost.url = "http://github.com/tkersey/world-host/releases/download/v1.0.1/runtime.tar.gz"; },
            (lock) => { lock.worldHost.url = lock.worldHost.url.replace("v1.0.1", "v1.0.0"); },
            (lock) => { lock.worldCapabilities.url = lock.worldHost.url; },
            (lock) => { lock.worldHost.sha256 = ""; },
        ]) {
            const root = mkdtempSync(join(tmpdir(), "agent-reference-lock-negative-"));
            const candidate = structuredClone(original);
            mutate(candidate);
            const candidatePath = join(root, "lock.json");
            writeFileSync(candidatePath, `${JSON.stringify(candidate)}\n`);
            expect(() => readReferenceStackLock(candidatePath)).toThrow();
        }
    });
});
