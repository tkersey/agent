import assert from "node:assert/strict";
import { createServer } from "node:http";

const INITIAL_DIGEST = "8832f65e4bcf4a701dc76f310f3af34296bf8e95feb16ad70608041cb2e6dbb3";
const FINAL_DIGEST = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";
const CORRECT_SOURCE = `export function normalizeRange(start, end) {
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}
`;
const actions = Object.freeze([
  ["list_repository", {}],
  ["read_file", { role: 0 }],
  ["read_file", { role: 1 }],
  ["read_file", { role: 2 }],
  ["run_tests", {}],
  ["replace_file", {
    path: "src/range.mjs",
    expected_sha256: INITIAL_DIGEST,
    replacement: CORRECT_SOURCE,
    rationale: "Correct ascending preservation and descending normalization.",
  }],
  ["run_tests", {}],
  ["finish", {
    summary: "Corrected normalizeRange and verified the complete suite.",
    changed_path: "src/range.mjs",
    final_source_sha256: FINAL_DIGEST,
  }],
]);

export async function startFixtureModelServer(startDecision = 0) {
  let decision = startDecision;
  const captures = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/responses");
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bodyBytes = Buffer.concat(chunks);
      captures.push(bodyBytes);
      const body = JSON.parse(bodyBytes.toString("utf8"));
      assert.equal(body.model, "fixture-responses-model-v1");
      assert.equal(body.tool_choice, "required");
      assert.equal(body.parallel_tool_calls, false);
      assert.equal(body.store, false);
      assert.equal(body.stream, false);
      assert.equal(body.background, false);
      assert.equal(body.truncation, "disabled");
      const inspection = ["list_repository", "read_file", "search_text", "run_tests"];
      const expected = decision < 5 ? inspection : [...inspection, "replace_file", "finish"];
      assert.deepEqual(body.tools.map((tool) => tool.name), expected);
      const rendered = JSON.stringify(body.input);
      assert(rendered.includes("List, read the admitted files"));
      assert.equal(rendered.includes("After the baseline failure"), decision >= 5);
      const selected = actions[decision++];
      assert(selected !== undefined, "unexpected extra model request");
      const providerBody = Buffer.from(JSON.stringify({
        status: "completed",
        error: null,
        output: [{
          type: "function_call",
          status: "completed",
          name: selected[0],
          arguments: JSON.stringify(selected[1]),
        }],
      }));
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": providerBody.byteLength,
      });
      response.end(providerBody);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error?.stack ?? error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  return Object.freeze({
    endpoint: `http://127.0.0.1:${address.port}/v1/responses`,
    captures,
    get decision() { return decision; },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}
