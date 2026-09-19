//! A separately compiled, bounded byte/LF fold with owned effectful retirement.
const std = @import("std");
const boundary = @import("boundary");
const source = boundary.source;
const data = boundary.data;
const contracts = @import("agent_contracts");
const Id = source.Id;
pub const chunk_bytes = 16;
pub const maximum_subject_bytes = 65536;
pub const Subject = struct { name: contracts.Text(64), version: [32]u8, length: u64 };
pub const Read = struct { subject: Subject, offset: u64, maximum: u64 };
pub const Chunk = struct { version: [32]u8, offset: u64, bytes: contracts.Bytes(chunk_bytes), eof: bool };
pub const Reply = union(enum) { chunk: Chunk, unavailable, changed, cancelled };
pub const Stats = struct { bytes: u64, newlines: u64 };
pub const Result = union(enum) { ok: Stats, unavailable, changed, cancelled, invalid_reply };
pub const read_identity = "agent.text.read-chunk.v1";
pub const close_identity = "agent.text.close.v1";
pub const name = "inspect_text";
pub const description = "Count bytes and LF newlines in a declared immutable text subject";

const Emit = struct {
    b: *source.Builder,
    unit: Id,
    integer: Id,
    boolean: Id,
    failure: Id,
    fn schema(e: Emit, comptime T: type) !Id {
        return contracts.schema(T, e.b);
    }
    fn ref(e: Emit, variable: Id) !Id {
        return e.b.reference(variable);
    }
    fn p(e: Emit, function: Id, parameter: usize) !Id {
        return e.ref(e.b.parameter(function, parameter));
    }
    fn field(e: Emit, comptime T: type, value: Id, index: Id) !Id {
        return e.b.primitive(try e.schema(T), .field, &.{value}, index);
    }
    fn integerValue(e: Emit, n: u64) !Id {
        return e.b.constant(u64, n);
    }
    fn add(e: Emit, left: Id, right: Id) !Id {
        return e.b.value(.{ .schema = e.integer, .expression = .{ .primitive = .{
            .opcode = .integer_add,
            .operands = &.{ left, right },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try e.b.failureLiteral(e.failure) }},
        } } });
    }
    fn eq(e: Emit, left: Id, right: Id) !Id {
        return e.b.primitive(e.boolean, .equal, &.{ left, right }, 0);
    }
    fn less(e: Emit, left: Id, right: Id) !Id {
        return e.b.primitive(e.boolean, .less, &.{ left, right }, 0);
    }
    fn call(e: Emit, function: Id, args: []const Id) !Id {
        return e.b.term(.{ .call = .{ .function = function, .arguments = args } });
    }
    fn branch(e: Emit, condition: Id, yes: Id, no: Id) !Id {
        return e.b.term(.{ .conditional = .{ .condition = condition, .when_true = yes, .when_false = no } });
    }
    fn rejected(e: Emit, tag: Id) !Id {
        return e.b.pure(try e.b.primitive(try e.schema(Result), .variant, &.{try e.b.constant(void, {})}, tag));
    }
};

fn counter(e: Emit) !Id {
    const bytes = try e.schema(contracts.Bytes(chunk_bytes));
    const function = try e.b.declare(&.{ bytes, e.integer, e.integer }, e.integer, &.{}, &.{});
    const value = try e.p(function, 0);
    const index = try e.p(function, 1);
    const count = try e.p(function, 2);
    const length = try e.b.primitive(e.integer, .blob_length, &.{value}, 0);
    const byte_schema = try e.schema(u8);
    const byte = try e.b.variable(byte_schema);
    const optional = try e.b.schema(.{ .sum = &.{ e.unit, byte_schema } });
    const next = try e.add(index, try e.integerValue(1));
    const yes = try e.call(function, &.{ value, next, try e.add(count, try e.integerValue(1)) });
    const no = try e.call(function, &.{ value, next, count });
    const selected = try e.b.term(.{ .match_sum = .{
        .value = try e.b.primitive(optional, .blob_byte, &.{ value, index }, 0),
        .cases = &.{
            .{ .variable = try e.b.variable(e.unit), .body = try e.b.term(.{ .fail = e.failure }) },
            .{ .variable = byte, .body = try e.branch(try e.eq(try e.ref(byte), try e.b.constant(u8, 10)), yes, no) },
        },
    } });
    try e.b.define(function, try e.branch(try e.less(index, length), selected, try e.b.pure(count)));
    return function;
}

