import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const FORMAT = "agent-reference-stack-lock-v1";
const MAX_REDIRECTS = 8;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const ALLOWED_FINAL_HOSTS = new Set([
    "codeload.github.com",
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
]);

const KINDS = Object.freeze({
    worldHost: Object.freeze({
        repository: "tkersey/world-host",
        root: (entry) => `world-host-v${entry.version}-runtime`,
        required: () => Object.freeze(["LICENSE", "bin/world-host-v1.mjs", "src/v1/index.mjs"]),
    }),
    worldCapabilities: Object.freeze({
        repository: "tkersey/world-capabilities",
        root: (entry) => entry.archiveRoot ?? `world-capabilities-v${entry.version}-deterministic`,
        required: (entry) => entry.provenance === "source-build"
            ? Object.freeze([
                "LICENSE",
                "package.json",
                "scripts/build-public-deterministic-v1.mjs",
                "src/v1/index.mjs",
                "packages/repository-repair-decision-fixture/manifest.json",
            ])
            : Object.freeze(["LICENSE", "src/v1/index.mjs", "packages/repository-repair-decision-fixture/manifest.json"]),
    }),
});

export function readReferenceStackLock(path) {
    const lock = JSON.parse(readFileSync(path, "utf8"));
    if (lock?.format !== FORMAT) throw new Error(`unsupported reference stack lock format: ${lock?.format}`);
    const seen = new Set();
    for (const [kind, expected] of Object.entries(KINDS)) {
        const entry = lock[kind];
        if (!entry || entry.repository !== expected.repository) throw new Error(`${kind} repository mismatch`);
        if (!/^\d+\.\d+\.\d+$/.test(entry.version)) throw new Error(`${kind} version is not canonical`);
        if (!/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`${kind} checksum is not canonical SHA-256`);
        const provenance = entry.provenance ?? "release";
        const url = validatedHttpsUrl(entry.url, `${kind} URL`);
        if (provenance === "release") {
            const wanted = `https://github.com/${entry.repository}/releases/download/v${entry.version}/`;
            if (!url.href.startsWith(wanted) || basename(url.pathname) === "") throw new Error(`${kind} version/URL mismatch`);
        } else if (kind === "worldCapabilities" && provenance === "source-build") {
            const match = url.href.match(/^https:\/\/github\.com\/tkersey\/world-capabilities\/archive\/([0-9a-f]{40})\.tar\.gz$/);
            if (match === null || entry.archiveRoot !== `world-capabilities-${match[1]}` ||
                entry.distributionRoot !== `world-capabilities-v${entry.version}-deterministic` ||
                !/^[0-9a-f]{64}$/.test(entry.sourceSha256 ?? "")) {
                throw new Error(`${kind} source-build identity mismatch`);
            }
        } else {
            throw new Error(`${kind} provenance is unsupported`);
        }
        if (seen.has(url.href)) throw new Error("reference stack lock contains a duplicate asset");
        seen.add(url.href);
    }
    return Object.freeze(lock);
}

export async function acquireReferenceStack(lock, options = {}) {
    const result = {};
    for (const kind of Object.keys(KINDS)) {
        const entry = lock[kind];
        const override = options.overrides?.[kind] ?? null;
        if (options.offline && override === null) throw new Error(`${kind} archive is required in offline mode`);
        let bytes;
        let resolvedUrl = null;
        let source;
        if (override !== null) {
            bytes = readFileSync(resolve(override));
            source = "local";
        } else {
            const downloaded = await downloadPublicArtifact(entry.url);
            bytes = downloaded.bytes;
            resolvedUrl = downloaded.resolvedUrl;
            source = "public";
        }
        if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error(`${kind} archive exceeds byte limit`);
        const actual = sha256(bytes);
        const expected = entry.provenance === "source-build" ? entry.sourceSha256 : entry.sha256;
        if (actual !== expected) throw new Error(`${kind} checksum mismatch: expected=${expected} actual=${actual}`);
        result[kind] = Object.freeze({ entry, bytes, resolvedUrl, source });
    }
    return Object.freeze(result);
}

export function materializeReferenceArtifact(kind, artifact, archiveRoot, extractionRoot) {
    const expected = KINDS[kind];
    if (!expected) throw new Error(`unknown reference artifact kind: ${kind}`);
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(extractionRoot, { recursive: true });
    const archivePath = join(archiveRoot, basename(new URL(artifact.entry.url).pathname));
    writeFileSync(archivePath, artifact.bytes, { flag: "wx" });
    const expectedRoot = expected.root(artifact.entry);
    const inventory = inspectTarGz(archivePath, expectedRoot);
    for (const relative of expected.required(artifact.entry)) {
        if (!inventory.paths.has(`${expectedRoot}/${relative}`)) throw new Error(`${kind} archive is missing ${relative}`);
    }
    run("tar", ["-xzf", archivePath, "-C", extractionRoot]);
    return Object.freeze({ archivePath, root: join(extractionRoot, expectedRoot), inventory });
}

