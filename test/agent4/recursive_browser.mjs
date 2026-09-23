// Browser transport for the same byte-level transfer harness used by other engines.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function browserPeer({ worldEntry, kernelPath, tools, engine = 'chromium', sha256 }) {
  const playwright = await import(pathToFileURL(join(resolve(tools), 'node_modules/playwright-core/index.mjs')));
  assert.ok(['chromium', 'firefox'].includes(engine));
  const kernel = await readFile(kernelPath);
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/') return response.end('<!doctype html><title>Recursive participant transfer</title>');
      if (path === '/kernel.wasm') {
        response.setHeader('Content-Type', 'application/wasm');
        return response.end(kernel);
      }
      const file = path === '/worker.mjs' ? join(import.meta.dirname, 'recursive_worker.mjs') :
        /^\/world\/[a-z-]+\.mjs$/.test(path) ? join(dirname(resolve(worldEntry)), path.split('/').at(-1)) : null;
      if (!file) { response.writeHead(404); return response.end(); }
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright[engine].launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    let workersDestroyed = 0;
    return {
      identity: { engine, version: browser.version() },
      get workersDestroyed() { return workersDestroyed; },
      async invoke({ image, state, control, value, quantum }) {
        const data = { sha256, image: Array.from(image), state: Array.from(state),
          control, value: Array.from(value), quantum };
        const result = await page.evaluate(data => new Promise((resolve, reject) => {
          const worker = new Worker('/worker.mjs', { type: 'module' });
          worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
          worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
          worker.postMessage(data);
        }), data);
        workersDestroyed++;
        assert.equal(result.error, undefined, result.diagnostic);
        assert.equal(result.workingLive, '0');
        return new Uint8Array(result.output);
      },
      async close() {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
        return workersDestroyed;
      },
    };
  } catch (error) {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
}
