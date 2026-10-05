//! Shared authored approval composition. The fixture entry below drives this
//! same construction; no public grant or environmental approval flag exists.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const Id = boundary.source.Id;
const Text = agent.contracts.Text;
pub const Proposal = Text(2 * 1024 * 1024);
pub const Receipt = Text(16384);
pub const Reason = Text(128);
pub const Delivery = union(enum) { published: Receipt, conflict: Receipt, not_applied: Receipt, uncertain: Reason };
pub const CheckStatus = enum { Passed, Failed, Unavailable, TimedOut, Cancelled, InvalidOutput, Incomplete };
pub const CheckResult = struct { status: CheckStatus, record: Proposal };
pub const ReviewReason = union(enum) { decline: Text(4096), question: Text(4096), amend: Text(4096) };
pub const Result = union(enum) { delivered: Delivery, declined: ReviewReason, invalid, denied };
pub const Outcome = union(enum) { approval: Result, check_failed: CheckResult };
pub const Task = struct { principal: u64, candidate: Proposal, human: agent.mobility.EnsureInput, placement: agent.mobility.EnsureInput };
pub const Preparation = struct { candidate: Proposal, validation: Proposal, task_id: u64, generation: u64 };
pub const Challenge = struct { occurrence: Text(128), proposal: Proposal };
pub const Decision = union(enum) { approve, reject: ReviewReason, amend: Proposal };
pub const Answer = struct { challenge: Challenge, principal: u64, decision: Decision };
pub const HumanInput = struct { channel: agent.contracts.Utf8, purpose: agent.contracts.Utf8, presentation: void, outgoing: Challenge };
pub const HumanReply = union(enum) { response: Answer };