export function materializeWorldCapabilitiesArtifact(artifact, archiveRoot, extractionRoot, options = {}) {
    const source = materializeReferenceArtifact(
        "worldCapabilities",
        artifact,
        archiveRoot,
        join(extractionRoot, "source"),
    );
    if (artifact.entry.provenance !== "source-build") return source;

    const bunExecutable = options.bunExecutable ?? process.execPath;
    const environment = options.environment ?? process.env;
    const build = spawnSync(bunExecutable, [
        join(source.root, "scripts/build-public-deterministic-v1.mjs"),
    ], {
        cwd: source.root,
        env: environment,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
    });
    if (build.stdout) process.stdout.write(build.stdout);
    if (build.stderr) process.stderr.write(build.stderr);
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`worldCapabilities distribution build failed with status ${build.status}`);

    const builtPath = join(
        source.root,
        "zig-out/public-deterministic",
        `world-capabilities-v${artifact.entry.version}-deterministic.tar.gz`,
    );
    const bytes = readFileSync(builtPath);
    if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error("worldCapabilities distribution archive exceeds byte limit");
    const digest = sha256(bytes);
    if (digest !== artifact.entry.sha256) {
        throw new Error(`worldCapabilities distribution checksum mismatch: expected=${artifact.entry.sha256} actual=${digest}`);
    }
    return materializeReferenceArtifact("worldCapabilities", {
        entry: {
            repository: artifact.entry.repository,
            version: artifact.entry.version,
            url: `https://github.com/tkersey/world-capabilities/releases/download/v${artifact.entry.version}/world-capabilities-v${artifact.entry.version}-deterministic.tar.gz`,
            sha256: digest,
        },
        bytes,
        resolvedUrl: null,
        source: "source-built",
    }, archiveRoot, join(extractionRoot, "distribution"));
}

export function inspectTarGz(archivePath, expectedRoot, options = {}) {
    const tarExecutable = options.tarExecutable ?? "tar";
    const environment = options.environment ?? process.env;
    const listing = run(tarExecutable, ["-tzf", archivePath], false, environment).stdout.split("\n").filter(Boolean);
    if (listing.length === 0 || listing.length > MAX_ENTRIES) throw new Error("reference archive entry count is invalid");
    const paths = new Set();
    for (const name of listing) {
        if (name.includes("\\") || name.startsWith("/") || name.includes("\0")) throw new Error(`unsafe archive path: ${name}`);
        const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
        const components = normalized.split("/");
        if (components[0] !== expectedRoot || components.some((part) => part === ".." || part === "." || part === "")) {
            throw new Error(`unexpected archive root or path: ${name}`);
        }
        if (paths.has(normalized)) throw new Error(`duplicate archive path: ${name}`);
        paths.add(normalized);
    }
    const verbose = run(tarExecutable, ["-tvzf", archivePath], false, environment).stdout.split("\n").filter(Boolean);
    let expandedBytes = 0;
    for (const line of verbose) {
        if (line.startsWith("l") || line.startsWith("h")) throw new Error("reference archive links are forbidden");
        expandedBytes += archiveEntrySize(line);
        if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_EXPANDED_BYTES) {
            throw new Error("reference archive expansion exceeds byte limit");
        }
    }
    return Object.freeze({ paths, entryCount: listing.length, expandedBytes });
}

export function archiveEntrySize(line) {
    const bsd = line.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+/);
    const gnu = line.match(/^\S+\s+\S+\/\S+\s+(\d+)\s+/);
    const encoded = bsd?.[1] ?? gnu?.[1];
    if (encoded === undefined) throw new Error(`cannot parse archive inventory: ${line}`);
    const size = Number(encoded);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid archive entry size: ${line}`);
    return size;
}

async function downloadPublicArtifact(initial) {
    let current = validatedHttpsUrl(initial, "reference artifact URL");
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const response = await fetch(current, { redirect: "manual", headers: { Accept: "application/octet-stream" } });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) throw new Error(`public artifact redirect has no location: ${current.href}`);
            current = validatedHttpsUrl(new URL(location, current).href, "reference artifact redirect");
            if (!ALLOWED_FINAL_HOSTS.has(current.hostname)) throw new Error(`reference artifact redirected outside public GitHub storage: ${current.hostname}`);
            continue;
        }
        if (!response.ok) throw new Error(`public artifact download failed: ${current.href} HTTP ${response.status}`);
        if (!ALLOWED_FINAL_HOSTS.has(current.hostname)) throw new Error(`reference artifact resolved outside public GitHub storage: ${current.hostname}`);
        return Object.freeze({ bytes: Buffer.from(await response.arrayBuffer()), resolvedUrl: current.href });
    }
    throw new Error("public artifact redirect limit exceeded");
}

function validatedHttpsUrl(value, label) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label} must be unauthenticated HTTPS`);
    return url;
}

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args, forward = true, environment = process.env) {
    const result = spawnSync(command, args, { env: environment, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    if (forward && result.stdout) process.stdout.write(result.stdout);
    if (forward && result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
    return result;
}
