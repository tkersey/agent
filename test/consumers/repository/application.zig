//! The bounded repair loop owns decisions, memory, replacement and completion.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const E = @import("source.zig").Emit;
pub const t = @import("types.zig");
pub const replacement = @import("replacement.zig");
const memory = @import("working_set.zig");
const completion = @import("completion.zig");
const DecisionContext = struct { memory: t.Memory, changed_files: completion.Changes };
const prompt = @import("prompt.zig");
const Id = boundary.computation.Id;
const Case = std.meta.Child(@FieldType(@FieldType(boundary.computation.ast.Term, "match_sum"), "cases"));

// The model's flat codec preserves the four-path result capacity. Normalization
// below constructs the portable vector; the host never selects program control.
pub const Finish = struct {
    summary: t.SummaryText,
    path0: t.Path,
    path1: t.Path,
    path2: t.Path,
    path3: t.Path,
    path_count: u8,
    tests_passed: bool,
    final_source_sha256: t.DigestHex,
};
pub const Answer = union(enum) {
    list_repository: struct {},
    read_file: t.ReadRequest,
    search_text: t.SearchRequest,
    run_tests: t.TestRequest,
    replace_file: t.ReplaceRequest,
    finish: Finish,
    abort: t.Failure,
};
pub const P = agent.model_invocation.Profile(Answer, .{
    .{ .name = "list_repository", .description = "List the admitted repository files." },
    .{ .name = "read_file", .description = "Read a package, source, or test document." },
    .{ .name = "search_text", .description = "Search admitted files for literal text." },
    .{ .name = "run_tests", .description = "Run the repository test suite." },
    .{ .name = "replace_file", .description = "Propose exact-source replacement for separate owner approval." },
    .{ .name = "finish", .description = "Finish after a failing baseline, applied mutation and passing retest; supply zero to four changed paths." },
    .{ .name = "abort", .description = "Stop with an explicit failure." },
}, .{
    .model_id_bytes = 64,
    .temperature_bytes = 8,
    .maximum_messages = 3,
    .message_bytes = 128 * 1024,
    .maximum_output_items = 4,
    .call_id_bytes = 64,
    .arguments_json_bytes = 240 * 1024,
    .result_text_bytes = 4096,
    .provider_response_bytes = 512 * 1024,
});
const Model = agent.model(.{ .name = "repository-repair", .model = "fixture-model", .protocol = struct {
    pub const semantic_identity = agent.model_invocation.protocol_identity;
} });
pub const Task = struct { goal: t.Goal, model: P.ModelId, principal: u64, maximum_steps: u16 };
pub const System = agent.system(.{ .InitialArgs = Task, .Result = t.FinalResult, .Failure = t.Failure, .application = Application });

