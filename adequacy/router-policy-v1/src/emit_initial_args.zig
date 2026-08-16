const std = @import("std");
const boundary = @import("boundary");
const definition = @import("definition.zig");

pub fn main(init: std.process.Init) !void {
    const goal = definition.Goal{
        .task = try definition.GoalText.fromSlice(
            "Upgrade the controlled path router into a deterministic method-aware router. " ++
                "normalizeMethod accepts only nonempty ASCII HTTP tokens (!#$%&'*+-.^_`|~ and alphanumerics), returns uppercase, never trims, and throws TypeError otherwise. " ++
                "canonicalAllow normalizes and deduplicates, adds HEAD for GET, orders only GET HEAD POST PUT PATCH DELETE OPTIONS as common methods, then orders every other token by raw UTF-8 bytes without mutating input. " ++
                "notFound returns exactly { kind: 'not_found' }; methodNotAllowed returns a fresh { kind: 'method_not_allowed', allow: canonicalAllow(allow) }. " ++
                "Router.add(method, pattern, handler) normalizes method, uses compilePattern, requires a nonempty string handler, rejects duplicate normalized-method plus exact-pattern registrations, returns the router, and retains registration order. " ++
                "Matching path precedence is greater static segments, then greater total segments, then earlier registration. Select exact request method first; HEAD falls back to GET only when exact HEAD is absent. A matched result reports requested_method, selected_method, handler, and decoded params. A path match with no method returns method_not_allowed using the union of all matching-pattern methods; otherwise return not_found. " ++
                "Export Router, compilePattern, normalizeMethod, canonicalAllow, notFound, and methodNotAllowed. Preserve src/pattern.mjs and all path-parameter behavior. " ++
                "Inspect every admitted source and test document before editing, run the full failing suite before mutation and after every replacement, modify only src/methods.mjs src/errors.mjs src/router.mjs src/index.mjs, and complete only after all four distinct replacements and a passing full suite.",
        ),
        .repository = try boundary.Text(128).fromSlice("router-policy-v1"),
    };
    const required = try boundary.schema.encodedSize(definition.Goal, goal);
    const encoded = try std.heap.page_allocator.alloc(u8, required);
    defer std.heap.page_allocator.free(encoded);
    _ = try boundary.schema.encode(definition.Goal, goal, encoded);
    var output_buffer: [8 * 1024]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(encoded);
    try output.interface.flush();
}
