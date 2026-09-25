// OS isolation for the narrow inquiry experiment tool. Candidate authority is
// confined to one invocation's scratch directory; there is no unsafe fallback.
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir, release } from "node:os";
import { fileURLToPath } from "node:url";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const driverPath = fileURLToPath(new URL("./inquiry_driver.mjs", import.meta.url));
const dyldProfilePath = "/System/Library/Sandbox/Profiles/dyld-support.sb";
const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
const sbString = value => {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/u.test(value)) throw new TypeError("unsafe sandbox path");
  return JSON.stringify(value);
};

// Resolve the selected Node executable's actual non-system Mach-O dependency
// closure. Only these exact files get read access, not the Homebrew tree.
async function libraries(executable) {
  const pending = [executable], found = new Map();
  while (pending.length) {
    const file = pending.pop();
    const canonical = await realpath(file);
    if (found.has(canonical)) continue;
    const stat = await lstat(canonical);
    if (!stat.isFile()) throw new Error("runtime dependency is not a file");
    found.set(canonical, { path: canonical, supplied: file,
      link: join(await realpath(dirname(file)), basename(file)), identity: identity(stat),
      sha256: hash(await readFile(canonical)) });
    const headers = execFileSync("/usr/bin/otool", ["-l", canonical], { encoding: "utf8", maxBuffer: 4e6 });
    const roots = [...headers.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path ([^\n]+?) \(offset/g)]
      .map(match => match[1].replaceAll("@loader_path", dirname(canonical))
        .replaceAll("@executable_path", dirname(executable)));
    const deps = execFileSync("/usr/bin/otool", ["-L", canonical], { encoding: "utf8", maxBuffer: 1e6 });
    for (const line of deps.split("\n").slice(1)) {
      const name = line.trim().split(" (compatibility version")[0];
      if (!name || name.startsWith("/usr/lib/") || name.startsWith("/System/Library/")) continue;
      let selected = name.replaceAll("@loader_path", dirname(canonical))
        .replaceAll("@executable_path", dirname(executable));
      if (selected.startsWith("@rpath/")) {
        selected = null;
        for (const root of [...roots, join(dirname(executable), "../lib")]) {
          const candidate = resolve(root, name.slice(7));
          try { await access(candidate, constants.R_OK); selected = candidate; break; } catch {}
        }
        if (!selected) throw new Error(`unresolved runtime dependency: ${name}`);
      }
      if (!isAbsolute(selected)) throw new Error("nonabsolute runtime dependency");
      pending.push(selected);
    }
  }
  return [...found.values()];
}

function profile(executable, dependencies, input, scratch) {
  const files = [...new Set([executable, ...dependencies.flatMap(x => [x.path, x.supplied, x.link])])];
  const ancestors = new Set(["/"]);
  for (const file of [...files, input, scratch]) {
    for (let dir = dirname(file); dir !== "/"; dir = dirname(dir)) ancestors.add(dir);
  }
  return `(version 1)
    (deny default)
    (import "dyld-support.sb")
    (allow process-exec (literal ${sbString(executable)}))
    (allow sysctl-read)
    (allow file-read-metadata file-test-existence ${[...ancestors].map(x => `(literal ${sbString(x)})`).join(" ")})
    (allow file-map-executable ${files.map(x => `(literal ${sbString(x)})`).join(" ")})
    (allow file-read* file-test-existence (subpath "/System/Library") (subpath "/usr/lib")
      (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")
      ${files.map(x => `(literal ${sbString(x)})`).join(" ")}
      (subpath ${sbString(input)}) (subpath ${sbString(scratch)}))
    (allow file-write-create (require-all (subpath ${sbString(scratch)}) (vnode-type REGULAR-FILE)))
    (allow file-write-data file-write-unlink (subpath ${sbString(scratch)}))`;
}

