#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  advanceFresh,
  compileProcessKernel,
  decodeRequest,
  encodeResult,
} from "./process_kernel_client.mjs";

const EXPECTED_EFFECTS = Object.freeze([
  "model.decide.v1", "repo.list.v1", "model.decide.v1", "repo.read.v1",
  "model.decide.v1", "repo.read.v1", "model.decide.v1", "repo.read.v1",
  "model.decide.v1", "repo.search.v1", "model.decide.v1", "repo.test.v1",
  "model.decide.v1", "repo.replace.approved.v1", "model.decide.v1",
  "repo.test.v1", "model.decide.v1",
]);
const EXPECTED_TREE = "0d9ac8802aac6597cb0a443245efb6f92a0249fe";
const EXPECTED_EXISTING_IMAGE =
  "7440076a8078220d9d4000b871423d981bbbee19aedba499afaa4a86239fe6a6";
const EXPECTED_EXISTING_TERMINAL =
  "6a473b2e74e2f8229d10061d1b613ad71ab2ad5b139c21bd9a898b7a2778f75c";
const EXPECTED_EXISTING_TYPED_IO =
  "bc3a65ec23bd18f166436a508da26d1e474d66a571ad7f8bb47d4cbac920e1b3";
const CORRECTED_SOURCE = `export function normalizeRange(start, end) {
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}
`;

const options = parseArgs(process.argv.slice(2));
const legacyDecisionTurn = options.get("legacy-decision-turn") === "true";
const [image, initialArgs] = await Promise.all([
  readCanonicalInput("image"),
  readCanonicalInput("initial-args"),
]);
if (legacyDecisionTurn && sha256(image) !== EXPECTED_EXISTING_IMAGE) {
  throw new Error("existing_bpi1_identity_mismatch");
}
const kernelPath = required("kernel");
const kernel = await compileProcessKernel(kernelPath);
const capabilitiesRoot = resolve(required("capabilities-root"));
const fixtureSource = resolve(required("fixture-root"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "portable-agentic-system-v1-"));
const workspaceRoot = join(temporaryRoot, "repository");
const runtimeRoot = join(temporaryRoot, "runtime");
const transferRoot = join(temporaryRoot, "transferred");
await cp(fixtureSource, workspaceRoot, { recursive: true, errorOnExist: true });
initializeGit(workspaceRoot);
await Promise.all([mkdir(runtimeRoot), mkdir(transferRoot)]);
await Promise.all([
  writeFile(join(runtimeRoot, "boundary-process-kernel-v1.wasm"), kernel.bytes),
  writeFile(join(runtimeRoot, "system.bpi1"), image),
  writeFile(join(runtimeRoot, "initial-args.bin"), initialArgs),
  cp(required("host-adapter"), join(runtimeRoot, "boundary-process-step.mjs")),
]);
await assertRuntimeInventory(runtimeRoot);

const codecs = await import(pathToFileURL(join(
  capabilitiesRoot,
  "src/v1/actuality/repository_repair_codecs.mjs",
)));
const bindingModule = await import(pathToFileURL(join(
  capabilitiesRoot,
  "src/v1/actuality/repository_workspace_binding.mjs",
)));
const workspaceAdapter = await import(pathToFileURL(join(
  capabilitiesRoot,
  "packages/repository-workspace-actuality/adapter.mjs",
)));
const bindings = bindingModule.repositoryWorkspaceBindings();
const context = {
  applicationId: workspaceAdapter.ADMITTED_APPLICATION_IDS[0],
  workspaceRoot,
  workspaceRootReal: await realpath(workspaceRoot),
  temporaryHome: temporaryRoot,
  bunExecutable: process.execPath,
  fixtureInitialManifestMatched: true,
  policy: Object.freeze({ repositoryActuality: true }),
};

