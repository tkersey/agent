//! Application consumer for internal alternatives and private mutable state.
const std = @import("std");
const boundary = @import("boundary");
const deliberation = @import("deliberation");
const source = boundary.computation;
const Id = source.Id;

pub fn main(init: std.process.Init) !void {
    var arguments = std.process.Args.Iterator.init(init.minimal.args);
    defer arguments.deinit();
    _ = arguments.skip();
    const mode = arguments.next() orelse "multi";
    if (std.mem.eql(u8, mode, "inspect-state")) {
        const path = arguments.next() orelse return error.ExpectedStatePath;
        if (arguments.next() != null) return error.UnexpectedArgument;
        return inspectState(init, path);
    }
    if (arguments.next() != null) return error.UnexpectedArgument;
    var b = source.Builder.init(init.gpa);
    defer b.deinit();
    var diagnostic: boundary.program.Diagnostic = .{};
    const module = try selectedModule(&b, mode);
    var compiled = boundary.program.compileObserved(
        init.gpa,
        module,
        .{ .diagnostic = &diagnostic },
    ) catch |err| {
        std.debug.print("{any}\n", .{diagnostic});
        return err;
    };
    defer compiled.deinit();
    const buffer = try init.gpa.alloc(u8, try boundary.image_v2.encodedLength(compiled.program));
    defer init.gpa.free(buffer);
    const bytes = try compiled.encode(init.gpa, buffer);
    var output_buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(bytes);
    try output.interface.flush();
}

fn selectedModule(b: *source.Builder, mode: []const u8) !source.Module {
    if (std.mem.eql(u8, mode, "multi")) return build(b);
    if (std.mem.eql(u8, mode, "cleanup")) return cleanupProbe(b);
    if (std.mem.eql(u8, mode, "dispose")) return disposalProbe(b);
    return error.UnexpectedArgument;
}

fn inspectState(init: std.process.Init, path: []const u8) !void {
    const bytes = try std.Io.Dir.cwd().readFileAlloc(
        init.io,
        path,
        init.gpa,
        .limited(16 * 1024 * 1024),
    );
    defer init.gpa.free(bytes);
    var graph = try boundary.snapshot_v2.decodeGraph(init.gpa, bytes);
    defer graph.deinit();
    var multi: usize = 0;
    var cells: usize = 0;
    var packages: usize = 0;
    var obligations: usize = 0;
    for (graph.state.nodes) |node| switch (node) {
        .multi_template => multi += 1,
        .cell => cells += 1,
        .package => packages += 1,
        .obligation => obligations += 1,
        else => {},
    };
    var buffer: [512]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    try output.interface.print(
        "{{\"multiTemplates\":{d},\"cells\":{d}," ++
            "\"packages\":{d},\"obligations\":{d},\"nodes\":{d},\"blobs\":{d}}}\n",
        .{ multi, cells, packages, obligations, graph.state.nodes.len, graph.state.blobs.len },
    );
    try output.interface.flush();
}

pub fn build(b: *source.Builder) !source.Module {
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const alternatives = try b.schema(.{ .seq = integer });
    const assessment = try b.schema(.{ .product = &.{ integer, integer, integer } });
    const payload = try b.schema(.{ .product = &.{ integer, integer } });
    const model = try b.effect(.{
        .identity = "agent4.probe.assess",
        .payload = payload,
        .result = integer,
    });
    const region = b.region();
    const region_schema = try b.schema(.{ .internal = .{ .region = region } });
    const cell = try b.schema(.{ .internal = .{ .cell = .{
        .element = integer,
        .region = region,
    } } });
    const d = try deliberation.define(b, "agent4.probe.alternatives", integer, assessment, .{
        .captures = &.{ unit, integer, alternatives, cell },
        .owned_regions = &.{region},
        .residual = .{ .effects = &.{model} },
    });
    const entry = try b.declare(&.{alternatives}, d.answer, &.{model}, &.{});
    const body = try b.declare(&.{d.capability}, assessment, &.{ model, d.effect }, &.{});
    const private = try b.declare(&.{region_schema}, assessment, &.{ model, d.effect }, &.{region});
    const offered = try b.reference(b.parameter(entry, 0));
    const cap = try b.reference(b.parameter(body, 0));
    const allocated = try b.variable(cell);
    const new_cell = try b.primitive(cell, .cell_new, &.{
        try b.reference(b.parameter(private, 0)), try b.constant(u64, 10),
    }, 0);
    const branch = try branchBody(
        b,
        d,
        model,
        payload,
        assessment,
        integer,
        unit,
        cap,
        offered,
        try b.reference(allocated),
    );
    try b.define(private, try b.bind(allocated, try b.pure(new_cell), branch));
    const private_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{region_schema},
        .result = assessment,
        .effects = &.{ model, d.effect },
        .capture_bound = &.{ alternatives, d.capability },
        .regions = &.{region},
    } } });
    try b.define(body, try b.term(.{ .with_region = .{
        .region = region,
        .body = try b.lambda(private, private_type),
    } }));
    const body_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{d.capability},
        .result = assessment,
        .effects = &.{ model, d.effect },
        .capture_bound = &.{alternatives},
    } } });
    try b.define(entry, try deliberation.evaluate(b, d, try b.lambda(body, body_type), &.{}));
    return b.module(entry, unit);
}

