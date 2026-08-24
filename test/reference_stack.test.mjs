import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { archiveEntrySize, readReferenceStackLock } from "../tools/reference_stack.mjs";

const lockPath = "conformance/reference-stack-v1.lock.json";

describe("public reference stack lock", () => {
    test("parses BSD and GNU tar inventories", () => {
        expect(archiveEntrySize("-rw-r--r--  0 owner group 123 Aug 15 03:00 root/file")).toBe(123);
        expect(archiveEntrySize("-rw-r--r-- owner/group 456 2026-08-15 03:00 root/file")).toBe(456);
        expect(() => archiveEntrySize("not a tar inventory")).toThrow();
    });

    test("binds exact stable public release URLs and checksums", () => {
        const lock = readReferenceStackLock(lockPath);
        expect(lock.worldHost.version).toBe("1.0.1");
        expect(lock.worldCapabilities.version).toBe("2.3.3");
        expect(lock.worldHost.url).not.toContain("/releases/assets/");
        expect(lock.worldCapabilities.url).not.toContain("/releases/assets/");
    });

    test("preserves the exact Agent v1.1.2 public runtime tuple", () => {
        const lock = readReferenceStackLock("conformance/reference-stack-v1.1.2.lock.json");
        expect(lock.worldHost.version).toBe("1.0.1");
        expect(lock.worldCapabilities.version).toBe("2.1.2");
        expect(lock.worldHost.sha256).toBe("e501ab1fe540ed2ee5cbd1db5a027f00271f95694747160fe36fa64cffaab52d");
        expect(lock.worldCapabilities.sha256).toBe("51d62b02ae3362f12740102a7f2fae5d112650475817f99b65abbfe9c41ae5d7");
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
