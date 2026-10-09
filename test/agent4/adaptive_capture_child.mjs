// Fault controller only; all execution and recovery code comes from the archive.
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const [root, encoded] = process.argv.slice(2), options = JSON.parse(encoded);
const {AdaptiveRunner} = await import(pathToFileURL(join(root, 'runtime/adaptive/runner.mjs')).href);
let runner, captures = 0;
try {
  runner = await AdaptiveRunner.open(options, {onBoundary: async event => {
    if (event.operation !== 'agent.model.invoke.v6') return;
    if (event.phase === 'dispatch' && captures === 0) {
      runner.message('followup-one', {message: 'Distinguish lexical observations from unrun checks.'});
      runner.message('followup-two', {message: 'Keep the acquired source identity in the report.'});
      runner.message('followup-three', {message: 'Do not claim that lexical inspection proves correctness.'});
    }
    if (event.phase === 'capture' && ++captures === 8) {
      await new Promise((resolve, reject) => process.send({captured: runner.status()}, error => error ? reject(error) : resolve()));
      await new Promise(() => {}); // Parent kills the process before interpretation.
    }
  }});
  await runner.start({task: 'Explain the fixture entry point using source evidence and exercise the approved adaptive controls.'});
  await runner.drive();
  throw new Error('CaptureBoundaryNotReached');
} catch (error) {
  process.stderr.write(error.stack + '\n'); process.exitCode = 1;
  if (runner) await runner.close();
}
