// Copied reference application; no source tree, build tool or interpreter on PATH.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = process.argv[2];
assert(source);
const directory = mkdtempSync(join(tmpdir(), 'repository native 雪 '));
try {
  const binary = join(directory, 'repository-agent');
  cpSync(source, binary);
  const invoke = (...args) => {
    const result = spawnSync(binary, args, { cwd: directory, env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, `${args[0]}: ${result.error ?? result.stderr ?? result.stdout}`);
    return result.stdout;
  };
  assert.match(invoke('--help'), /serve --transport stdio/);
  const manifest = JSON.parse(invoke('describe-build'));
  assert.match(manifest.target, /^(?:x86_64-linux.*-musl|aarch64-macos.*)$/);
  const result = JSON.parse(invoke('demo', '--offline', '--state-dir', join(directory, 'state')));
  assert.equal(result.mode, 'offline-demo');
  assert.equal(result.output.disposition, 'report');
  assert.equal(result.output.model_calls, 4);
  assert.equal(result.output.work_calls, 3);
  assert.equal(result.output.evidence.length, 1);
  const evidence = result.output.evidence[0];
  const content = 'pub fn main() void {\n    // The offline fixture has no external effects.\n}\n';
  assert.equal(evidence.path, 'src/main.zig');
  assert.equal(evidence.content, content);
  assert.equal(evidence.start, '0');
  assert.equal(evidence.end, String(Buffer.byteLength(content)));
  assert.equal(evidence.file_bytes, evidence.end);
  assert.equal(evidence.sha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(evidence.snapshot.length, 32);
  const status = JSON.parse(invoke('status', '--offline', '--state-dir', join(directory, 'state'), '--task-id', result.task_id));
  assert.equal(status.status, 'completed');
  console.log(JSON.stringify({ repository_agent: 'offline', copied_binary: true, model_calls: 4, work_calls: 3, evidence: true, reopened: true }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
