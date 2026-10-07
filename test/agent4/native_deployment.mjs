// Qualification controller only. The application sees its executable, selected
// user data and OS facilities; source trees and language runtimes are excluded.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

const shell = value => `'${value.replaceAll("'", "'\\''")}'`;

export function deployment(source, name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'Agent deployment ü ')));
  const data = join(root, 'data'), controller = join(root, 'controller');
  mkdirSync(data, {mode: 0o700});
  mkdirSync(controller, {mode: 0o700});
  const executable = join(root, name), command = join(controller, 'launch');
  copyFileSync(source, executable);
  const binary = readFileSync(executable), sha256 = createHash('sha256').update(binary).digest('hex');
  const format = execFileSync('file', ['-b', executable], {encoding: 'utf8'}).trim();
  let libraries = [], signing = 'not-applicable';
  if (process.platform === 'linux') {
    assert.match(format, /ELF 64-bit.*x86-64/);
    const linkage = execFileSync('readelf', ['-lWd', executable], {encoding: 'utf8'});
    assert(!/INTERP|\(NEEDED\)|\(RPATH\)|\(RUNPATH\)/.test(linkage), 'Linux product must have no dynamic loader or shared-library dependency');
    const args = ['/usr/bin/strace', '--kill-on-exit', '-f', '-qq', '-xx', '-s', '4096', '-e', 'trace=process,file', '-o', '/trace'];
    // Start the tracer after namespace admission: tracing bwrap itself can
    // prevent its OS security-profile transition. Mount only the tracer's
    // declared OS libraries, never a source tree or language runtime.
    const tracerLibraries = [...new Set(execFileSync('ldd', ['/usr/bin/strace'], {encoding: 'utf8'}).match(/\/[^\s()]+/g) ?? [])];
    assert(tracerLibraries.length > 0);
    assert(tracerLibraries.every(path => /^\/(?:usr\/)?lib(?:64)?\//.test(path)));
    const isolate = ['/usr/bin/bwrap', '--unshare-user', '--die-with-parent', '--unshare-pid', '--new-session', '--uid', '0', '--gid', '0',
      '--proc', '/proc', '--dev', '/dev', '--ro-bind', executable, executable, '--bind', data, data,
      ...['/usr/bin/strace', ...tracerLibraries].flatMap(path => ['--ro-bind', path, path])];
    // The trace file is the only controller file admitted into the namespace.
    writeFileSync(command, `#!/bin/sh\ntrace=${shell(join(controller, 'trace.'))}$$\n: > "$trace"\nexec ${isolate.map(shell).join(' ')} --bind "$trace" /trace --chdir "$PWD" ${args.map(shell).join(' ')} ${shell(executable)} "$@"\n`, {mode: 0o700});
  } else if (process.platform === 'darwin') {
    assert.match(format, /Mach-O 64-bit executable arm64/);
    libraries = execFileSync('otool', ['-L', executable], {encoding: 'utf8'}).trim().split('\n').slice(1).map(line => line.trim().split(' (')[0]);
    assert(libraries.length > 0 && libraries.every(path => path.startsWith('/usr/lib/') || path.startsWith('/System/Library/')), 'only declared OS libraries may be linked');
    execFileSync('codesign', ['--verify', '--strict', executable], {stdio: 'pipe'});
    const signature = spawnSync('codesign', ['-dv', '--verbose=2', executable], {encoding: 'utf8'});
    assert.equal(signature.status, 0, signature.stderr);
    signing = /Signature=adhoc/.test(signature.stderr) ? 'ad-hoc' : 'verified; not release-qualified';
    const ancestors = [];
    for (let path = root;; path = dirname(path)) {
      ancestors.push(`(literal ${JSON.stringify(path)})`);
      if (dirname(path) === path) break;
    }
    const profile = join(controller, 'deployment.sb');
    writeFileSync(profile, `(version 1)\n(allow default)\n(deny process-exec)\n(allow process-exec (literal ${JSON.stringify(executable)}))\n(deny file-read-data)\n(allow file-read-data (literal ${JSON.stringify(executable)}) (subpath ${JSON.stringify(data)}) ${ancestors.join(' ')} (subpath "/System") (subpath "/usr/lib") (subpath "/dev"))\n(deny file-write*)\n(allow file-write* (subpath ${JSON.stringify(data)}) (subpath "/dev"))\n`, {mode: 0o600});
    writeFileSync(command, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${shell(profile)} ${shell(executable)} "$@"\n`, {mode: 0o700});
  } else throw new Error('unqualified native deployment platform');
  return {data, controller, executable, command, close(passed) {
    try {
      let executions = 0;
      if (process.platform === 'linux' && passed) {
        const traces = readdirSync(controller).filter(name => name.startsWith('trace.'));
        assert(traces.length > 0, 'deployment must have an executed trace');
        for (const name of traces) {
          const trace = readFileSync(join(controller, name), 'utf8');
          assert(trace.length < 8 * 1024 * 1024, 'bounded deployment trace');
          for (const line of trace.split('\n')) {
            if (!/\bexecve(?:at)?\(/.test(line)) continue;
            assert(!line.includes('execveat('), line);
            const match = line.match(/execve\("((?:\\.|[^"\\])*)"/);
            assert(match, line);
            const octets = match[1].match(/\\x[0-9a-fA-F]{2}/g) ?? [];
            assert.equal(octets.join(''), match[1], line);
            const path = Buffer.from(octets.map(octet => parseInt(octet.slice(2), 16))).toString('utf8');
            assert(path === executable, `unexpected deployment executable: ${path}`);
            if (path === executable) executions++;
          }
        }
        assert(executions > 0);
      }
      console.log(JSON.stringify({native_deployment: name, passed, platform: process.platform, format, libraries, signing, sha256, bytes: binary.length, traced_executions: executions,
        boundary: process.platform === 'linux' ? 'private user/mount/PID namespaces' : 'OS file-read and executable allowlist'}));
    } finally { rmSync(root, {recursive: true, force: true}); }
  }};
}
