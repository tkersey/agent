import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { open, lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

export async function readBoundedRegularFile(path, maximumBytes, label) {
  const absolute = resolve(path);
  const pathBefore = await lstat(absolute, { bigint: true });
  assert(pathBefore.isFile() && !pathBefore.isSymbolicLink(), `${label} is not a regular file`);
  assert(pathBefore.size <= BigInt(maximumBytes), `${label} exceeds its size limit`);
  const handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    assertSameGeneration(before, pathBefore, `${label} path changed before open`);
    const bytes = Buffer.allocUnsafe(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      assert(bytesRead !== 0, `${label} changed during read`);
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    assertSameGeneration(after, before, `${label} changed during read`);
    const pathAfter = await lstat(absolute, { bigint: true });
    assert(pathAfter.isFile() && !pathAfter.isSymbolicLink(),
      `${label} path is no longer a regular file`);
    assertSameGeneration(pathAfter, before, `${label} path changed during read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function assertWorldRootMatchesArchive({
  worldRoot,
  archiveBytes,
  worldVersion,
  maximumExpandedBytes = 32 * 1024 * 1024,
}) {
  return assertRootMatchesArchive({
    root: worldRoot,
    archiveBytes,
    archiveRoot: `world-v${worldVersion}-process-host-runtime`,
    maximumExpandedBytes,
  });
}

export async function assertRootMatchesArchive({
  root,
  archiveBytes,
  archiveRoot,
  maximumExpandedBytes,
}) {
  const files = parseTar(gunzipSync(archiveBytes, {
    maxOutputLength: maximumExpandedBytes,
  }), archiveRoot, maximumExpandedBytes);
  const disk = await readTree(
    resolve(root),
    256,
    maximumExpandedBytes,
    16,
  );
  assert.deepEqual([...disk.keys()], [...files.keys()],
    "executed root inventory differs from the authenticated archive");
  for (const [name, archived] of files) {
    const actual = disk.get(name);
    assert.equal(actual.kind, archived.kind, `executed type differs from archive: ${name}`);
    assert.equal(actual.mode, archived.mode, `executed mode differs from archive: ${name}`);
    if (archived.kind === "file") {
      assert.deepEqual(actual.bytes, archived.bytes, `executed bytes differ from archive: ${name}`);
    }
  }
  return disk;
}

function parseTar(bytes, root, maximumExpandedBytes) {
  const files = new Map();
  let offset = 0;
  let expanded = 0;
  let entries = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    assert(entries++ < 256, "World archive entry limit exceeded");
    const name = field(header, 0, 100);
    assert(name.startsWith(`${root}/`), `unexpected World archive root: ${name}`);
    const relative = name.slice(root.length + 1).replace(/\/$/, "");
    assert(safeRelative(relative), `unsafe World archive path: ${name}`);
    const size = readOctal(header, 124, 12);
    const mode = readOctal(header, 100, 8) & 0o777;
    const type = String.fromCharCode(header[156] || 48);
    const storedChecksum = readOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    assert.equal(checksumHeader.reduce((sum, byte) => sum + byte, 0), storedChecksum);
    offset += 512;
    assert(size <= bytes.length - offset, "truncated World archive entry");
    if (type === "0") {
      assert(!files.has(relative), `duplicate World archive path: ${relative}`);
      addImplicitDirectories(files, relative);
      expanded += size;
      assert(expanded <= maximumExpandedBytes, "World archive expansion limit exceeded");
      files.set(relative, {
        kind: "file",
        mode,
        bytes: Buffer.from(bytes.subarray(offset, offset + size)),
      });
    } else {
      assert.equal(type, "5", `World archive special entry is forbidden: ${name}`);
      assert.equal(size, 0);
      const existing = files.get(relative);
      assert(existing === undefined || existing.implicit === true,
        `duplicate World archive path: ${relative}`);
      files.set(relative, { kind: "directory", mode, implicit: false });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return new Map([...files].sort(([left], [right]) => compareUtf8(left, right)));
}

function addImplicitDirectories(files, relative) {
  const components = relative.split("/");
  for (let length = 1; length < components.length; length += 1) {
    const name = components.slice(0, length).join("/");
    const existing = files.get(name);
    assert(existing === undefined || existing.kind === "directory",
      `World archive path crosses a file: ${relative}`);
    if (existing === undefined) {
      files.set(name, { kind: "directory", mode: 0o755, implicit: true });
    }
  }
}

async function readTree(root, maximumEntries, maximumBytes, maximumDepth) {
  const files = [];
  let entriesSeen = 0;
  let bytesSeen = 0;
  async function walk(relative, depth) {
    assert(depth <= maximumDepth, "executed tree depth limit exceeded");
    const directory = relative === "" ? root : join(root, ...relative.split("/"));
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      assert(entriesSeen++ < maximumEntries, "executed tree entry limit exceeded");
      const name = relative === "" ? entry.name : `${relative}/${entry.name}`;
      assert(safeRelative(name), `unsafe executed World path: ${name}`);
      const path = join(root, ...name.split("/"));
      const stat = await lstat(path);
      assert(!stat.isSymbolicLink(), `executed World link is forbidden: ${name}`);
      if (stat.isDirectory()) {
        files.push([name, { kind: "directory", mode: stat.mode & 0o777 }]);
        await walk(name, depth + 1);
      } else {
        assert(stat.isFile(), `executed World entry is not regular: ${name}`);
        bytesSeen += Number(stat.size);
        assert(bytesSeen <= maximumBytes, "executed tree aggregate size limit exceeded");
        files.push([name, {
          kind: "file",
          mode: stat.mode & 0o777,
          bytes: await readBoundedRegularFile(path, maximumBytes, `executed file ${name}`),
        }]);
      }
    }
  }
  await walk("", 0);
  return new Map(files.sort(([left], [right]) => compareUtf8(left, right)));
}

function assertSameGeneration(actual, expected, message) {
  for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
    assert.equal(actual[field], expected[field], message);
  }
}

function safeRelative(path) {
  return path.length > 0 && !path.includes("\0") && !path.includes("\\") &&
    !path.startsWith("/") && !path.endsWith("/") && !path.includes("//") &&
    path.split("/").every((component) => component !== "." && component !== "..");
}

function field(bytes, offset, length) {
  const end = bytes.indexOf(0, offset);
  const limit = end === -1 || end > offset + length ? offset + length : end;
  return bytes.subarray(offset, limit).toString("utf8");
}

function readOctal(bytes, offset, length) {
  const value = field(bytes, offset, length).trim();
  assert(/^[0-7]+$/.test(value), "invalid World archive octal field");
  const result = Number.parseInt(value, 8);
  assert(Number.isSafeInteger(result) && result >= 0);
  return result;
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}
