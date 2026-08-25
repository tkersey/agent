import { expect, test } from "bun:test";
import { delimiter, dirname } from "node:path";

import {
    EXPECTED_ZIG_VERSION,
    admitZigBinarySha256,
} from "../tools/zig_binary_identity.mjs";
import {
    closedVerifierPath,
    resolveVerifierExecutables,
} from "../tools/verifier_executables.mjs";

test("Zig 0.16.0 binary admission is exact per supported host", () => {
    const linuxX64 = "2317bbb91798556d9d0f38aabdac23db83f0979b25f767259ae474546724087c";
    expect(EXPECTED_ZIG_VERSION).toBe("0.16.0");
    expect(admitZigBinarySha256(linuxX64, "linux", "x64")).toBe(linuxX64);
    expect(() => admitZigBinarySha256(linuxX64, "linux", "arm64")).toThrow("digest mismatch");
    expect(() => admitZigBinarySha256(linuxX64, "freebsd", "x64")).toThrow("not admitted");
});

test("closed verifier PATH retains the resolved Node and Bun toolchains", () => {
    const executables = resolveVerifierExecutables();
    const path = closedVerifierPath(process.execPath, executables).split(delimiter);
    expect(path).toContain(dirname(executables.node.invocation));
    expect(path).toContain(dirname(executables.node.real));
    expect(path).toContain(dirname(executables.bun.invocation));
    expect(path).toContain(dirname(executables.bun.real));
});
