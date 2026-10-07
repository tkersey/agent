//! All example control, retained values, yielding and cleanup are authored here.
const agent = @import("agent");
const boundary = @import("boundary");
const t = @import("application_types");
pub const capabilities = .{
    .{ .identity = t.increment_identity, .resource_role = "local" },
    .{ .identity = t.question_identity, .resource_role = "user" },
    .{ .identity = t.cleanup_identity, .resource_role = "local" },
};
pub const resources = .{
    .{ .id = "native-minimal.instructions", .version = "1", .media_type = "text/plain", .bytes = @embedFile("instructions.txt") },
};
pub const System = agent.system(.{ .InitialArgs = t.Input, .Result = t.Output, .Failure = void, .application = Application });

const Application = struct {
    pub fn emit(c: agent.Context) !boundary.source.Module {
        const b = c.builder;
        const unit = try c.schema(void);
        const number = try c.schema(u32);
        const input = try c.schema(t.Input);
        const output = try c.schema(t.Output);
        const answer = try c.schema(t.Answer);
        const increment_result = try c.schema(t.IncrementResult);
        const increment = try c.external(t.increment_identity, number, increment_result, .read);
        const question = try c.external(t.question_identity, try c.schema(t.Question), answer, .read);
        const cleanup = try c.external(t.cleanup_identity, unit, unit, .read);
        const child = try b.declare(&.{number}, number, &.{increment}, &.{});
        const acquired = try b.variable(increment_result);
        const checked_increment = try b.value(.{ .schema = number, .expression = .{ .primitive = .{
            .opcode = .variant_payload,
            .operands = &.{try b.reference(acquired)},
            .immediate = 1,
            .failures = &.{.{ .kind = .invalid_variant, .value = try b.failureLiteral(try b.constant(void, {})) }},
        } } });
        try b.define(child, try b.bind(acquired, try b.term(.{ .perform = .{ .effect = increment, .payload = try b.reference(b.parameter(child, 0)) } }), try b.pure(checked_increment)));
        const entry = try b.declare(&.{input}, output, &.{ increment, question, cleanup }, &.{});
        const body = try b.declare(&.{}, output, &.{ increment, question }, &.{});
        const retained = try b.primitive(number, .field, &.{try b.reference(b.parameter(entry, 0))}, 0);
        const incremented = try b.variable(number);
        const response = try b.variable(answer);
        const sum = try b.value(.{ .schema = number, .expression = .{ .primitive = .{
            .opcode = .integer_add,
            .operands = &.{ retained, try b.reference(incremented) },
            .failures = &.{.{ .kind = .arithmetic_overflow, .value = try b.failureLiteral(try b.constant(void, {})) }},
        } } });
        const result = try b.primitive(output, .product, &.{ sum, try b.primitive(try c.schema(@FieldType(t.Answer, "message")), .field, &.{try b.reference(response)}, 0) }, 0);
        const ask = try b.term(.{ .perform = .{ .effect = question, .payload = try c.literal(t.Question, .{ .prompt = .{ .bytes = "What label should accompany the retained result?" } }) } });
        const call = try b.term(.{ .call = .{ .function = child, .arguments = &.{retained} } });
        try b.define(body, try b.bind(incremented, call, try b.term(.{ .yield_then = try b.bind(response, ask, try b.pure(result)) })));
        const exit_info = try boundary.library.cleanup.exitInfo(b, unit);
        const release = try b.declare(&.{exit_info}, unit, &.{cleanup}, &.{});
        try b.define(release, try b.term(.{ .perform = .{ .effect = cleanup, .payload = try b.constant(void, {}) } }));
        const body_type = try b.schema(.{ .internal = .{ .computation = .{
            .parameters = &.{},
            .result = output,
            .effects = &.{ increment, question },
            .capture_bound = &.{input},
        } } });
        const cleanup_type = try b.schema(.{ .internal = .{ .computation = .{
            .parameters = &.{exit_info},
            .result = unit,
            .effects = &.{cleanup},
        } } });
        try b.define(entry, try b.term(.{ .protect = .{ .body = try b.lambda(body, body_type), .cleanup = try b.lambda(release, cleanup_type) } }));
        return b.module(entry, unit);
    }
};
