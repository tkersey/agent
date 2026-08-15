import assert from "node:assert/strict";

const child = Bun.spawn(["zig", "build", "reproduce"], {
  cwd: import.meta.dir,
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
const output = `${stdout}\n${stderr}`;
assert.notEqual(exitCode, 0, "the locked release unexpectedly expressed the required relation");
assert.match(output, /expected type 'flow\.Value\(main\.DocumentSlot\)', found 'flow\.Value\(u8\)'/);
assert.match(output, /right: @TypeOf\(left\)/);
console.log("agent_flow_expressivity obstruction reproduced");