fn fold(e: Emit, read: Id) !Id {
    const subject_schema = try e.schema(Subject);
    const result_schema = try e.schema(Result);
    const function = try e.b.declare(&.{ subject_schema, e.integer, e.integer }, result_schema, &.{read}, &.{});
    const subject = try e.p(function, 0);
    const offset = try e.p(function, 1);
    const lines = try e.p(function, 2);
    const request = try e.b.primitive(try e.schema(Read), .product, &.{ subject, offset, try e.integerValue(chunk_bytes) }, 0);
    const response = try e.b.variable(try e.schema(Reply));
    const chunk = try e.b.variable(try e.schema(Chunk));
    const value = try e.ref(chunk);
    const content = try e.field(contracts.Bytes(chunk_bytes), value, 2);
    const size = try e.b.primitive(e.integer, .blob_length, &.{content}, 0);
    const next = try e.add(offset, size);
    const eof = try e.field(bool, value, 3);
    const total = try e.field(u64, subject, 2);
    const same_version = try e.b.variable(e.boolean);
    const counted = try e.b.variable(e.integer);
    const stats = try e.b.primitive(try e.schema(Stats), .product, &.{ next, try e.ref(counted) }, 0);
    const done = try e.b.pure(try e.b.primitive(result_schema, .variant, &.{stats}, 0));
    const more = try e.call(function, &.{ subject, next, try e.ref(counted) });
    var valid = try e.b.bind(counted, try e.call(try counter(e), &.{ content, try e.integerValue(0), lines }), try e.branch(eof, done, more));
    const invalid = try e.rejected(4);
    valid = try e.branch(try e.eq(eof, try e.eq(next, total)), valid, invalid);
    valid = try e.branch(try e.less(total, next), invalid, valid);
    valid = try e.branch(try e.eq(size, try e.integerValue(0)), try e.branch(eof, valid, invalid), valid);
    valid = try e.branch(try e.eq(try e.field(u64, value, 1), offset), valid, invalid);
    valid = try e.branch(try e.ref(same_version), valid, invalid);
    const equality = try @import("value_equality.zig").define(e.b, try e.schema([32]u8), e.failure);
    valid = try e.b.bind(same_version, try e.call(equality, &.{ try e.field([32]u8, value, 0), try e.field([32]u8, subject, 1) }), valid);
    const matched = try e.b.term(.{ .match_sum = .{ .value = try e.ref(response), .cases = &.{
        .{ .variable = chunk, .body = valid },
        .{ .variable = try e.b.variable(e.unit), .body = try e.rejected(1) },
        .{ .variable = try e.b.variable(e.unit), .body = try e.rejected(2) },
        .{ .variable = try e.b.variable(e.unit), .body = try e.rejected(3) },
    } } });
    try e.b.define(function, try e.b.bind(response, try e.b.term(.{ .perform = .{ .effect = read, .payload = request } }), matched));
    return function;
}

