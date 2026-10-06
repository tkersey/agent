//! Compiled leaf implementations and input/output mappings, with no agent loop.
const std = @import("std");
const native = @import("agent_native");
const t = @import("application_types");

pub const demo_input: t.Input = .{ .value = 20 };
pub const demo_answer: t.Answer = .{ .message = .{ .bytes = "offline answer" } };
pub const handlers = [_]native.Declaration{
    native.leaf(u32, u32, .{ .identity = t.increment_identity, .resource_role = "local" }, increment),
    native.question(t.Question, t.Answer, .{ .identity = t.question_identity, .resource_role = "user", .answer_schema_id = t.answer_schema_id }, present),
    native.leaf(void, void, .{ .identity = t.cleanup_identity, .resource_role = "local" }, cleanup),
};

fn increment(_: native.Context, value: u32) !u32 {
    return std.math.add(u32, value, 1);
}
fn cleanup(_: native.Context, _: void) !void {}
fn present(ctx: native.Context, question: t.Question) !native.json.Value {
    var result = native.json.object(ctx.allocator);
    try native.json.put(&result, "prompt", native.json.string(question.prompt.bytes));
    return result;
}
