//! Independent public-API consumer: model proposals and actual inquiry futures.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const source = boundary.computation;
const t = @import("types.zig");
const s = @import("source.zig");
const Id = s.Id;
const E = s.E;
pub const System = agent.system(.{ .InitialArgs = t.Task, .Result = t.Result, .Failure = void, .application = Application });
pub const ReactSystem = @import("react.zig").System;
pub const RepeatedSystem = @import("repeated.zig").System;

pub const Application = struct {
    pub fn emit(c: agent.Context) !source.Module {
        const e = E{ .c = c };
        const task = try defineTask(c);
        const entry = try c.builder.declare(&.{try e.schema(t.Task)}, try e.schema(t.Result), c.builder.functions.items[task].effects, &.{});
        try c.builder.define(entry, try e.call(task, &.{ try e.p(entry, 0), try e.value(u64, 1) }));
        return c.builder.module(entry, try e.schema(void));
    }
};

pub fn defineTask(c: agent.Context) !Id {
    const e = E{ .c = c };
    const b = c.builder;
    const model = try t.P.declare(b);
    try c.registry.classify(model, .model);
    const cleanup = try c.external("inquiry.repair.cleanup.v1", try e.schema(u64), try e.schema(void), .read);
    const spec: agent.inquiry.broker.Spec = .{
        .identity = "inquiry.repair",
        .subject = try e.schema(t.Subject),
        .demand = try e.schema(t.Demand),
        .key = try e.schema(t.Key),
        .observation = try e.schema(t.Observation),
        .finding = try e.schema(t.Finding),
        .policy = try e.schema(bool),
        .failure = try e.value(void, {}),
        .scope = .{ .captures = &.{ try e.schema(t.Task), try e.schema(t.Working), try e.schema(t.Probe), try e.schema(t.Repair), try e.schema(t.Prediction), try e.schema(t.Hypothesis), try e.schema(t.Source), try e.schema(t.Reason), try e.schema(u64), try e.schema(bool) }, .residual = .{ .effects = &.{ model, cleanup } } },
    };
    const d = try agent.inquiry.broker.define(b, spec);
    const run = try agent.inquiry.broker.implementProtected(c, spec, d, try @import("policy.zig").define(e, d));
    const actor = try @import("investigator.zig").define(e, d, model, cleanup);
    const seed = try seedFunction(e, d, actor, &.{ model, cleanup });
    const rows = &.{ model, cleanup, d.experiment };
    const diagnose = try b.declare(&.{try e.schema(t.Task)}, try e.schema(t.InquiryOutcome), rows, &.{});
    try b.define(diagnose, try start(e, d, diagnose, run, seed));
    const live = try @import("live.zig").define(e);
    const task_function = try b.declare(&.{try e.schema(t.Task)}, try e.schema(t.Result), try e.row(rows, live.effects), &.{});
    const outcome = try b.variable(try e.schema(t.InquiryOutcome));
    try b.define(task_function, try b.bind(outcome, try e.call(diagnose, &.{try e.p(task_function, 0)}), try e.call(live.function, &.{ try e.p(task_function, 0), try e.ref(outcome) })));
    const entry = try intentEntry(e, task_function);
    return entry;
}

pub fn intentEntry(e: E, task_function: Id) !Id {
    const b = e.b();
    const question = try @import("intent.zig").define(e);
    const entry = try b.declare(&.{ try e.schema(t.Task), try e.schema(u64) }, try e.schema(t.Result), try e.row(b.functions.items[task_function].effects, &.{question.effect}), &.{});
    const supplied = try e.p(entry, 0);
    const subject = try e.field(t.Subject, supplied, 0);
    var subject_fields: [std.meta.fields(t.Subject).len]Id = undefined;
    inline for (std.meta.fields(t.Subject), 0..) |field, i| subject_fields[i] = if (i == 7)
        try e.p(entry, 1)
    else
        try e.field(field.type, subject, i);
    var task_fields: [std.meta.fields(t.Task).len]Id = undefined;
    inline for (std.meta.fields(t.Task), 0..) |field, i| task_fields[i] = switch (i) {
        0 => try e.product(t.Subject, &subject_fields),
        7 => try e.p(entry, 1),
        else => try e.field(field.type, supplied, i),
    };
    const answer = try b.variable(try e.schema(t.IntentResolution));
    const task = try b.variable(try e.schema(t.Task));
    const Case = std.meta.Child(@FieldType(@FieldType(source.ast.Term, "match_sum"), "cases"));
    var cases: [7]Case = undefined;
    cases[0] = .{ .variable = task, .body = try e.call(task_function, &.{try e.ref(task)}) };
    for (1..7) |i| cases[i] = .{ .variable = try b.variable(try e.schema(void)), .body = try b.pure(try e.variant(t.Result, try e.value(void, {}), 9 + i)) };
    const handled = try b.term(.{ .match_sum = .{ .value = try e.ref(answer), .cases = &cases } });
    try b.define(entry, try b.bind(answer, try e.call(question.function, &.{try e.product(t.Task, &task_fields)}), handled));
    return entry;
}