let current = initialArgs;
let isState = false;
let pendingResult = null;
let reductions = 0;
let freshInstances = 0;
let transferProved = false;
let readAdmissionProved = false;
let replacementAdmissionProved = false;
let finalPathAdmissionProved = false;
let finalDigestAdmissionProved = false;
const trace = [];
const typedIo = [];
let terminal = null;
while (reductions < 512 && terminal === null) {
  const outcome = await advanceFresh(kernel, image, current, isState, pendingResult);
  reductions += 1;
  freshInstances += 1;
  pendingResult = null;
  if (outcome.kind === 0 || outcome.kind === 2) {
    current = outcome.primary;
    isState = true;
    continue;
  }
  if (outcome.kind === 1) {
    current = outcome.primary;
    isState = true;
    const requestBytes = outcome.secondary;
    const request = decodeRequest(requestBytes);
    if (!request.programDigest.equals(image.subarray(32, 64))) {
      throw new Error("request_program_digest_mismatch");
    }
    if (trace.length === 8 && !transferProved) {
      await Promise.all([
        writeFile(join(transferRoot, "system.bpi1"), image),
        writeFile(join(transferRoot, "process.pst1"), current),
      ]);
      const recovered = await advanceFresh(kernel, image, current, true, null);
      freshInstances += 1;
      if (recovered.kind !== 1 || !recovered.primary.equals(current) ||
          !recovered.secondary.equals(requestBytes)) {
        throw new Error("transferred_request_recovery_mismatch");
      }
      const transferInventory = (await readdir(transferRoot)).sort();
      if (JSON.stringify(transferInventory) !== JSON.stringify(["process.pst1", "system.bpi1"])) {
        throw new Error("transfer_inventory_invalid");
      }
      transferProved = true;
    }
    const response = await resolveEffect(request, trace.length);
    typedIo.push(Object.freeze({
      identity: request.identity,
      payload_sha256: sha256(request.payload),
      result_sha256: sha256(response),
    }));
    trace.push(request.identity);
    pendingResult = encodeResult(request, response);
    continue;
  }
  if (outcome.kind === 3) {
    terminal = outcome.primary;
    break;
  }
  if (outcome.kind === 5) throw new Error("unexpected_needs_capacity");
  throw new Error(`unexpected_process_outcome:${outcome.kind}`);
}
if (terminal === null) throw new Error("portable_process_did_not_complete");
if (JSON.stringify(trace) !== JSON.stringify(EXPECTED_EFFECTS)) {
  throw new Error(`effect_trace_mismatch:${JSON.stringify(trace)}`);
}
if (!transferProved) throw new Error("transfer_not_proved");
if (!legacyDecisionTurn && (!readAdmissionProved || !replacementAdmissionProved ||
    !finalPathAdmissionProved || !finalDigestAdmissionProved)) {
  throw new Error("repository_admission_negatives_not_proved");
}
const finalResult = codecs.decodeFinalResult(terminal);
const changedPaths = git(workspaceRoot, ["diff", "--name-only"])
  .split("\n").filter(Boolean);
git(workspaceRoot, ["add", "-A"]);
const finalTree = git(workspaceRoot, ["write-tree"]);
if (finalTree !== EXPECTED_TREE || JSON.stringify(changedPaths) !== JSON.stringify(["src/range.mjs"]) ||
    finalResult.tests_passed !== true || finalResult.final_source_sha256 !== sha256(
      await readFile(join(workspaceRoot, "src/range.mjs")),
    )) throw new Error(`terminal_repository_verification_failed:${JSON.stringify({
      finalTree,
      changedPaths,
      testsPassed: finalResult.tests_passed,
      finalDigest: finalResult.final_source_sha256,
    })}`);
if (legacyDecisionTurn && sha256(terminal) !== EXPECTED_EXISTING_TERMINAL) {
  throw new Error("existing_bpi1_terminal_result_mismatch");
}
const typedIoDigest = sha256(JSON.stringify(typedIo));
if (legacyDecisionTurn && typedIoDigest !== EXPECTED_EXISTING_TYPED_IO) {
  throw new Error("existing_bpi1_typed_io_mismatch");
}

process.stdout.write(JSON.stringify({
  format: legacyDecisionTurn
    ? "existing-bpi1-process-proof/v1"
    : "portable-agentic-system-proof/v1",
  image_sha256: sha256(image),
  kernel_sha256: sha256(kernel.bytes),
  kernel_import_count: 0,
  reductions,
  fresh_instances: freshInstances,
  external_boundaries: trace.length,
  model_decisions: trace.filter((value) => value === "model.decide.v1").length,
  repository_effects: trace.filter((value) => value !== "model.decide.v1").length,
  transfer_after_external_effect: 8,
  transferred_request_recovered: transferProved,
  final_git_tree: finalTree,
  runtime_inventory: (await readdir(runtimeRoot)).sort(),
  machine_v2_profile: false,
  application_specific_wasm: false,
  decision_contract_sidecar: false,
  ...(legacyDecisionTurn ? {} : {
    repository_read_admission: readAdmissionProved,
    repository_replacement_admission: replacementAdmissionProved,
    repository_final_path_admission: finalPathAdmissionProved,
    repository_final_digest_admission: finalDigestAdmissionProved,
  }),
  typed_io: typedIo,
  typed_io_digest: typedIoDigest,
  terminal_result_sha256: sha256(terminal),
}) + "\n");

