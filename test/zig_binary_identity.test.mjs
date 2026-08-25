import { expect, test } from "bun:test";

import {
    EXPECTED_ZIG_VERSION,
    admitZigBinarySha256,
} from "../tools/zig_binary_identity.mjs";

test("Zig 0.16.0 binary admission is exact per supported host", () => {
    const linuxX64 = "2317bbb91798556d9d0f38aabdac23db83f0979b25f767259ae474546724087c";
    expect(EXPECTED_ZIG_VERSION).toBe("0.16.0");
    expect(admitZigBinarySha256(linuxX64, "linux", "x64")).toBe(linuxX64);
    expect(() => admitZigBinarySha256(linuxX64, "linux", "arm64")).toThrow("digest mismatch");
    expect(() => admitZigBinarySha256(linuxX64, "freebsd", "x64")).toThrow("not admitted");
});