pub const Application = struct {
    pub fn emit(c: agent.Context) !boundary.computation.Module {
        const b = c.builder;
        const e: E = .{ .c = c };
        const policy = try memory.define(c);
        const completed = try completion.define(e);
        const replace = try replacement.define(c);
        const model = try agent.responders.defineModel(P, c, try c.literal(t.Failure, .invalid_variant), false);
        const list = try c.external("repository.repair.list.v1", try c.schema(void), try c.schema(t.ListResult), .read);
        const read = try c.external("repository.repair.read.v1", try c.schema(t.ReadRequest), try c.schema(t.ReadResult), .read);
        const search = try c.external("repository.repair.search.v1", try c.schema(t.SearchRequest), try c.schema(t.SearchResult), .read);
        const tests = try c.external("repository.repair.test.v1", try c.schema(t.TestInvocation), try c.schema(t.TestResult), .read);
        const test_request = try @import("testing.zig").define(c);
        const effects = (try (boundary.computation.Row{ .effects = replace.effects }).unionWith(b.allocator(), .{ .effects = &.{ list, read, search, tests, try P.declare(b) } })).effects;
        const loop = try b.declare(&.{ try c.schema(Task), try c.schema(t.Memory), try c.schema(u16), try c.schema(completion.Changes) }, try c.schema(t.FinalResult), effects, &.{});
        const task = try e.param(loop, 0);
        const state = try e.param(loop, 1);
        const remaining = try e.param(loop, 2);
        const changes = try e.param(loop, 3);
        const next = try b.value(.{ .schema = try c.schema(u16), .expression = .{ .primitive = .{
            .opcode = .integer_sub,
            .operands = &.{ remaining, try c.literal(u16, 1) },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try c.literal(t.Failure, .arithmetic_overflow)) }},
        } } });
        const accepted = try b.variable(try c.schema(Answer));
        var cases: [7]Case = undefined;
        inline for (std.meta.fields(Answer), 0..) |field, index| {
            const v = try b.variable(try c.schema(field.type));
            const value = try b.reference(v);
            const body = if (index == 5)
                try finish(e, policy.final_allowed, completed.allowed, state, changes, value)
            else if (index == 6)
                try b.term(.{ .fail = value })
            else blk: {
                const O = std.meta.fields(t.Observation)[index].type;
                const observed = try b.variable(try c.schema(O));
                const updated = try b.variable(try c.schema(t.Memory));
                const operation = if (index == 4)
                    try admittedReplace(e, completed.capacity, changes, value, replace.function, state, try e.field(u64, task, 2))
                else if (index == 3) blk_test: {
                    const invocation = try b.variable(try c.schema(t.TestInvocation));
                    break :blk_test try b.bind(invocation, try e.call(test_request, &.{ state, value }), try b.term(.{ .perform = .{ .effect = tests, .payload = try b.reference(invocation) } }));
                } else try b.term(.{ .perform = .{ .effect = ([_]Id{ list, read, search, tests })[index], .payload = if (index == 0) try c.literal(void, {}) else value } });
                const observation = try b.primitive(try c.schema(t.Observation), .variant, &.{try b.reference(observed)}, index);
                const changed = try b.variable(try c.schema(completion.Changes));
                const record = if (index == 4) try e.call(completed.update, &.{ changes, try b.reference(observed) }) else try b.pure(changes);
                break :blk try b.bind(observed, operation, try b.bind(changed, record, try b.bind(updated, try e.call(policy.observe, &.{ state, observation }), try e.call(loop, &.{ task, try b.reference(updated), next, try b.reference(changed) }))));
            };
            cases[index] = .{ .variable = v, .body = body };
        }
        const chosen = try b.term(.{ .match_sum = .{ .value = try b.reference(accepted), .cases = &cases } });
        const interpreted = try b.variable(try c.schema(P.Interpretation));
        const rejected = try b.variable(try c.schema(P.InterpretationFailure));
        const admitted = try b.term(.{ .match_sum = .{ .value = try b.reference(interpreted), .cases = &.{
            .{ .variable = accepted, .body = chosen },
            .{ .variable = rejected, .body = try b.term(.{ .fail = try c.literal(t.Failure, .invalid_variant) }) },
        } } });
        const rendered = try b.variable(try c.schema(prompt.Text));
        const invoke = try e.call(model, &.{ try request(e, task, try b.reference(rendered)), try c.literal([7]bool, .{ true, true, true, true, true, true, true }) });
        const decision = try b.bind(rendered, try e.call(try prompt.render(DecisionContext, e), &.{try e.product(DecisionContext, &.{ state, changes })}), try b.bind(interpreted, invoke, admitted));
        try b.define(loop, try b.term(.{ .conditional = .{
            .condition = try e.binary(.less, try c.literal(u16, 0), remaining),
            .when_true = decision,
            .when_false = try b.term(.{ .fail = try c.literal(t.Failure, .budget_exhausted) }),
        } }));
        const entry = try b.declare(&.{try c.schema(Task)}, try c.schema(t.FinalResult), effects, &.{});
        const input = try e.param(entry, 0);
        try b.define(entry, try e.call(loop, &.{ input, try c.literal(t.Memory, memory.initial), try e.field(u16, input, 3), try c.literal(completion.Changes, .{ .items = &.{} }) }));
        return b.module(entry, try c.schema(t.Failure));
    }
};

