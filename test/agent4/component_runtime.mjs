import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, copyFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { verifyRuntime, readDependencyLock } from "../../tools/agent4/dependencies.mjs";

const [emitter, linker, runtimePath] = process.argv.slice(2).map(x => resolve(x));
const identity = verifyRuntime(runtimePath), lock = readDependencyLock();
const world = await import(pathToFileURL(identity.entrypoint));
const kernelBytes = new Uint8Array(await readFile(identity.kernelPath));
const area = await mkdtemp(join(tmpdir(), "agent-three-components-"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const integer = n => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const currentArea = await mkdtemp(join(tmpdir(), "agent-current-components-"));
const objects = {}, currentObjects = {}, images = {}, emissions = {}, links = [];
let transfers = 0;
const predecessor = JSON.parse(await readFile(new URL("./fixtures/component-predecessors.json", import.meta.url), "utf8"));
try {
  for (const [file, kind] of [["call", "call"], ["state", "state"], ["suspend", "suspended"], ["double", "double"]]) {
    const current = execFileSync(emitter, [kind]);
    currentObjects[file] = { sha256: digest(current), bytes: current.length };
    await writeFile(join(currentArea, `${file}.bmo1`), current);
    const bytes = await readFile(new URL(`./fixtures/component-${file}.bmo1`, import.meta.url));
    emissions[file] = (emissions[file] ?? 0) + 1;
    objects[file] = { sha256: digest(bytes), bytes: bytes.length };
    await writeFile(join(area, `${file}.bmo1`), bytes);
  }
  await copyFile(linker, join(area, "link"));
  await copyFile(linker, join(currentArea, "link"));
  // Only compiled objects and a link/client executable cross this boundary.
  assert.deepEqual((await readdir(area)).sort(), ["call.bmo1", "double.bmo1", "link", "state.bmo1", "suspend.bmo1"]);
  assert.deepEqual(objects, predecessor.objects, "comparison object identities changed");
  for (const selector of ["off", "safe"]) {
    const rejected = spawnSync(join(area, "link"), ["agent", selector], {cwd: area});
    assert.notEqual(rejected.status, 0);
    assert.equal(rejected.stdout.length, 0);
    assert.match(rejected.stderr.toString(), /UnexpectedArgument/);
  }
  for (const corpus of [{prefix:"", directory:area, objects}, {prefix:"current-", directory:currentArea, objects:currentObjects}])
  for (const mode of ["standalone", "double", "agent", "agent-next"]) {
    const name = corpus.prefix + mode;
    const linked = spawnSync(join(corpus.directory, "link"), [mode], {cwd: corpus.directory});
    assert.equal(linked.status, 0, linked.stderr.toString());
    images[name] = new Uint8Array(linked.stdout);
    const observed = JSON.parse(linked.stderr.toString());
    assert.equal(observed.sourceChecks, mode.startsWith("agent") ? 1 : 0);
    assert.equal(observed.lowerings, mode.startsWith("agent") ? 1 : 0);
    assert.ok(["applied", "no_change", "size_guard"].includes(observed.coalescing));
    assert.equal(observed.selectedBytes, images[name].length);
    assert.ok(observed.selectedBytes <= observed.baselineBytes);
    links.push({mode:name, ...observed});
    for (const [file, expected] of Object.entries(corpus.objects))
      assert.equal(digest(await readFile(join(corpus.directory, file + ".bmo1"))), expected.sha256);
  }
  assert.notDeepEqual(images.standalone, images.double);
  assert.notDeepEqual(images.agent, images["agent-next"]);
  const repeated = spawnSync(join(area, "link"), ["agent"], {cwd: area});
  assert.equal(repeated.status, 0, repeated.stderr.toString());
  assert.deepEqual(new Uint8Array(repeated.stdout), images.agent);
  for (const [name, saved] of Object.entries(predecessor.images)) {
    const bytes = Buffer.from(saved.base64, "base64");
    assert.equal(digest(bytes), saved.sha256);
    images["previous-" + name] = bytes;
  }
  const kernel = async () => {
    const k = await world.Kernel.create({ bytes: kernelBytes, expectedSha256: identity.kernelSha256 });
    const limit = lock.world.runtime.physicalProfile.maximumMemoryBytes;
    k.setLimits({ input: limit, working: limit, output: limit });
    return k;
  };
  async function run(mode, cancel = false) {
    const fixture = mode.replace(/^(previous|current)-/, "");
    let command = { image: images[mode], initialArgs: fixture.startsWith("agent") ? integer(100) : new Uint8Array() };
    let yields = 0, releases = 0;
    for (let round = 0; round < 16; round++) {
      const k = await kernel();
      const outcome = world.decodeOutcome(k.invoke(world.encodeInput(command)));
      if (outcome.kind === "completed" || outcome.kind === "cancelled") {
        assert.equal(yields, 1); assert.equal(releases, 1);
        assert.equal(outcome.kind, cancel ? "cancelled" : "completed");
        if (!cancel) assert.deepEqual(outcome.value, integer({ standalone: 83, double: 166,
          agent: 183, "agent-next": 184, "agent-safe": 183 }[fixture]));
        return;
      }
      assert.ok(outcome.state);
      if (outcome.kind === "yielded") {
        yields++;
        command = { image: images[mode], state: outcome.state,
          control: cancel ? "cancel_text" : "resume_yield",
          ...(cancel ? { value: new TextEncoder().encode("stop") } : {}) };
      } else {
        assert.equal(outcome.kind, "requested");
        const request = await world.decodeRequest(outcome.request);
        assert.equal(request.semanticIdentity, "component/release");
        assert.deepEqual(request.payload, integer(83));
        releases++;
        command = { image: images[mode], state: outcome.state, control: "reply",
          value: await world.encodeResult(outcome.request, new Uint8Array()) };
      }
      transfers++;
    }
    throw new Error("component program did not terminate");
  }
  for (const mode of Object.keys(images)) await run(mode);
  await run("agent", true);
  await run("current-agent", true);
  await run("previous-agent", true);
  await run("previous-agent-safe", true);
  console.log(JSON.stringify({ check: "three immutable effectful components in Agent",
    objects, currentObjects, predecessorCommit: predecessor.agentCommit, componentEmissions: emissions, links, imageBytes: Object.fromEntries(Object.entries(images).map(([name, bytes]) => [name, bytes.length])), transfers }));
} finally { await rm(area, { recursive: true, force: true }); await rm(currentArea, { recursive: true, force: true }); }
