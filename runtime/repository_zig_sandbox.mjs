// The Zig specialization of inquiry's OS isolation owner. The pinned compiler
// and candidate each run in a fresh domain that cannot fork or exec again.
// No repository build.zig is executed. Deployment-owned roots/harnesses decide
// the finite command contract; this module does not choose application work.
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { release, tmpdir } from 'node:os';
import { sandboxLibraries, sandboxString as q, launchSandboxProcess as launch } from './inquiry_sandbox.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
const diskutil = '/usr/sbin/diskutil';
const dyld = '/System/Library/Sandbox/Profiles/dyld-support.sb';
const fail = reason => { throw new Error(reason); };
const defaults = Object.freeze({ timeoutMs: 30000, maximumOutputBytes: 262144, scratchBytes: 256 << 20 });

function profile({ files, input, scratch, library, trustedRuntimeThreads = false }) {
  const parents = new Set(['/']);
  for (const name of [...files, input, scratch, ...(library ? [library] : [])])
    for (let parent = dirname(name); parent !== '/'; parent = dirname(parent)) parents.add(parent);
  return `(version 1)(deny default)(import "dyld-support.sb")
    ${library || trustedRuntimeThreads ? '' : `(deny syscall-unix (syscall-number SYS_bsdthread_create SYS_workq_open SYS_workq_kernreturn))
    (deny syscall-mig (kernel-mig-routine thread_create_from_user thread_create_running_from_user))`}
    (allow sysctl-read)
    (allow file-read-metadata file-test-existence ${[...parents].map(p => `(literal ${q(p)})`).join(' ')})
    (allow file-map-executable ${files.map(p => `(literal ${q(p)})`).join(' ')})
    (allow file-read* (subpath "/System/Library") (subpath "/usr/lib")
      (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")
      ${files.map(p => `(literal ${q(p)})`).join(' ')}
      (subpath ${q(input)}) (subpath ${q(scratch)}) ${library ? `(subpath ${q(library)})` : ''})
    (allow file-write* (subpath ${q(scratch)}))`;
}

async function trusted(command, args, cwd) {
  const result = await launch(command, args, { cwd, timeoutMs: 60000, maximumOutputBytes: 65536 });
  if (result.kind !== 'completed' || result.code !== 0) fail(`setup_${result.kind}_${result.code}`);
  return result.stdout;
}

// The backing image has a fixed logical length. Candidate writes can exhaust
// this volume but cannot grow its backing file or write to the host filesystem.
async function volume(root, bytes) {
  const directory = await mkdtemp(join(root, 'agent-zig-'));
  const image = join(directory, 'scratch.dmg'), mount = join(directory, 'volume');
  let mounted = false;
  try {
    await trusted(diskutil, ['image', 'create', 'blank', '--format', 'RAW', '--size', String(bytes),
      '--volumeName', 'agent-check', '--fs', 'APFS', image], directory);
    if ((await lstat(image)).size !== bytes) fail('scratch_capacity');
    const attached = await trusted(diskutil, ['image', 'attach', '--nobrowse', '--mountPoint', mount, image], directory);
    mounted = true;
    const device = attached.toString('utf8').match(/^(\/dev\/disk[0-9]+)\s/m)?.[1];
    if (!device) fail('scratch_device');
    const filesystem = await statfs(mount);
    if ((await lstat(mount)).dev === (await lstat(directory)).dev ||
        filesystem.blocks * filesystem.bsize > bytes) fail('scratch_capacity');
    return { directory, mount, async close() {
      // Never recursively delete a volume whose detach did not complete.
      await trusted(diskutil, ['eject', device], directory);
      mounted = false;
      await rm(directory, { recursive: true, force: true });
    } };
  } catch (error) {
    // A timed-out attach/create can have an unknown external outcome. Preserve
    // its path for recovery rather than deleting through a possibly live mount.
    error.resourcePath = directory;
    if (mounted) {
      try { await trusted(diskutil, ['eject', mount], directory); mounted = false; } catch {}
    }
    throw error;
  }
}

const verdict = result => result.kind === 'completed' ? (result.code === 0 ? 'Passed' : 'Failed') :
  ({ timeout: 'TimedOut', cancelled: 'Cancelled', output_limit: 'InvalidOutput',
    unavailable: 'Unavailable', signal: 'Incomplete' }[result.kind] ?? 'Incomplete');

