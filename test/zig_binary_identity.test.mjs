import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import {
    EXPECTED_ZIG_VERSION,
    admitZigBinarySha256,
} from "../tools/zig_binary_identity.mjs";
import {
    closedVerifierPath,
    materializeVerifierBin,
    resolveVerifierExecutables,
} from "../tools/verifier_executables.mjs";

test("Zig 0.16.0 binary admission is exact per supported host", () => {
    const linuxX64 = "2317bbb91798556d9d0f38aabdac23db83f0979b25f767259ae474546724087c";
    expect(EXPECTED_ZIG_VERSION).toBe("0.16.0");
    expect(admitZigBinarySha256(linuxX64, "linux", "x64")).toBe(linuxX64);
    expect(() => admitZigBinarySha256(linuxX64, "linux", "arm64")).toThrow("digest mismatch");
    expect(() => admitZigBinarySha256(linuxX64, "freebsd", "x64")).toThrow("not admitted");
});

test("closed verifier PATH resolves Node, Bun, Git, and Zig only through its private bin", async () => {
    const executables = resolveVerifierExecutables();
    const root = await mkdtemp(join(tmpdir(), "agent-verifier-bin-"));
    let bin;
    try {
        const source = join(root, "source-zig");
        const sourceBin = join(source, "bin");
        const sourceLib = join(source, "lib", "zig");
        await mkdir(sourceBin, { recursive: true });
        await mkdir(sourceLib, { recursive: true });
        const sourceZig = join(sourceBin, "zig");
        await writeFile(sourceZig, "captured zig bytes\n");
        await chmod(sourceZig, 0o755);
        await writeFile(join(sourceLib, "marker"), "captured library bytes\n");
        bin = materializeVerifierBin(root, sourceZig, executables);
        const path = closedVerifierPath(bin).split(delimiter);
        expect(path[0]).toBe(bin);
        expect(realpathSync(join(bin, "node"))).toBe(executables.node.real);
        expect(realpathSync(join(bin, "bun"))).toBe(executables.bun.real);
        expect(realpathSync(join(bin, "git"))).toBe(executables.git.real);
        const capturedZig = realpathSync(join(bin, "zig"));
        expect(await readFile(capturedZig)).toEqual(await readFile(sourceZig));
        expect(await readFile(join(dirname(dirname(capturedZig)), "lib", "zig", "marker"), "utf8"))
            .toBe("captured library bytes\n");
    } finally {
        if (bin !== undefined) await chmod(bin, 0o700);
        await rm(root, { recursive: true, force: true });
    }
});