fn branchBody(
    b: *source.Builder,
    d: deliberation.Deliberation,
    model: Id,
    payload: Id,
    assessment: Id,
    integer: Id,
    unit: Id,
    capability: Id,
    alternatives: Id,
    cell: Id,
) !Id {
    const candidate = try b.variable(integer);
    const before = try b.variable(integer);
    const stored = try b.variable(unit);
    const normalized = try b.variable(integer);
    const after = try b.primitive(integer, .cell_get, &.{cell}, 0);
    const result = try b.primitive(assessment, .product, &.{
        try b.reference(before), after, try b.reference(normalized),
    }, 0);
    const outgoing = try b.primitive(payload, .product, &.{
        try b.reference(candidate), try b.reference(before),
    }, 0);
    const request = try b.term(.{ .perform = .{ .effect = model, .payload = outgoing } });
    const write = try b.primitive(unit, .cell_set, &.{ cell, try b.reference(candidate) }, 0);
    const read = try b.primitive(integer, .cell_get, &.{cell}, 0);
    const observed = try b.bind(normalized, request, try b.pure(result));
    const written = try b.bind(stored, try b.pure(write), observed);
    const read_before = try b.bind(before, try b.pure(read), written);
    const chosen = try deliberation.choose(b, d, capability, alternatives);
    return b.bind(candidate, chosen, read_before);
}

pub fn cleanupProbe(b: *source.Builder) !source.Module {
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const info = try boundary.library.cleanup.exitInfo(b, unit);
    const question = try b.effect(.{
        .identity = "agent4.probe.cleanup-question",
        .payload = integer,
        .result = integer,
    });
    const release = try b.effect(.{
        .identity = "agent4.probe.release",
        .payload = info,
        .result = unit,
    });
    const entry = try b.declare(&.{}, integer, &.{ question, release }, &.{});
    const body = try b.declare(&.{}, integer, &.{question}, &.{});
    try b.define(body, try b.term(.{ .perform = .{
        .effect = question,
        .payload = try b.constant(u64, 7),
    } }));
    const finalizer = try b.declare(&.{info}, unit, &.{release}, &.{});
    try b.define(finalizer, try b.term(.{ .perform = .{
        .effect = release,
        .payload = try b.reference(b.parameter(finalizer, 0)),
    } }));
    const body_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{},
        .result = integer,
        .effects = &.{question},
    } } });
    const cleanup_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{info},
        .result = unit,
        .effects = &.{release},
    } } });
    try b.define(entry, try b.term(.{ .protect = .{
        .body = try b.lambda(body, body_type),
        .cleanup = try b.lambda(finalizer, cleanup_type),
    } }));
    return b.module(entry, unit);
}

pub fn disposalProbe(b: *source.Builder) !source.Module {
    const unit = try b.scalar(void);
    const integer = try b.scalar(u64);
    const release = try b.effect(.{
        .identity = "agent4.probe.disposal-release",
        .payload = integer,
        .result = unit,
    });
    const parent = try b.effect(.{
        .identity = "agent4.probe.disposal-parent",
        .payload = integer,
        .result = unit,
    });
    const gen = boundary.library.generator;
    const g = try gen.define(
        b,
        "agent4.probe.disposal-yield",
        integer,
        &.{ unit, integer },
        &.{},
        .{ .effects = &.{release} },
    );
    const body = try disposalBody(b, g, unit, integer, release);
    const body_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{g.capability},
        .result = unit,
        .effects = &.{ release, g.effect },
    } } });
    const entry = try b.declare(&.{}, integer, &.{ release, parent }, &.{});
    const answer = try b.variable(g.answer);
    const completed = try b.variable(unit);
    const yielded = try b.variable(g.yielded);
    const offered = try b.variable(integer);
    const package = try b.variable(g.package);
    const parent_reply = try b.variable(unit);
    const disposed = try b.variable(unit);
    const done = try b.pure(try b.reference(offered));
    const close = try b.bind(disposed, try gen.close(b, g, try b.reference(package)), done);
    const wait = try b.term(.{ .perform = .{
        .effect = parent,
        .payload = try b.reference(offered),
    } });
    const unpack = try b.term(.{ .unpack_product = .{
        .value = try b.reference(yielded),
        .variables = &.{ offered, package },
        .body = try b.bind(parent_reply, wait, close),
    } });
    const matching = try b.term(.{ .match_sum = .{
        .value = try b.reference(answer),
        .cases = &.{
            .{ .variable = completed, .body = try b.term(.{ .fail = try b.constant(void, {}) }) },
            .{ .variable = yielded, .body = unpack },
        },
    } });
    const installed = try b.term(.{ .handle = .{
        .handler = g.handler,
        .body = try b.lambda(body, body_type),
    } });
    try b.define(entry, try b.bind(answer, installed, matching));
    return b.module(entry, unit);
}

fn disposalBody(
    b: *source.Builder,
    g: boundary.library.generator.Generator,
    unit: Id,
    integer: Id,
    release: Id,
) !Id {
    _ = integer;
    const start = try b.declare(&.{g.capability}, unit, &.{ release, g.effect }, &.{});
    const body = try b.declare(&.{}, unit, &.{g.effect}, &.{});
    try b.define(body, try b.term(.{ .perform = .{
        .effect = g.effect,
        .capability = try b.reference(b.parameter(start, 0)),
        .payload = try b.constant(u64, 42),
    } }));
    const info = try boundary.library.cleanup.exitInfo(b, unit);
    const finalizer = try b.declare(&.{info}, unit, &.{release}, &.{});
    try b.define(finalizer, try b.term(.{ .perform = .{
        .effect = release,
        .payload = try b.constant(u64, 99),
    } }));
    const body_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{},
        .result = unit,
        .effects = &.{g.effect},
        .capture_bound = &.{g.capability},
    } } });
    const cleanup_type = try b.schema(.{ .internal = .{ .computation = .{
        .parameters = &.{info},
        .result = unit,
        .effects = &.{release},
    } } });
    try b.define(start, try b.term(.{ .protect = .{
        .body = try b.lambda(body, body_type),
        .cleanup = try b.lambda(finalizer, cleanup_type),
    } }));
    return start;
}