/** toolchain is the existing selectZig result, selected by the deployment owner.
 * Inputs are explicitly materialized bytes, never a checkout/path to be followed.
 * roots is a finite deployment-owned module graph; no user/model command text.
 */
export async function createZigRepositorySandbox({ toolchain, launcher, processLock, scratchRoot = tmpdir(),
  timeoutMs = defaults.timeoutMs, maximumOutputBytes = defaults.maximumOutputBytes,
  scratchBytes = defaults.scratchBytes } = {}) {
  if (process.platform !== 'darwin') return { kind: 'unavailable', reason: 'unsupported_host' };
  if (!toolchain?.identity || typeof toolchain.assertUnchanged !== 'function')
    throw new TypeError('selected Zig toolchain required');
  if (![launcher, processLock].every(item => typeof item?.path === 'string' && /^[a-f0-9]{64}$/.test(item?.sha256)))
    throw new TypeError('installed resource launcher and lock identities required');
  launcher = structuredClone(launcher); processLock = structuredClone(processLock);
  const selectedToolchain = structuredClone(toolchain.identity), selectedExecutable = toolchain.executable;
  for (const [value, low, high] of [[timeoutMs, 100, 120000], [maximumOutputBytes, 1024, 262144],
    [scratchBytes, 64 << 20, 1024 << 20]])
    if (!Number.isSafeInteger(value) || value < low || value > high) throw new TypeError('invalid Zig check limit');
  let dependencies, nodeDependencies, nodeExecutable, observerBytes, pinned, root;
  try {
    toolchain.assertUnchanged();
    root = await realpath(scratchRoot);
    dependencies = await sandboxLibraries(toolchain.executable);
    nodeExecutable = await realpath(process.execPath); nodeDependencies = await sandboxLibraries(nodeExecutable);
    observerBytes = await readFile(new URL('./repository_wasm_observer.mjs', import.meta.url));
    for (const item of [launcher, processLock]) {
      if (item.path.includes(':') || await realpath(item.path) !== item.path ||
          !(await lstat(item.path)).isFile() || hash(await readFile(item.path)) !== item.sha256) fail('helper_identity');
    }
    pinned = await Promise.all([diskutil, dyld, launcher.path, processLock.path].map(async path => ({ path,
      identity: identity(await lstat(path)), sha256: hash(await readFile(path)) })));
  } catch { return { kind: 'unavailable', reason: 'profile_setup_failed' }; }
  const helperFiles = [launcher.path, processLock.path];
  const compilerFiles = [...new Set([...helperFiles, ...dependencies.flatMap(d => [d.path, d.supplied, d.link])])];
  const contract = { name: 'agent.repository.zig017.macos-wasm-observation.v2', osRelease: release(),
    toolchain: selectedToolchain, dependencies: dependencies.map(({ path, supplied, link, sha256 }) => ({ path, supplied, link, sha256 })),
    helpers: pinned.map(({ path, sha256 }) => ({ path, sha256 })),
    observer: { nodeVersion: process.version, executable: nodeExecutable, dependencies: nodeDependencies.map(({ path, sha256 }) => ({ path, sha256 })), scriptSha256: hash(observerBytes), imports: [], abi: 'agent_observe(u32)->u64', maximumObservations: 64, maximumModuleBytes: 16 << 20 },
    implementation: hash(await readFile(import.meta.filename)),
    isolation: hash(await readFile(new URL('./inquiry_sandbox.mjs', import.meta.url))),
    timeoutMs, provisioningCommandMs: 60000, maximumOutputBytes, scratchBytes, compilerJobs: 1, candidateFork: false, subsequentExec: false,
    compilerMemoryMiB: 1024, candidateMemoryMiB: 64, candidateThreads: 1,
    cpuSeconds: Math.ceil(timeoutMs / 1000), openFiles: 128, coreBytes: 0 };
  const runner = hash(JSON.stringify(contract));
  async function unchanged() {
    toolchain.assertUnchanged();
    if (toolchain.executable !== selectedExecutable || JSON.stringify(toolchain.identity) !== JSON.stringify(selectedToolchain)) fail('toolchain_changed');
    for (const item of [...pinned, ...dependencies, ...nodeDependencies]) {
      if (identity(await lstat(item.path)) !== item.identity) fail('runner_changed');
      if (item.supplied && (await realpath(item.supplied) !== item.path || await realpath(item.link) !== item.path))
        fail('runner_changed');
    }
  }
  async function stage(executable, args, isolation, cwd, signal, deadline, remainingOutput, compile = false) {
    if (performance.now() >= deadline) return { kind: 'timeout', physicalExecutions: 0 };
    // The final image receives a fatal footprint limit. Its trusted
    // loader constructor then denies exec/fork, including direct self-exec.
    const readinessNonce = randomBytes(32).toString('hex');
    const result = await launch(launcher.path, [
      String(compile ? contract.compilerMemoryMiB : contract.candidateMemoryMiB), String(contract.cpuSeconds),
      String(scratchBytes), processLock.path, executable, ...args], {
      cwd, signal, readinessNonce, timeoutMs: Math.max(1, deadline - performance.now()), maximumOutputBytes: remainingOutput,
      env: { TZ: 'UTC', TMPDIR: cwd, ZIG_LOCAL_CACHE_DIR: join(cwd, 'cache'), ZIG_GLOBAL_CACHE_DIR: join(cwd, 'global'),
        AGENT_CHECK_SANDBOX_PROFILE: isolation, AGENT_CHECK_READY_NONCE: readinessNonce },
    });
    return result.kind === 'completed' && result.ready !== true ?
      { ...result, kind: 'unavailable', reason: 'isolation_not_initialized' } : result;
  }
  async function invoke(files, { roots = [{ name: 'root', path: 'main.zig', dependencies: [] }],
    test = true, signal, args = [], observe, executionMs, beforeExecute, observationCount = null } = {}) {
    let disk, executions = 0;
    try {
      await unchanged();
      if (signal?.aborted) return { status: 'Cancelled', physicalExecutions: 0 };
      const names = Object.keys(files);
      if (!names.length || names.length > 4096) throw new TypeError('input count');
      let total = 0;
      for (const name of names) {
        if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.zig$/.test(name) || name.split('/').includes('..'))
          throw new TypeError('input path');
        total += Buffer.byteLength(files[name]);
      }
      if (total > 128 << 20) throw new TypeError('input capacity');
      if (!Array.isArray(roots) || !roots.length || roots.length > 16 ||
          new Set(roots.map(r => r.name)).size !== roots.length) throw new TypeError('module graph');
      for (const row of roots) if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(row.name) ||
        !Object.hasOwn(files, row.path) || !Array.isArray(row.dependencies) || row.dependencies.length > 16 ||
        row.dependencies.some(d => !roots.some(r => r.name === d))) throw new TypeError('module graph');
      disk = await volume(root, scratchBytes);
      const input = join(disk.directory, 'input'), binaryRoot = join(disk.directory, 'binary');
      await mkdir(input, { mode: 0o700 }); await mkdir(binaryRoot, { mode: 0o700 });
      for (const [name, bytes] of Object.entries(files)) {
        await mkdir(dirname(join(input, name)), { recursive: true, mode: 0o700 });
        await writeFile(join(input, name), bytes, { flag: 'wx', mode: 0o400 });
      }
      const output = join(disk.mount, 'check'), binary = join(binaryRoot, 'check');
      const compileArgs = [test ? 'test' : 'build-exe', ...(test ? ['--test-no-exec'] : []), '-j1', '-O', 'safe',
        ...(observationCount === null ? ['-lc'] : ['-target', 'wasm32-freestanding', '-fno-entry', '-rdynamic', '-fno-lld', '--max-memory=16777216']), '--zig-lib-dir', toolchain.identity.library, '--cache-dir', join(disk.mount, 'cache'),
        '--global-cache-dir', join(disk.mount, 'global'), `-femit-bin=${output}`];
      for (const row of roots) {
        for (const dependency of row.dependencies) compileArgs.push('--dep', dependency);
        compileArgs.push(`-M${row.name}=${join(input, row.path)}`);
      }
      const deadline = performance.now() + timeoutMs;
      const compiled = await stage(toolchain.executable, compileArgs, profile({
        files: compilerFiles, input, scratch: disk.mount, library: toolchain.identity.library }),
      disk.mount, signal, deadline, maximumOutputBytes, true);
      executions += compiled.physicalExecutions ?? 0;
      if (verdict(compiled) !== 'Passed') return { status: verdict(compiled), phase: 'compile', ...diagnostics(compiled), physicalExecutions: executions };
      const stat = await lstat(output);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > (observationCount === null ? scratchBytes : contract.observer.maximumModuleBytes)) fail('invalid_binary');
      const bytes = await readFile(output);
      await writeFile(binary, bytes, { flag: 'wx', mode: 0o500 });
      beforeExecute?.();
      let run;
      if (observationCount === null) run = await stage(binary, args, profile({ files: [...helperFiles, binary], input, scratch: disk.mount }), disk.mount, signal,
        executionMs ? Math.min(deadline, performance.now() + executionMs) : deadline, maximumOutputBytes - (compiled.outputBytes ?? 0));
      else {
        const script = join(binaryRoot, 'observe.mjs'); await writeFile(script, observerBytes, { flag: 'wx', mode: 0o400 });
        const nodeFiles = [...new Set([...helperFiles, binary, script, ...nodeDependencies.flatMap(d => [d.path, d.supplied, d.link])])];
        run = await stage(nodeExecutable, ['--openssl-config=/dev/null', '--v8-pool-size=1', '--max-old-space-size=16', '--stack-size=1024', script, binary, String(observationCount)],
          profile({ files: nodeFiles, input, scratch: disk.mount, trustedRuntimeThreads: true }), disk.mount, signal,
          executionMs ? Math.min(deadline, performance.now() + executionMs) : deadline, maximumOutputBytes - (compiled.outputBytes ?? 0));
      }
      executions += run.physicalExecutions ?? 0;
      // Candidate writes are denied to these files; verify before interpreting.
      for (const [name, bytes] of Object.entries(files))
        if (!Buffer.from(bytes).equals(await readFile(join(input, name)))) fail('input_changed');
      if (!bytes.equals(await readFile(binary))) fail('binary_changed');
      await unchanged();
      const status = verdict(run);
      const mismatch = status === 'Passed' && observe && !observe(run);
      return { status: mismatch ? (observationCount === null ? 'InvalidOutput' : 'Failed') : status,
        phase: 'execute', ...diagnostics(run),
        ...(mismatch && observationCount !== null ? { reason: 'observation_mismatch' } : {}),
        outputBytes: (compiled.outputBytes ?? 0) + (run.outputBytes ?? 0),
        compilationStdout: compiled.stdout?.toString('utf8') ?? '',
        stderr: Buffer.concat([compiled.stderr ?? Buffer.alloc(0), run.stderr ?? Buffer.alloc(0)]).toString('utf8'),
        physicalExecutions: executions, binarySha256: hash(bytes) };
    } catch (error) {
      return { status: 'Unavailable', reason: error.message, resourcePath: error.resourcePath, physicalExecutions: executions };
    } finally {
      if (disk) await disk.close();
    }
  }
  function diagnostics(result) {
    return { exitCode: result.code, signal: result.signal, outputBytes: result.outputBytes ?? 0,
      reason: result.reason ?? result.spawnError ?? null,
      stdout: result.stdout?.toString('utf8') ?? '', stderr: result.stderr?.toString('utf8') ?? '' };
  }
  const canary = await mkdtemp(join(root, 'agent-zig-canary-'));
  const secret = join(canary, 'secret'), forbidden = join(canary, 'forbidden');
  let qualification;
  const observationProbe = await invoke({ 'main.zig': 'pub export fn agent_observe(_: u32) u64 { return 5; }' }, {
    test: false, observationCount: 1, observe: run => run.stdout.toString() === '["5"]\n' });
  if (observationProbe.status !== 'Passed') {
    await rm(canary, { recursive: true, force: true });
    return { kind: 'unavailable', reason: 'observation_probe', probe: observationProbe };
  }
  try {
    await writeFile(secret, 'qualification-only sentinel', { mode: 0o600 });
    const source = probeSource(secret, forbidden, contract.candidateMemoryMiB);
    const assembler = path => `const std = @import("std");\ncomptime { asm (${JSON.stringify(`.section __TEXT,__const\n.incbin ${JSON.stringify(path)}\n`)}); }\npub fn main() void { _ = std.c.write(1, "incbin\\n", 7); }`;
    const compilerRead = await invoke({ 'main.zig': assembler('../input/payload.zig'), 'payload.zig': 'probe bytes\n' },
      { test: false, observe: run => run.stdout.toString() === 'incbin\n' });
    if (compilerRead.status !== 'Passed') return { kind: 'unavailable', reason: 'compiler_positive_probe', probe: compilerRead };
    const compilerDenial = await invoke({ 'main.zig': assembler(secret) }, { test: false });
    if (compilerDenial.status !== 'Failed' || compilerDenial.phase !== 'compile')
      return { kind: 'unavailable', reason: 'compiler_denial_probe', probe: compilerDenial };
    const denials = await invoke({ 'main.zig': source }, { test: false, args: ['denials'],
      observe: run => run.stdout.toString() === 'qualified\n' });
    if (denials.status !== 'Passed') return { kind: 'unavailable', reason: 'denial_probe', probe: denials };
    const flood = await invoke({ 'main.zig': source }, { test: false, args: ['flood'] });
    if (flood.status !== 'InvalidOutput' || flood.outputBytes <= maximumOutputBytes)
      return { kind: 'unavailable', reason: 'output_probe', probe: flood };
    const full = await invoke({ 'main.zig': source }, { test: false, args: ['full'],
      observe: run => run.stdout.toString() === 'full\n' });
    if (full.status !== 'Passed') return { kind: 'unavailable', reason: 'scratch_probe', probe: full };
    const memory = await invoke({ 'main.zig': source }, { test: false, args: ['memory'] });
    if (memory.status !== 'Incomplete' || memory.signal !== 'SIGKILL' || memory.stdout !== 'allocating\n')
      return { kind: 'unavailable', reason: 'memory_probe', probe: memory };
    const threads = await invoke({ 'main.zig': source }, { test: false, args: ['threads'],
      observe: run => run.stdout.toString() === 'thread-limit\n' });
    if (threads.status !== 'Passed') return { kind: 'unavailable', reason: 'thread_probe', probe: threads };
    const timeout = await invoke({ 'main.zig': source }, { test: false, args: ['loop'], executionMs: 1000 });
    const controller = new AbortController();
    let timer;
    const cancel = await invoke({ 'main.zig': source }, { test: false, args: ['loop'], signal: controller.signal,
      beforeExecute: () => { timer = setTimeout(() => controller.abort(), 1000); } });
    clearTimeout(timer);
    const reaped = result => {
      const pid = Number(result.stdout.trim());
      if (!Number.isSafeInteger(pid) || pid < 2) return false;
      try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
    };
    if (timeout.status !== 'TimedOut' || cancel.status !== 'Cancelled' || !reaped(timeout) || !reaped(cancel))
      return { kind: 'unavailable', reason: 'termination_probe', probes: { timeout, cancel } };
    qualification = { observation: observationProbe, compilerRead, compilerDenial, denials, flood: { ...flood, stdout: '<bounded flood omitted>' }, full, memory, threads, timeout, cancel };
  } finally { await rm(canary, { recursive: true, force: true }); }
  return Object.freeze({ kind: 'qualified', runner, contract: structuredClone(contract), qualification: structuredClone(qualification),
    async execute(files, { roots, signal, expectedStdout } = {}) {
      // Only raw VM observations cross the trust boundary. The candidate cannot
      // write this channel; the parent alone holds and evaluates expectations.
      let expected;
      try { expected = JSON.parse(expectedStdout); } catch { throw new TypeError('canonical observation vector required'); }
      if (!Array.isArray(expected) || expected.length < 1 || expected.length > 64 ||
        expected.some(value => typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 0xffffffffffffffffn) ||
        JSON.stringify(expected) + '\n' !== expectedStdout) throw new TypeError('canonical observation vector required');
      const captured = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes)]));
      return { runner, ...(await invoke(captured, { roots: roots && structuredClone(roots), signal, test: false, observationCount: expected.length,
        observe: run => run.stdout.equals(Buffer.from(expectedStdout)) })) };
    },
  });
}