fn request(e: E, task: Id, context: Id) !Id {
    const b = e.c.builder;
    const goal = try e.field(t.Goal, task, 0);
    const goal_text = try e.concat(P.MessageText, try e.field(t.GoalText, goal, 0), try e.c.literal(P.MessageText, .{ .bytes = "\nRepository: " }));
    const messages = [_]Id{
        try e.product(P.Message, &.{ try e.c.literal(agent.model_invocation.MessageRole, .system), try e.c.literal(P.MessageText, .{ .bytes = "Repair the repository. Select exactly one action per turn. Inspect first; observe a failing baseline test before proposing replacement. " ++
            "Use the latest source path and digest. Replacement needs separate owner approval. Retest after mutation before finishing. " ++
            "The current working set follows as labeled data; unobserved values are not evidence. Report actual changed paths and digest or abort honestly." }) }),
        try e.product(P.Message, &.{ try e.c.literal(agent.model_invocation.MessageRole, .user), try e.concat(P.MessageText, goal_text, try e.field(agent.contracts.Text(128), goal, 1)) }),
        try e.product(P.Message, &.{ try e.c.literal(agent.model_invocation.MessageRole, .user), context }),
    };
    const template = try P.templateValue(Model, .{ .items = &.{} }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
    var fields: [std.meta.fields(P.Request).len]Id = undefined;
    inline for (std.meta.fields(P.Request), 0..) |field, i| fields[i] = switch (i) {
        1 => try e.field(P.ModelId, task, 1),
        3 => try b.primitive(try e.c.schema(P.Messages), .sequence, &messages, 0),
        else => try e.c.literal(field.type, @field(template, field.name)),
    };
    return e.product(P.Request, &fields);
}

fn finish(e: E, allowed: Id, bound: Id, state: Id, changes: Id, proposed: Id) !Id {
    const b = e.c.builder;
    const Paths = @FieldType(t.FinalResult, "changed_files");
    var paths: [4]Id = undefined;
    for (&paths, 0..) |*path, i| path.* = try e.field(t.Path, proposed, i + 1);
    const count = try e.field(u8, proposed, 5);
    var selected = try b.primitive(try e.c.schema(Paths), .sequence, &paths, 0);
    for (0..4) |n| selected = try e.select(Paths, try e.binary(.equal, count, try e.c.literal(u8, @intCast(n))), try b.primitive(try e.c.schema(Paths), .sequence, paths[0..n], 0), selected);
    const result = try e.product(t.FinalResult, &.{ try e.field(t.SummaryText, proposed, 0), selected, try e.field(bool, proposed, 6), try e.field(t.DigestHex, proposed, 7) });
    const permitted = try b.variable(try e.c.schema(bool));
    const exact = try b.variable(try e.c.schema(bool));
    const valid = try e.both(try b.reference(exact), try e.both(try b.reference(permitted), try e.binary(.less, count, try e.c.literal(u8, 5))));
    return b.bind(exact, try e.call(bound, &.{ state, changes, result }), try b.bind(permitted, try e.call(allowed, &.{ state, result }), try b.term(.{ .conditional = .{
        .condition = valid,
        .when_true = try b.pure(result),
        .when_false = try b.term(.{ .fail = try e.c.literal(t.Failure, .authored_abort) }),
    } })));
}

fn admittedReplace(e: E, capacity: Id, changes: Id, request_: Id, replace: Id, state: Id, principal: Id) !Id {
    const b = e.c.builder;
    const room = try b.variable(try e.c.schema(bool));
    return b.bind(room, try e.call(capacity, &.{ changes, try e.field(t.Path, request_, 0) }), try b.term(.{ .conditional = .{
        .condition = try b.reference(room),
        .when_true = try e.call(replace, &.{ state, request_, principal }),
        .when_false = try b.term(.{ .fail = try e.c.literal(t.Failure, .capacity_exceeded) }),
    } }));
}