fn unresolved(e: E, reason: []const u8) !Id {
    const finding = try e.product(t.Found, &.{ try e.value(u64, 0), try e.variant(t.Finding, try e.value(t.Reason, .{ .bytes = reason }), 1) });
    return e.b().pure(try e.product(t.InquiryOutcome, &.{ try e.value(u8, 1), try e.b().primitive(try e.schema([]const t.Found), .sequence, &.{finding}, 0), try e.value([]const t.Record, &.{}), try e.value(u64, 0), try e.value(u64, 0), try e.value(u64, 0) }));
}

fn start(e: E, d: agent.inquiry.broker.Definition, entry: Id, run: Id, seed: Id) !Id {
    const b = e.b();
    const task = try e.p(entry, 0);
    const response = try b.variable(try e.schema(t.P.BatchInterpretation));
    const hypotheses = try b.variable(try e.schema([]const t.Answer));
    const failure = try b.variable(try e.schema(t.P.InterpretationFailure));
    const state = try b.variable(d.custody.types.state);
    const initialized = try e.call(seed, &.{ try e.ref(hypotheses), task, try agent.inquiry.empty(b, d.custody), try e.value(u64, 1) });
    const work = try b.bind(state, initialized, try e.call(run, &.{ try e.ref(state), try e.field(t.Subject, task, 0), try e.field(u64, task, 3), try e.field(bool, task, 5), try e.value(bool, false) }));
    const count = try b.primitive(try e.schema(u64), .sequence_length, &.{try e.ref(hypotheses)}, 0);
    const requested = try b.primitive(try e.schema(u64), .integer_convert, &.{try e.field(u8, task, 2)}, 0);
    const invalid = try unresolved(e, "Initial hypothesis count or operator allowance is invalid.");
    var checked = try e.cond(try e.less(requested, count), invalid, work);
    checked = try e.cond(try e.eq(count, try e.value(u64, 0)), invalid, checked);
    const branch = try b.term(.{ .match_sum = .{ .value = try e.ref(response), .cases = &.{
        .{ .variable = hypotheses, .body = checked },
        .{ .variable = failure, .body = try unresolved(e, "Initial model proposals unavailable or invalid.") },
    } } });
    const initial = try e.product(t.Working, &.{ try e.value(t.Reason, .{ .bytes = "Propose independent, qualified explanations. Do not assume the report is correct." }), try e.value(u64, 0), try e.value(agent.contracts.Text(4096), .{ .bytes = "No experimental evidence yet." }), try e.field(u64, task, 4), try e.value(t.Source, .{ .bytes = "" }) });
    const next = try b.bind(response, try e.call(try @import("models.zig").define(e), &.{ task, try e.value(u64, 0), try e.value(u64, 0), initial, try e.value(bool, true) }), branch);
    return admitTask(e, task, next, invalid);
}

pub fn admitTask(e: E, task: Id, continuation: Id, invalid: Id) !Id {
    const b = e.b();
    var next = continuation;
    const requested = try b.primitive(try e.schema(u64), .integer_convert, &.{try e.field(u8, task, 2)}, 0);
    for ([_][2]Id{
        .{ try e.value(u64, 0), requested },                 .{ requested, try e.value(u64, 9) },
        .{ try e.value(u64, 0), try e.field(u64, task, 3) }, .{ try e.field(u64, task, 3), try e.value(u64, 65) },
        .{ try e.value(u64, 0), try e.field(u64, task, 4) }, .{ try e.field(u64, task, 4), try e.value(u64, 33) },
    }) |bounds| next = try e.cond(try e.less(bounds[0], bounds[1]), next, invalid);
    const subject = try e.field(t.Subject, task, 0);
    const supported = try b.variable(try e.schema(bool));
    const expected = try e.product(t.Subject, &.{
        try e.value(agent.contracts.Text(32), .{ .bytes = "session.mjs" }),
        try e.field(t.Source, subject, 1),
        try e.field(t.Hash, subject, 2),
        try e.value(agent.contracts.Text(2048), .{ .bytes = @embedFile("contract.txt") }),
        try e.value(t.Hash, .{ .bytes = "agent.session-occurrence.acceptance.v1" }),
        try e.field(bool, subject, 5),
        try e.field(t.Hash, subject, 6),
        try e.field(u64, subject, 7),
    });
    return b.bind(supported, try agent.value_equality.compare(b, try e.schema(t.Subject), subject, expected, try e.value(void, {})), try e.cond(try e.ref(supported), next, invalid));
}

