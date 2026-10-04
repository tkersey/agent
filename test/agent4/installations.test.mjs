import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authoringFiles, authoringInstallation } from './installations.mjs';

function fixture(t, imported) {
  const root = mkdtempSync(join(tmpdir(), 'agent source accounting '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ['src/agent4.zig', 'src/contracts.zig', 'build.zig', 'build_agent4.zig',
    'build.zig.zon', 'LICENSE', 'README.md', 'tools/agent4/dependencies.mjs',
    'runtime/cli.mjs', 'conformance/agent4/dependencies.lock.json'];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), file === 'build_agent4.zig' ? imported : '');
  }
  return root;
}

test('the same installation scanner accepts compiler builtin but rejects unaccounted inputs before Zig or output', async t => {
  const root = fixture(t, 'const version = @import("builtin").zig_version;');
  assert(authoringFiles(root).has('build_agent4.zig'));
  const command = fileURLToPath(new URL('./installations.mjs', import.meta.url));
  // No compiler, dependency checkout, valid lock, or network is needed by scan-only.
  const run = spawnSync(process.execPath, [command, '--scan-only', '--source-root', root], {
    encoding: 'utf8', env: { ...process.env, PATH: '', AGENT_ZIG_EXE: '/nonexistent/compiler' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).check, 'authoring-source-accounting');
  for (const [source, error] of [
    ['const x = @import("unaccounted");', /unclassified authoring module: unaccounted/],
    ['const x = @import("world");', /unclassified authoring module: world/],
    ['const x = @import("../outside.zig");', /source import escapes package/],
    ['const x = @import(name);', /nonliteral import/],
    ['const x = @embedFile("data.bin");', /embedded authoring input/],
  ]) {
    writeFileSync(join(root, 'build_agent4.zig'), source);
    assert.throws(() => authoringFiles(root), error);
    await assert.rejects(authoringInstallation({ sourceRoot: root }), error);
    const failure = spawnSync(process.execPath, [command, '--scan-only', '--source-root', root], {
      encoding: 'utf8', env: { ...process.env, PATH: '', AGENT_ZIG_EXE: '/nonexistent/compiler' },
    });
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, error);
    assert.equal(existsSync(join(root, '.agent4')), false);
  }
});