async function resolveEffect(request, boundaryIndex) {
  if (request.identity === "model.decide.v1") {
    const { contractDigest, turn } = decodeDecisionEnvelope(
      request.payload,
      legacyDecisionTurn,
    );
    const decoded = codecs.decodeDecisionTurn(turn);
    if (decoded.contractDigest !== contractDigest) {
      throw new Error("decision_contract_digest_mismatch");
    }
    if (!legacyDecisionTurn && boundaryIndex === 0) {
      await expectActionRejected(request, {
        action: "read_file",
        arguments: { role: "source", path: "test/range.test.mjs" },
      });
      readAdmissionProved = true;
      await expectActionRejected(request, {
        action: "replace_file",
        arguments: {
          path: "src/range.mjs",
          expected_sha256: "0".repeat(64),
          replacement: CORRECTED_SOURCE,
          rationale: "Attempt replacement before observing the failing test.",
        },
      });
      replacementAdmissionProved = true;
    }
    const selected = scriptedAction(decoded);
    if (!legacyDecisionTurn && selected.action === "final") {
      await expectActionRejected(request, action("final", {
        ...selected.arguments,
        changed_files: ["test/range.test.mjs"],
      }));
      finalPathAdmissionProved = true;
      await expectActionRejected(request, action("final", {
        ...selected.arguments,
        final_source_sha256: "0".repeat(64),
      }));
      finalDigestAdmissionProved = true;
    }
    return codecs.encodeAction(selected);
  }
  const operation = new Map([
    ["repo.list.v1", "list"],
    ["repo.read.v1", "read"],
    ["repo.search.v1", "search"],
    ["repo.test.v1", "test"],
    ["repo.replace.approved.v1", "replace"],
  ]).get(request.identity);
  if (!operation) throw new Error(`unexpected_effect:${request.identity}`);
  const binding = bindings.find((entry) =>
    entry.bindingId === `repository-workspace-actuality.${operation}.v1`);
  if (!binding) throw new Error(`binding_missing:${operation}`);
  const requestId = request.requestIdentity.toString("hex");
  const projected = Object.freeze({
    protocolVersion: "boundary-process-effect-v1",
    requestId,
    idempotencyKey: sha256(Buffer.concat([
      Buffer.from("portable-agentic-system-v1\0"),
      request.requestIdentity,
    ])),
    interfaceId: Buffer.from(binding.interfaceId).toString("hex"),
    siteId: String(boundaryIndex),
    sequence: String(boundaryIndex),
    target: Object.freeze({ ...binding.target }),
    responseSchema: Object.freeze({ statuses: ["ok", "rejected", "failed"] }),
    limits: Object.freeze({ maximumResultBytes: 40 * 1024, maximumAttempts: 1 }),
    payload: binding.decodePayload(request.payload),
  });
  if (operation === "replace") {
    const proposalDigest = workspaceAdapter.proposalDigest(projected.payload);
    context.fixtureRequestDigest = proposalDigest;
    context.approval = Object.freeze({
      approved: true,
      requestId,
      proposalDigest,
      mode: "fixture-auto",
    });
  }
  const preflight = await binding.adapter.preflight(context, projected);
  if (preflight.status !== "ok") {
    throw new Error(`effect_preflight_failed:${request.identity}:${preflight.payload?.reason}`);
  }
  const outcome = await binding.adapter.resolve(context, projected);
  if (outcome.status !== "ok") {
    throw new Error(`effect_resolution_failed:${request.identity}:${outcome.status}`);
  }
  const response = Buffer.from(binding.encodeOutcome(outcome, projected));
  if (response.length > 40 * 1024) throw new Error("effect_result_too_large");
  return response;
}

async function expectActionRejected(request, candidate) {
  let state = current;
  let result = encodeResult(request, codecs.encodeAction(candidate));
  for (let reduction = 0; reduction < 32; reduction += 1) {
    const outcome = await advanceFresh(kernel, image, state, true, result);
    result = null;
    if (outcome.kind === 0 || outcome.kind === 2) {
      state = outcome.primary;
      continue;
    }
    if (outcome.kind === 4) return;
    if (outcome.kind === 1) {
      throw new Error(`forbidden_action_emitted_effect:${candidate.action}`);
    }
    throw new Error(`forbidden_action_wrong_outcome:${candidate.action}:${outcome.kind}`);
  }
  throw new Error(`forbidden_action_not_rejected:${candidate.action}`);
}