pub fn emit(allocator: std.mem.Allocator) ![]u8 {
    var b = source.Builder.init(allocator);
    defer b.deinit();
    const e: Emit = .{ .b = &b, .unit = try b.scalar(void), .integer = try b.scalar(u64), .boolean = try b.scalar(bool), .failure = try b.constant(void, {}) };
    const subject_schema = try e.schema(Subject);
    const result_schema = try e.schema(Result);
    const read = try b.effect(.{ .identity = read_identity, .payload = try e.schema(Read), .result = try e.schema(Reply) });
    const close = try b.effect(.{ .identity = close_identity, .payload = subject_schema, .result = e.unit });
    const loop = try fold(e, read);
    const captures = try b.allocator().alloc(Id, b.schemas.items.len);
    for (captures, 0..) |*id, i| id.* = i;
    const generator = try boundary.library.generator.define(&b, "agent.text.result.v1", result_schema, captures, &.{}, .{ .effects = &.{ read, close } });
    const main = try b.declare(&.{subject_schema}, result_schema, &.{ read, close }, &.{});
    const subject = try e.p(main, 0);
    const start = try b.declare(&.{generator.capability}, e.unit, &.{ read, close, generator.effect }, &.{});
    const body = try b.declare(&.{}, e.unit, &.{ read, generator.effect }, &.{});
    const result = try b.variable(result_schema);
    const yielded = try b.term(.{ .perform = .{ .effect = generator.effect, .capability = try e.p(start, 0), .payload = try e.ref(result) } });
    try b.define(body, try b.bind(result, try e.call(loop, &.{ subject, try e.integerValue(0), try e.integerValue(0) }), try b.bind(try b.variable(e.unit), yielded, try b.pure(try b.constant(void, {})))));
    const exit = try boundary.library.cleanup.exitInfo(&b, e.unit);
    const cleanup = try b.declare(&.{exit}, e.unit, &.{close}, &.{});
    try b.define(cleanup, try b.term(.{ .perform = .{ .effect = close, .payload = subject } }));
    const body_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{}, .result = e.unit, .effects = &.{ read, generator.effect }, .capture_bound = &.{ subject_schema, generator.capability } } } });
    const cleanup_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{exit}, .result = e.unit, .effects = &.{close}, .capture_bound = &.{subject_schema} } } });
    try b.define(start, try b.term(.{ .protect = .{ .body = try b.lambda(body, body_type), .cleanup = try b.lambda(cleanup, cleanup_type) } }));
    const start_type = try b.schema(.{ .internal = .{ .computation = .{ .parameters = &.{generator.capability}, .result = e.unit, .effects = &.{ read, close, generator.effect }, .capture_bound = &.{subject_schema} } } });
    const answer = try b.variable(generator.answer);
    const yielded_value = try b.variable(generator.yielded);
    const returned = try b.variable(result_schema);
    const package = try b.variable(generator.package);
    const dispose = try b.bind(try b.variable(e.unit), try boundary.library.generator.close(&b, generator, try e.ref(package)), try b.pure(try e.ref(returned)));
    const unpack = try b.term(.{ .unpack_product = .{ .value = try e.ref(yielded_value), .variables = &.{ returned, package }, .body = dispose } });
    const matched = try b.term(.{ .match_sum = .{ .value = try e.ref(answer), .cases = &.{
        .{ .variable = try b.variable(e.unit), .body = try e.rejected(4) },
        .{ .variable = yielded_value, .body = unpack },
    } } });
    const handled = try b.bind(answer, try b.term(.{ .handle = .{ .handler = generator.handler, .body = try b.lambda(start, start_type) } }), matched);
    try b.define(main, try e.branch(try e.less(try e.integerValue(maximum_subject_bytes), try e.field(u64, subject, 2)), try e.rejected(4), handled));
    var compiled = try source.component.compile(allocator, b.module(main, e.unit), .{
        .imports = &.{ .{ .name = "read", .reference = .{ .kind = .effect, .id = read } }, .{ .name = "close", .reference = .{ .kind = .effect, .id = close } } },
        .exports = &.{.{ .name = "inspect", .reference = .{ .kind = .function, .id = main } }},
    });
    defer compiled.deinit();
    const bytes = try allocator.alloc(u8, try data.component.encodedLength(compiled.object));
    errdefer allocator.free(bytes);
    _ = try compiled.encode(allocator, bytes);
    return bytes;
}