function launch(command, args, { cwd, timeoutMs, maximumOutputBytes, signal }) {
  return new Promise(resolveResult => {
    if (signal?.aborted) return resolveResult({ kind: "cancelled", physicalExecutions: 0 });
    const child = spawn(command, args, { cwd, env: { TZ: "UTC" }, detached: true,
      stdio: ["ignore", "pipe", "pipe"], shell: false });
    const stdout = [], stderr = [];
    let bytes = 0, stopped = null, spawnError = null, launched = false;
    child.once("spawn", () => { launched = true; });
    const terminate = kind => {
      if (stopped) return;
      stopped = kind;
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => terminate("timeout"), timeoutMs);
    const aborted = () => terminate("cancelled");
    signal?.addEventListener("abort", aborted, { once: true });
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on("data", data => {
        bytes += data.length;
        if (bytes > maximumOutputBytes) terminate("output_limit");
        else chunks.push(data);
      });
    }
    child.once("error", error => { spawnError = error.code ?? "spawn_failed"; });
    child.once("close", (code, childSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      resolveResult({ kind: stopped ?? (spawnError ? "unavailable" : childSignal ? "signal" : "completed"),
        code, signal: childSignal, spawnError, physicalExecutions: Number(launched),
        outputBytes: bytes,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

// The worker has exited before this bounded, no-follow checkpoint read.
async function checkpoint(path, nonce) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 131200) throw new Error("checkpoint capacity");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error("short checkpoint");
      offset += bytesRead;
    }
    if ((await file.stat()).size !== before.size) throw new Error("changed checkpoint");
    const value = JSON.parse(bytes.toString("utf8"));
    if (value?.nonce !== nonce || !Object.hasOwn(value, "state") ||
        Object.keys(value).length !== 2 || Buffer.byteLength(JSON.stringify(value.state)) > 131072)
      throw new Error("checkpoint binding");
    return value.state;
  } finally { await file.close(); }
}

/** Qualifies the installed profile before any candidate source is executed. */
export function createInquirySandbox(options = {}) {
  return createSandbox(options, driverPath, "agent.inquiry.macos-seatbelt.v1");
}

export function createParserSandbox(options = {}) {
  return createSandbox(options, fileURLToPath(new URL("./parser_driver.mjs", import.meta.url)),
    "agent.incremental-parser.macos-seatbelt.v1");
}

async function createSandbox({ scratchRoot = tmpdir(), timeoutMs = 2000,
  maximumOutputBytes = 65536 } = {}, driverPath, name) {
  if (process.platform !== "darwin") return { kind: "unavailable", reason: "unsupported_host" };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000 ||
      !Number.isInteger(maximumOutputBytes) || maximumOutputBytes < 1024 || maximumOutputBytes > 1048576)
    throw new TypeError("invalid experiment resource bounds");
  let executable, dependencies, driver, root, dyldProfile, dyldIdentity;
  try {
    await access("/usr/bin/sandbox-exec", constants.X_OK);
    executable = await realpath(process.execPath);
    dependencies = await libraries(executable);
    driver = await readFile(driverPath);
    dyldIdentity = identity(await lstat(dyldProfilePath));
    dyldProfile = await readFile(dyldProfilePath);
    if (identity(await lstat(dyldProfilePath)) !== dyldIdentity) throw new Error("loader profile changed");
    root = await realpath(resolve(scratchRoot));
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
  } catch { return { kind: "unavailable", reason: "profile_setup_failed" }; }
  const contract = Object.freeze({ name,
    osRelease: release(), nodeVersion: process.version, executableSha256: dependencies[0].sha256,
    driverSha256: hash(driver), adapterSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    dyldProfileSha256: hash(dyldProfile),
    dependencySha256: hash(JSON.stringify(dependencies.map(({ path, supplied, link, sha256 }) =>
      ({ path, supplied, link, sha256 })))),
    timeoutMs, maximumOutputBytes, oldSpaceMiB: 64, semiSpaceMiB: 8 });
  const runner = hash(JSON.stringify(contract));

  async function invoke(files, entry, options = {}) {
    try { if (identity(await lstat(dyldProfilePath)) !== dyldIdentity)
      return { kind: "unavailable", reason: "loader_profile_changed" }; }
    catch { return { kind: "unavailable", reason: "loader_profile_changed" }; }
    for (const item of dependencies) {
      try { if (identity(await lstat(item.path)) !== item.identity ||
          await realpath(item.supplied) !== item.path || await realpath(item.link) !== item.path)
        return { kind: "unavailable", reason: "runtime_changed" }; }
      catch { return { kind: "unavailable", reason: "runtime_changed" }; }
    }
    const directory = await mkdtemp(join(root, "agent-inquiry-"));
    try {
      const canonical = await realpath(directory);
      const input = join(canonical, "input"), scratch = join(canonical, "scratch");
      await mkdir(input, { mode: 0o700 }); await mkdir(scratch, { mode: 0o700 });
      for (const [name, bytes] of Object.entries(files)) {
        if (!/^[a-z-]+\.(mjs|json)$/u.test(name)) throw new TypeError("invalid input file");
        await writeFile(join(input, name), bytes, { flag: "wx", mode: 0o400 });
      }
      const args = ["-p", profile(executable, dependencies, input, scratch), executable,
        "--no-addons", "--no-warnings", "--openssl-config=/dev/null",
        "--experimental-vm-modules", "--max-old-space-size=64",
        "--max-semi-space-size=8", join(input, entry), ...(options.args ?? [])];
      if (options.deadline !== undefined && performance.now() >= options.deadline)
        return { kind: "timeout", physicalExecutions: 0 };
      const result = await launch("/usr/bin/sandbox-exec", args, {
        cwd: scratch, timeoutMs: options.deadline === undefined ? timeoutMs :
          Math.max(1, Math.min(timeoutMs, options.deadline - performance.now())),
        maximumOutputBytes, signal: options.signal,
      });
      for (const [name, bytes] of Object.entries(files)) {
        const path = join(input, name);
        try {
          const stat = await lstat(path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.mode % 512 !== 0o400 ||
              !Buffer.from(bytes).equals(await readFile(path)))
            return { kind: "input_tampered", physicalExecutions: result.physicalExecutions };
        } catch {
          return { kind: "input_tampered", physicalExecutions: result.physicalExecutions };
        }
      }
      if (options.checkpoint && result.kind === "completed" && result.code === 0) {
        try { result.state = await checkpoint(join(scratch, "state.json"), options.checkpoint); }
        catch { return { kind: "malformed_output", physicalExecutions: result.physicalExecutions,
          outputBytes: result.outputBytes }; }
      }
      return result;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  const canaryRoot = await mkdtemp(join(root, "agent-inquiry-canary-"));
  let qualification, qualificationExecutions = 0;
  try {
    const secret = join(canaryRoot, "secret.txt"), forbidden = join(canaryRoot, "forbidden.txt");
    await writeFile(secret, "qualification canary\n", { mode: 0o600 });
    const probe = `import fs from 'node:fs'; import net from 'node:net';
      import {spawnSync} from 'node:child_process';
      const denied = fn => { try { fn(); return false; } catch { return true; } };
      const result = {read:denied(()=>fs.readFileSync(${JSON.stringify(secret)})),
        checkout:denied(()=>fs.readFileSync(${JSON.stringify(driverPath)})),
        write:denied(()=>fs.writeFileSync(${JSON.stringify(forbidden)},'bad')),
        inputWrite:denied(()=>{fs.chmodSync(import.meta.filename,0o600);fs.writeFileSync(import.meta.filename,'bad')}),
        environment:Object.keys(process.env).join(',') === 'TZ',
        fork:!!spawnSync(process.execPath,['--eval','']).error,
        scratchMode:denied(()=>fs.chmodSync(process.cwd(),0)),
        inputAlias:denied(()=>{fs.linkSync(import.meta.filename,'alias');fs.chmodSync('alias',0o600);fs.writeFileSync('alias','bad')})};
      fs.writeFileSync('allowed.txt','scratch');result.scratch=fs.readFileSync('allowed.txt','utf8')==='scratch';
      const socket=net.connect({host:'127.0.0.1',port:9});
      socket.on('connect',()=>{result.network=false;socket.destroy()});
      socket.on('error',e=>{result.network=e.code==='EPERM'||e.code==='EACCES'});
      socket.on('close',()=>process.stdout.write(JSON.stringify(result)));`;
    const result = await invoke({ "probe.mjs": probe }, "probe.mjs");
    qualificationExecutions += result.physicalExecutions ?? 0;
    if (result.kind !== "completed" || result.code !== 0)
      return { kind: "unavailable", reason: "profile_probe_failed", probeKind: result.kind,
        exitCode: result.code, signal: result.signal, detail: result.stderr?.toString().slice(0, 1024) };
    try { qualification = JSON.parse(result.stdout); } catch {
      return { kind: "unavailable", reason: "profile_probe_invalid" };
    }
    if (Object.keys(qualification).length !== 10 || !Object.values(qualification).every(x => x === true))
      return { kind: "unavailable", reason: "profile_probe_denial_missing", qualification };
    const flood = await invoke({ "probe.mjs":
      `process.stdout.write('x'.repeat(${maximumOutputBytes + 1}));` }, "probe.mjs");
    qualificationExecutions += flood.physicalExecutions ?? 0;
    qualification.outputLimit = flood.kind === "output_limit" && flood.outputBytes > maximumOutputBytes;
    if (!qualification.outputLimit) return { kind: "unavailable", reason: "output_bound_missing" };
  } finally { await rm(canaryRoot, { recursive: true, force: true }); }

  async function parserTrace(source, trace, signal) {
    // A process owns at most 32 realms; reclamation does not depend on V8 GC timing.
    const rows = [], deadline = performance.now() + timeoutMs;
    let state, offset = 0, physicalExecutions = 0, outputBytes = 0;
    let logicalBytes = Buffer.byteLength(JSON.stringify({ nonce: randomUUID(), kind: "observations", rows }));
    do {
      const count = offset === 0 ? 31 : 32; // The first worker also creates the initial realm.
      const nonce = randomUUID(), chunk = trace.slice(offset, offset + count);
      const more = offset + chunk.length < trace.length;
      const input = JSON.stringify({ nonce, trace: chunk, ...(more ? { checkpoint: true } : {}),
        ...(offset === 0 ? {} : { state }) });
      const result = await invoke({ "driver.mjs": driver, "session.mjs": source,
        "trace.json": input }, "driver.mjs", { signal, deadline, checkpoint: more ? nonce : null });
      physicalExecutions += result.physicalExecutions ?? 0;
      outputBytes += result.outputBytes ?? 0;
      const metadata = { runner, physicalExecutions, outputBytes };
      if (result.kind !== "completed") return { kind: result.kind, ...metadata };
      if (performance.now() >= deadline) return { kind: "timeout", ...metadata };
      if (result.code !== 0) return { kind: "execution_failed", ...metadata, exitCode: result.code };
      let decoded;
      try { decoded = JSON.parse(result.stdout.toString("utf8")); }
      catch { return { kind: "malformed_output", ...metadata }; }
      if (decoded?.nonce !== nonce || decoded?.kind !== "observations" ||
          !Array.isArray(decoded.rows) || decoded.rows.length !== chunk.length ||
          Object.keys(decoded).length !== 3)
        return { kind: "malformed_output", ...metadata };
      for (const row of decoded.rows) {
        logicalBytes += Buffer.byteLength(JSON.stringify(row)) + Number(rows.length !== 0);
        if (logicalBytes > maximumOutputBytes) return { kind: "output_limit", ...metadata };
        rows.push(row);
      }
      state = result.state;
      offset += chunk.length;
    } while (offset < trace.length);
    if (performance.now() >= deadline) return { kind: "timeout", runner, physicalExecutions, outputBytes };
    return { kind: "completed", runner, physicalExecutions, outputBytes, rows };
  }

  return Object.freeze({ kind: "qualified", runner, contract, qualification, qualificationExecutions,
    async execute(source, trace, { signal } = {}) {
      if (typeof source !== "string" || Buffer.byteLength(source) > 8192)
        throw new TypeError("candidate source exceeds 8192 bytes");
      const nonce = randomUUID();
      const input = JSON.stringify({ nonce, trace });
      const maximumTraceBytes = name === "agent.incremental-parser.macos-seatbelt.v1" ? 2097152 : 16384;
      if (Buffer.byteLength(input) > maximumTraceBytes) throw new TypeError("trace input too large");
      if (name === "agent.incremental-parser.macos-seatbelt.v1") {
        const captured = JSON.parse(input).trace;
        if (Array.isArray(captured)) return parserTrace(source, captured, signal);
      }
      const result = await invoke({ "driver.mjs": driver, "session.mjs": source,
        "trace.json": input }, "driver.mjs", { signal });
      const metadata = { runner, physicalExecutions: result.physicalExecutions ?? 0,
        outputBytes: result.outputBytes ?? 0 };
      if (result.kind !== "completed") return { kind: result.kind, ...metadata };
      if (result.code !== 0) return { kind: "execution_failed", ...metadata, exitCode: result.code };
      let decoded;
      try { decoded = JSON.parse(result.stdout.toString("utf8")); }
      catch { return { kind: "malformed_output", ...metadata }; }
      if (decoded?.nonce !== nonce || decoded?.kind !== "observations" ||
          !Array.isArray(decoded.rows) || Object.keys(decoded).length !== 3)
        return { kind: "malformed_output", ...metadata };
      return { kind: "completed", ...metadata, rows: decoded.rows };
    },
  });
}