pub fn define(c: agent.Context, principal: Id, placement_input: Id) !agent.approval.Definition {
    return defineRetained(c, principal, placement_input, try c.builder.constant(void, {}), null);
}
pub const MovementState = struct { cell: Id, region: Id };
/// The caller owns this portable region. The approval owner retains its private
/// grant while placement updates the same remaining allowance used on return.
pub fn defineRetained(c: agent.Context, principal: Id, placement_input: Id, failure: Id, movement_state: ?MovementState) !agent.approval.Definition {
    const b = c.builder;
    const proposal = try c.schema(Proposal);
    const boolean = try b.scalar(bool);
    const commit = try c.external("agent.repository.publish.v1", proposal, try c.schema(Delivery), .commit);
    const current = try c.external("agent.repository.publication-current.v1", proposal, boolean, .read);
    const authority = try b.declare(&.{ proposal, try b.scalar(u64) }, boolean, &.{}, &.{});
    try b.define(authority, try b.pure(try b.primitive(boolean, .equal, &.{ principal, try b.reference(b.parameter(authority, 1)) }, 0)));
    const revalidate = try b.declare(&.{proposal}, boolean, &.{current}, &.{});
    try b.define(revalidate, try b.term(.{ .perform = .{ .effect = current, .payload = try b.reference(b.parameter(revalidate, 0)) } }));
    const mobility = try agent.mobility.define(c);
    const placement = try b.declare(&.{proposal}, boolean, &.{ mobility.resolve, mobility.relocate }, if (movement_state) |state| &.{state.region} else &.{});
    const result = try b.variable(try c.schema(agent.mobility.PlacementResult));
    const ready = try b.variable(try c.schema(agent.mobility.Placement));
    const failed = try b.variable(try c.schema(agent.mobility.Reason));
    const ready_body = if (movement_state) |state| blk: {
        const stored = try b.variable(try b.scalar(void));
        const remaining = try b.primitive(try b.scalar(u32), .field, &.{try b.reference(ready)}, 1);
        break :blk try b.bind(stored, try b.pure(try b.primitive(try b.scalar(void), .cell_set, &.{ state.cell, remaining }, 0)), try b.pure(try b.constant(bool, true)));
    } else try b.pure(try b.constant(bool, true));
    try b.define(placement, try b.bind(result, try agent.mobility.ensure(c, placement_input, failure), try b.term(.{ .match_sum = .{
        .value = try b.reference(result),
        .cases = &.{
            .{ .variable = ready, .body = ready_body },
            .{ .variable = failed, .body = try b.pure(try b.constant(bool, false)) },
        },
    } })));
    return agent.approval.define(c, .{
        .name = "repository.publish",
        .proposal = proposal,
        .occurrence = try c.schema(Text(128)),
        .principal = try b.scalar(u64),
        .reason = try c.schema(ReviewReason),
        .commit_effect = commit,
        .authority = authority,
        .revalidate = revalidate,
        .failure = failure,
        .channel = "repository-human",
        .placement = placement,
    });
}
const Application = struct {
    pub fn emit(c: agent.Context) !boundary.source.Module {
        const b = c.builder;
        const entry = try b.declare(&.{try c.schema(Task)}, try c.schema(Outcome), &.{}, &.{});
        const task = try b.reference(b.parameter(entry, 0));
        const principal = try b.primitive(try c.schema(u64), .field, &.{task}, 0);
        const candidate = try b.primitive(try c.schema(Proposal), .field, &.{task}, 1);
        const human = try b.primitive(try c.schema(agent.mobility.EnsureInput), .field, &.{task}, 2);
        const placement = try b.primitive(try c.schema(agent.mobility.EnsureInput), .field, &.{task}, 3);
        const check = try c.external("agent.repository.check.v1", try c.schema(Proposal), try c.schema(CheckResult), .write);
        const prepare = try c.external("agent.repository.proposal.v1", try c.schema(Preparation), try c.schema(Proposal), .write);
        const gate = try define(c, principal, placement);
        const row = try (boundary.source.Row{ .effects = gate.effects }).unionWith(b.allocator(), .{ .effects = &.{ check, prepare } });
        b.functions.items[@intCast(entry)].effects = row.effects;
        const validation = try b.variable(try c.schema(CheckResult));
        const proposal = try b.variable(try c.schema(Proposal));
        const input = try b.primitive(try c.schema(Preparation), .product, &.{ candidate, try b.primitive(try c.schema(Proposal), .field, &.{try b.reference(validation)}, 1), try c.literal(u64, 1), try c.literal(u64, 1) }, 0);
        const checked = try b.term(.{ .perform = .{ .effect = check, .payload = candidate } });
        const prepared = try b.term(.{ .perform = .{ .effect = prepare, .payload = input } });
        // These sites authorize bounded scratch preparation, never publication.
        try c.registry.protectSite(entry, checked, check);
        try c.registry.protectSite(entry, prepared, prepare);
        const moved = try b.variable(try c.schema(agent.mobility.PlacementResult));
        const arrived = try b.variable(try c.schema(agent.mobility.Placement));
        const failed = try b.variable(try c.schema(agent.mobility.Reason));
        const approve = try agent.approval.approveAndCommit(c, gate, entry, try b.reference(proposal));
        const at_human = try b.bind(moved, try agent.mobility.ensure(c, human, try b.constant(void, {})), try b.term(.{ .match_sum = .{
            .value = try b.reference(moved),
            .cases = &.{
                .{ .variable = arrived, .body = approve },
                .{ .variable = failed, .body = try b.pure(try b.primitive(try c.schema(Result), .variant, &.{try b.constant(void, {})}, 3)) },
            },
        } }));
        const approved = try b.variable(try c.schema(Result));
        const delivered = try b.bind(approved, at_human, try b.pure(try b.primitive(try c.schema(Outcome), .variant, &.{try b.reference(approved)}, 0)));
        const status = try b.primitive(try c.schema(CheckStatus), .field, &.{try b.reference(validation)}, 0);
        const passed = try b.primitive(try c.schema(bool), .equal, &.{ try b.primitive(try c.schema(u32), .enum_tag, &.{status}, 0), try c.literal(u32, 0) }, 0);
        try b.define(entry, try b.bind(validation, checked, try b.term(.{ .conditional = .{
            .condition = passed,
            .when_true = try b.bind(proposal, prepared, delivered),
            .when_false = try b.pure(try b.primitive(try c.schema(Outcome), .variant, &.{try b.reference(validation)}, 1)),
        } })));
        return b.module(entry, try b.scalar(void));
    }
};
pub const System = agent.system(.{ .InitialArgs = Task, .Result = Outcome, .Failure = void, .application = Application });
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse "image";
    inline for (.{ .{ "task", Task }, .{ "preparation", Preparation }, .{ "result", Outcome }, .{ "check-result", CheckResult }, .{ "proposal", Proposal }, .{ "receipt", Receipt }, .{ "delivery", Delivery }, .{ "human", HumanInput }, .{ "human-reply", HumanReply }, .{ "identifier", Text(128) }, .{ "boolean", bool } }) |item| {
        if (std.mem.eql(u8, mode, item[0])) {
            var b = boundary.source.Builder.init(init.gpa);
            defer b.deinit();
            const schema = try agent.contracts.schema(item[1], &b);
            const bytes = try boundary.data.schema.encodeOwned(init.gpa, b.schemas.items, schema);
            defer init.gpa.free(bytes);
            return write(init, bytes);
        }
    }
    if (!std.mem.eql(u8, mode, "image")) return error.InvalidMode;
    var compiled = try agent.compile(init.gpa, System);
    defer compiled.deinit();
    const bytes = try init.gpa.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    defer init.gpa.free(bytes);
    return write(init, try compiled.encode(init.gpa, bytes));
}
fn write(init: std.process.Init, bytes: []const u8) !void {
    var buffer: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &buffer);
    try out.interface.writeAll(bytes);
    try out.interface.flush();
}