fn seedFunction(e: E, d: agent.inquiry.broker.Definition, actor: Id, effects: []const Id) !Id {
    const b = e.b();
    const f = try b.declare(&.{ try e.schema([]const t.Answer), try e.schema(t.Task), d.custody.types.state, try e.schema(u64) }, d.custody.types.state, effects, &.{});
    const pop = try @import("plans.zig").Pop.init(e, []const t.Answer, t.Answer);
    const answer = try b.variable(d.custody.dialogue.answer);
    const next = try b.variable(d.custody.types.state);
    const hypothesis = try b.variable(try e.schema(t.Hypothesis));
    const continued = try e.call(f, &.{ try e.ref(pop.rest), try e.p(f, 1), try e.ref(next), try e.arithmetic(.integer_add, try e.p(f, 3), try e.value(u64, 1)) });
    const park = try b.bind(next, try e.call(d.custody.park, &.{ try e.p(f, 2), try e.p(f, 3), try e.ref(answer) }), continued);
    const started = try b.bind(answer, try agent.dialogue.start(b, d.custody.dialogue, actor, &.{ try e.p(f, 1), try e.p(f, 3), try e.ref(hypothesis) }), park);
    const Case = std.meta.Child(@FieldType(@FieldType(source.ast.Term, "match_sum"), "cases"));
    var cases: [std.meta.fields(t.Answer).len]Case = undefined;
    inline for (std.meta.fields(t.Answer), 0..) |field, i| {
        cases[i] = if (i == 0) .{ .variable = hypothesis, .body = started } else .{
            .variable = try b.variable(try e.schema(field.type)),
            .body = try b.term(.{ .fail = try e.value(void, {}) }),
        };
    }
    const branch = try b.term(.{ .match_sum = .{ .value = try e.ref(pop.head), .cases = &cases } });
    try b.define(f, try pop.match(e, try e.p(f, 0), try b.pure(try e.p(f, 2)), branch));
    return f;
}

test "repair inquiry is admitted as ordinary protected Agent source" {
    var diagnostic: boundary.program.Diagnostic = .{};
    var compiled = agent.compileObserved(std.testing.allocator, System, .{ .boundary_options = .{ .diagnostic = &diagnostic } }) catch |err| {
        std.debug.print("{any}\n", .{diagnostic});
        return err;
    };
    defer compiled.deinit();
}

test "ReAct comparator is admitted through the same protected application surface" {
    var compiled = try agent.compile(std.testing.allocator, ReactSystem);
    defer compiled.deinit();
}

test "model-only speculation rejects the application's hidden experiment path" {
    const Bad = struct {
        pub fn emit(c: agent.Context) !source.Module {
            const b = c.builder;
            const module = try Application.emit(c);
            var experiment: ?Id = null;
            for (b.effects.items, 0..) |effect, i|
                if (std.mem.eql(u8, effect.identity, "inquiry.repair.experiment.v1")) {
                    experiment = i;
                };
            const id = experiment orelse return error.MissingExperiment;
            const effect = b.effects.items[id];
            const writer = try b.declare(&.{effect.payload}, effect.result, &.{id}, &.{});
            const performed = try b.term(.{ .perform = .{ .effect = id, .payload = try b.reference(b.parameter(writer, 0)) } });
            try c.registry.protectSite(writer, performed, id);
            try b.define(writer, performed);
            // A falsely empty wrapper row must not hide the actual callee.
            const wrapper = try b.declare(&.{effect.payload}, effect.result, &.{}, &.{});
            try b.define(wrapper, try b.term(.{ .call = .{ .function = writer, .arguments = &.{try b.reference(b.parameter(wrapper, 0))} } }));
            try c.registry.speculate(wrapper, &.{try t.P.declare(b)});
            return b.module(module.entry, module.failure);
        }
    };
    const BadSystem = agent.system(.{ .InitialArgs = t.Task, .Result = t.Result, .Failure = void, .application = Bad });
    try std.testing.expectError(error.SpeculativeEffect, agent.compile(std.testing.allocator, BadSystem));
}

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse "image";
    if (args.next() != null) return error.InvalidArgument;
    if (std.mem.eql(u8, mode, "task-schema")) return writeSchema(init, t.Task);
    if (std.mem.eql(u8, mode, "outcome-schema")) return writeSchema(init, t.Result);
    if (std.mem.eql(u8, mode, "repeat")) return writeImage(init, @import("repeated.zig").System);
    if (std.mem.eql(u8, mode, "react")) return writeImage(init, ReactSystem);
    if (!std.mem.eql(u8, mode, "image")) return error.InvalidArgument;
    return writeImage(init, System);
}

fn writeImage(init: std.process.Init, comptime App: type) !void {
    var diagnostic: boundary.program.Diagnostic = .{};
    var compiled = agent.compileObserved(init.gpa, App, .{ .boundary_options = .{ .diagnostic = &diagnostic } }) catch |err| {
        std.debug.print("{any}\n", .{diagnostic});
        return err;
    };
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    _ = try compiled.encode(init.gpa, bytes);
    return writeBytes(init, bytes);
}

fn writeSchema(init: std.process.Init, comptime T: type) !void {
    var builder = source.Builder.init(init.gpa);
    defer builder.deinit();
    const root = try agent.contracts.schema(T, &builder);
    const bytes = try boundary.data.schema.encodeOwned(init.gpa, builder.schemas.items, root);
    defer init.gpa.free(bytes);
    try writeBytes(init, bytes);
}

fn writeBytes(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}
