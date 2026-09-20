//! Application values and environmental leaves for incremental-parser synthesis.
//! These are ordinary data. No proposal, completeness flag or assessment grants
//! approval, completion-continuation access, or target-write authority.
const contracts = @import("agent_contracts");
const Context = @import("authoring.zig").Context;
const Id = @import("boundary").computation.Id;
pub const proposals = @import("parser_proposals.zig");
pub const contract = "agent.incremental-byte-parser/v1";
pub const reference_identity = "agent.parser.reference.v1";
pub const execution_identity = "agent.parser.execution.v1";
pub const Digest = contracts.Text(64);
pub const Code = contracts.Text(8192);
pub const Subject = struct {
    base: Digest,
    reference: Digest,
    requirements: Digest,
    runner: Digest,
    acceptance: contracts.Text(64),
};
pub const Completeness = enum(u32) { partial = 0, complete = 1 };
pub const Candidate = struct { source: Code, version: u64, completeness: Completeness };
pub const Call = struct { chunk: contracts.Vector(u8, 4096), end_of_input: bool };
pub const Trace = contracts.Vector(Call, 64);
pub const Status = enum(u32) { open = 0, complete = 1, failed = 2 };
pub const ErrorCode = enum(u32) { invalid_escape = 0, dangling_escape = 1, unterminated_record = 2 };
pub const ParseError = struct { code: ErrorCode, offset: u64 };
pub const Field = contracts.Vector(u8, 65536);
pub const Record = contracts.Vector(Field, 256);
pub const Observation = struct {
    records: contracts.Vector(Record, 256),
    status: Status,
    failure: ?ParseError,
};
pub const Observations = contracts.Vector(Observation, 64);
pub const Unavailable = enum(u32) { unsupported = 0, invalid = 1, timeout = 2, cancelled = 3, failed = 4, capacity = 5 };
pub const Assessment = struct {
    passed: bool,
    executed: u32,
    required: u32,
    retention_passed: bool,
    first_failure: contracts.Text(256),
};
pub const Probe = struct { observations: Observations, passed: bool, maximum_state_bytes: u64 };
pub const ReferenceRequest = struct { subject: Subject, occurrence: u64, trace: Trace };
pub const ReferenceReply = struct {
    occurrence: u64,
    outcome: union(enum(u32)) { observed: Observations = 0, unavailable: Unavailable = 1 },
};
pub const ExecutionRequest = struct {
    subject: Subject,
    occurrence: u64,
    candidate: Candidate,
    check: union(enum(u32)) { probe: Trace = 0, acceptance: void = 1, proposed_probe: proposals.Experiment = 2 },
};
pub const ExecutionReply = struct {
    occurrence: u64,
    candidate_version: u64,
    outcome: union(enum(u32)) { probe: Probe = 0, assessment: Assessment = 1, unavailable: Unavailable = 2 },
};
pub const Tools = struct { reference: Id, execution: Id };
pub fn declareTools(c: Context) !Tools {
    return .{
        .reference = try c.external(reference_identity, try c.schema(ReferenceRequest), try c.schema(ReferenceReply), .read),
        .execution = try c.external(execution_identity, try c.schema(ExecutionRequest), try c.schema(ExecutionReply), .simulation),
    };
}

/// Reject semantic replies for another occurrence, candidate version or check.
/// The ordinary World request envelope separately binds the complete payload.
pub fn execute(c: Context, tools: Tools, request: Id, failure: Id) !Id {
    const b = c.builder;
    const cache = try b.specialization(Id, "agent.parser.execution-binding/v1", .{ tools.execution, failure });
    const function = if (cache.cached) |value| value else blk: {
        const request_type = try c.schema(ExecutionRequest);
        const reply_type = try c.schema(ExecutionReply);
        const function = try b.declare(&.{request_type}, reply_type, &.{tools.execution}, &.{});
        const input = try b.reference(b.parameter(function, 0));
        const reply = try b.variable(reply_type);
        const received = try b.reference(reply);
        const integer = try b.scalar(u64);
        const candidate = try b.primitive(try c.schema(Candidate), .field, &.{input}, 2);
        const check = try b.primitive(try c.schema(@FieldType(ExecutionRequest, "check")), .field, &.{input}, 3);
        const outcome = try b.primitive(try c.schema(@FieldType(ExecutionReply, "outcome")), .field, &.{received}, 2);
        const check_tag = try b.primitive(integer, .variant_tag, &.{check}, 0);
        const proposed = try equal(c, check_tag, try b.constant(u64, 2));
        const expected_tag = try b.primitive(integer, .select, &.{ proposed, try b.constant(u64, 0), check_tag }, 0);
        const outcome_tag = try b.primitive(integer, .variant_tag, &.{outcome}, 0);
        var accepted = try b.pure(received);
        const complete = try b.primitive(try c.schema(Completeness), .field, &.{candidate}, 2);
        const complete_tag = try b.primitive(try b.scalar(u32), .enum_tag, &.{complete}, 0);
        const valid_complete = try equal(c, complete_tag, try b.constant(u32, @intFromEnum(Completeness.complete)));
        const is_assessment = try equal(c, outcome_tag, try b.constant(u64, 1));
        accepted = try b.term(.{ .conditional = .{ .condition = is_assessment, .when_true = try ensure(c, valid_complete, accepted, failure), .when_false = accepted } });
        const unavailable = try equal(c, outcome_tag, try b.constant(u64, 2));
        accepted = try b.term(.{ .conditional = .{ .condition = unavailable, .when_true = try b.pure(received), .when_false = try ensure(c, try equal(c, expected_tag, outcome_tag), accepted, failure) } });
        accepted = try ensure(c, try equal(c, try b.primitive(integer, .field, &.{candidate}, 1), try b.primitive(integer, .field, &.{received}, 1)), accepted, failure);
        accepted = try ensure(c, try equal(c, try b.primitive(integer, .field, &.{input}, 1), try b.primitive(integer, .field, &.{received}, 0)), accepted, failure);
        try b.define(function, try b.bind(reply, try b.term(.{ .perform = .{
            .effect = tools.execution,
            .payload = input,
        } }), accepted));
        break :blk try cache.finish(b, function);
    };
    return b.term(.{ .call = .{ .function = function, .arguments = &.{request} } });
}
fn equal(c: Context, left: Id, right: Id) !Id {
    return c.builder.primitive(try c.builder.scalar(bool), .equal, &.{ left, right }, 0);
}
fn ensure(c: Context, condition: Id, next: Id, failure: Id) !Id {
    return c.builder.term(.{ .conditional = .{ .condition = condition, .when_true = next, .when_false = try c.builder.term(.{ .fail = failure }) } });
}