function decodeDecisionEnvelope(payload, legacy) {
  if (legacy) {
    if (payload.length < 32) throw new Error("decision_turn_short");
    return Object.freeze({
      contractDigest: payload.subarray(0, 32).toString("hex"),
      contract: Buffer.alloc(0),
      turn: Buffer.from(payload),
    });
  }
  if (payload.length < 104) throw new Error("decision_envelope_short");
  const contractDigest = payload.subarray(0, 32).toString("hex");
  if (payload.subarray(32, 40).toString("ascii") !== "AGT_DCT2") {
    throw new Error("decision_contract_missing");
  }
  for (let end = 104; end < payload.length; end += 1) {
    if (payload.subarray(end - 32, end).toString("hex") !== contractDigest) continue;
    const contract = payload.subarray(32, end);
    if (sha256(contract.subarray(0, -32)) !== contractDigest) continue;
    return Object.freeze({
      contractDigest,
      contract: Buffer.from(contract),
      turn: Buffer.from(payload.subarray(end)),
    });
  }
  throw new Error("decision_contract_not_self_contained");
}

async function readCanonicalInput(name) {
  const direct = options.get(name);
  if (direct) return readFile(direct);
  const encoded = options.get(`${name}-base64`);
  if (!encoded) throw new Error(`missing --${name} or --${name}-base64`);
  return Buffer.from((await readFile(encoded, "utf8")).replaceAll(/\s/g, ""), "base64");
}

function scriptedAction(request) {
  const view = request.context;
  const evidence = view.evidence;
  if (!view.listing) return action("list_repository", {});
  if (!view.packageDocument) return action("read_file", { role: "package", path: "package.json" });
  if (!view.sourceDocument && !evidence.mutationApplied) {
    return action("read_file", { role: "source", path: "src/range.mjs" });
  }
  if (!view.testDocument) return action("read_file", { role: "test", path: "test/range.test.mjs" });
  if (!view.latestSearch && !evidence.mutationApplied) {
    return action("search_text", { query: "normalizeRange", path_prefix: "src" });
  }
  if (!evidence.failingTestObserved) return action("run_tests", { suite: "default" });
  if (!evidence.mutationApplied) return action("replace_file", {
    path: "src/range.mjs",
    expected_sha256: view.sourceDocument.sha256,
    replacement: CORRECTED_SOURCE,
    rationale: "normalizeRange must preserve ascending bounds and swap only descending bounds.",
  });
  if (!evidence.passingTestObserved) return action("run_tests", { suite: "default" });
  return action("final", {
    summary: "Corrected normalizeRange and observed the complete Bun test suite passing.",
    changed_files: ["src/range.mjs"],
    tests_passed: true,
    final_source_sha256: view.replacement.payload.newSha256,
  });
}

function action(name, argumentsValue) {
  return Object.freeze({ action: name, arguments: Object.freeze(argumentsValue) });
}

async function assertRuntimeInventory(root) {
  const inventory = (await readdir(root)).sort();
  const expected = [
    "boundary-process-kernel-v1.wasm",
    "boundary-process-step.mjs",
    "initial-args.bin",
    "system.bpi1",
  ];
  if (JSON.stringify(inventory) !== JSON.stringify(expected)) {
    throw new Error(`runtime_inventory_invalid:${JSON.stringify(inventory)}`);
  }
  const adapter = await readFile(join(root, "boundary-process-step.mjs"), "utf8");
  for (const forbidden of ["AgentDefinition", "world-host", "world-capabilities", "repository-repair"]) {
    if (adapter.includes(forbidden)) throw new Error(`host_adapter_smuggling:${forbidden}`);
  }
}

function initializeGit(root) {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Portable Agentic System"]);
  git(root, ["config", "user.email", "portable@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture baseline"]);
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git_failed:${args.join(" ")}:${result.stderr}`);
  return result.stdout.trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(args) {
  const parsed = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith("--") || args[index + 1] === undefined) {
      throw new Error("expected --name value arguments");
    }
    parsed.set(args[index].slice(2), args[index + 1]);
  }
  return parsed;
}

function required(name) {
  const value = options.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}
