import { resolve } from "node:path";

// Build-driven checks inherit the selected install prefix; direct checks use Zig's default.
export const artifactRoot = resolve(process.env.AGENT4_BUILD_PREFIX ?? "zig-out");