function probeSource(secret, forbidden, memoryMiB) {
  return `const std = @import("std");
extern "c" fn open([*:0]const u8, c_int, ...) c_int;
extern "c" fn fork() c_int;
extern "c" fn socket(c_int, c_int, c_int) c_int;
extern "c" fn connect(c_int, *const anyopaque, u32) c_int;
extern "c" fn getpid() c_int;
extern "c" fn mach_task_self() u32;
extern "c" fn thread_create(u32, *u32) c_int;
var step: u32 = 0;
fn require(ok: bool) void { step += 1; if (!ok) { std.debug.print("probe {d}\\n", .{step}); std.c.exit(19); } }
var early_denied = false;
fn early() callconv(.c) void { early_denied = open(${JSON.stringify(forbidden)}, 0x201, @as(c_int, 384)) == -1; }
export var candidate_initializer: *const fn () callconv(.c) void linksection("__DATA,__mod_init_func") = early;
var finish_threads = std.atomic.Value(bool).init(false);
fn thread(_: ?*anyopaque) callconv(.c) ?*anyopaque {
    while (!finish_threads.load(.acquire)) std.atomic.spinLoopHint();
    return null;
}
pub fn main(init: std.process.Init.Minimal) void {
    const mode = std.mem.span(init.args.vector[1]);
    if (std.mem.eql(u8, mode, "denials")) {
        require(early_denied);
        require(std.c.write(3, "forged readiness", 16) == -1);
        require(open(${JSON.stringify(secret)}, 0) == -1);
        require(open(${JSON.stringify(forbidden)}, 0x201, @as(c_int, 384)) == -1);
        require(std.c.getenv("HOME") == null and std.c.getenv("OPENAI_API_KEY") == null);
        require(fork() == -1);
        require(std.c.setsid() == -1);
        const child_args = [_:null]?[*:0]const u8{ init.args.vector[0], "loop" };
        const child_env = [_:null]?[*:0]const u8{};
        var child_pid: std.c.pid_t = undefined;
        const spawned = std.c.posix_spawn(&child_pid, init.args.vector[0], null, null, &child_args, &child_env);
        require(spawned == 1 or spawned == 13);
        require(std.c.execve(init.args.vector[0], &child_args, &child_env) == -1);
        require(std.c._errno().* == 1 or std.c._errno().* == 13);
        const sock = socket(2, 1, 0);
        const address = [_]u8{ 16, 2, 0, 9, 127, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0 };
        require(sock == -1 or connect(sock, &address, address.len) == -1);
        require(std.c._errno().* == 1 or std.c._errno().* == 13);
        if (sock >= 0) _ = std.c.close(sock);
        require(open("../input/main.zig", 1) == -1);
        require(open("../binary/check", 1) == -1);
        require(std.c.symlink(${JSON.stringify(secret)}, "alias") == 0);
        require(open("alias", 0) == -1);
        const allowed = open("allowed", 0x201, @as(c_int, 384));
        require(allowed >= 0);
        require(std.c.write(allowed, "ok", 2) == 2);
        _ = std.c.close(allowed);
        _ = std.c.write(1, "qualified\\n", 10);
    } else if (std.mem.eql(u8, mode, "flood")) {
        const bytes: [4096]u8 = @splat('x');
        while (true) { _ = std.c.write(1, &bytes, bytes.len); }
    } else if (std.mem.eql(u8, mode, "full")) {
        const file = open("capacity", 0x201, @as(c_int, 384));
        require(file >= 0);
        const bytes: [65536]u8 = @splat(0x5a);
        while (std.c.write(file, &bytes, bytes.len) > 0) {}
        require(std.c._errno().* == 28); // Darwin ENOSPC, not a guessed byte count.
        _ = std.c.close(file);
        _ = std.c.write(1, "full\\n", 5);
    } else if (std.mem.eql(u8, mode, "threads")) {
        var handle: std.c.pthread_t = undefined;
        const outcome = std.c.pthread_create(&handle, null, thread, null);
        require(outcome == .AGAIN or outcome == .PERM or outcome == .ACCES);
        var port: u32 = 0;
        require(thread_create(mach_task_self(), &port) != 0);
        _ = std.c.write(1, "thread-limit\\n", 13);
    } else if (std.mem.eql(u8, mode, "memory")) {
        _ = std.c.write(1, "allocating\\n", 11);
        const size = ${memoryMiB + 16} * 1024 * 1024;
        const bytes: [*]volatile u8 = @ptrCast(std.c.malloc(size) orelse std.c.exit(20));
        var offset: usize = 0;
        while (offset < size) : (offset += 4096) bytes[offset] = @truncate(offset / 4096);
        _ = std.c.write(1, "escaped\\n", 8);
    } else {
        var buffer: [32]u8 = undefined;
        const pid = std.fmt.bufPrint(&buffer, "{d}\\n", .{getpid()}) catch unreachable;
        _ = std.c.write(1, pid.ptr, pid.len);
        while (true) { std.atomic.spinLoopHint(); }
    }
}`;
}
