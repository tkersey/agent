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
pub const Result = union(enum) { delivered: Delivery, declined: Reason, invalid, denied };
pub const Task = struct { principal: u64, candidate: Proposal, human: agent.mobility.EnsureInput, placement: agent.mobility.EnsureInput };
pub const Preparation = struct { candidate: Proposal, validation: Proposal };
pub const Challenge = struct { occurrence: Text(128), proposal: Proposal };
pub const Decision = union(enum) { approve, reject: Reason, amend: Proposal };
pub const Answer = struct { challenge: Challenge, principal: u64, decision: Decision };
pub const HumanInput = struct { channel: agent.contracts.Utf8, purpose: agent.contracts.Utf8, presentation: void, outgoing: Challenge };
pub const HumanReply = union(enum) { response: Answer };

pub fn define(c: agent.Context, principal: Id, placement_input: Id) !agent.approval.Definition {
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
    const placement = try b.declare(&.{proposal}, boolean, &.{ mobility.resolve, mobility.relocate }, &.{});
    const result = try b.variable(try c.schema(agent.mobility.PlacementResult));
    const ready = try b.variable(try c.schema(agent.mobility.Placement));
    const failed = try b.variable(try c.schema(agent.mobility.Reason));
    try b.define(placement, try b.bind(result, try agent.mobility.ensure(c, placement_input, try b.constant(void, {})), try b.term(.{ .match_sum = .{
        .value = try b.reference(result),
        .cases = &.{
            .{ .variable = ready, .body = try b.pure(try b.constant(bool, true)) },
            .{ .variable = failed, .body = try b.pure(try b.constant(bool, false)) },
        },
    } })));
    return agent.approval.define(c, .{
        .name = "repository.publish",
        .proposal = proposal,
        .occurrence = try c.schema(Text(128)),
        .principal = try b.scalar(u64),
        .reason = try c.schema(Reason),
        .commit_effect = commit,
        .authority = authority,
        .revalidate = revalidate,
        .failure = try b.constant(void, {}),
        .channel = "repository-human",
        .placement = placement,
    });
}
const Application = struct {
    pub fn emit(c: agent.Context) !boundary.source.Module {
        const b = c.builder;
        const entry = try b.declare(&.{try c.schema(Task)}, try c.schema(Result), &.{}, &.{});
        const task = try b.reference(b.parameter(entry, 0));
        const principal = try b.primitive(try c.schema(u64), .field, &.{task}, 0);
        const candidate = try b.primitive(try c.schema(Proposal), .field, &.{task}, 1);
        const human = try b.primitive(try c.schema(agent.mobility.EnsureInput), .field, &.{task}, 2);
        const placement = try b.primitive(try c.schema(agent.mobility.EnsureInput), .field, &.{task}, 3);
        const check = try c.external("agent.repository.check.v1", try c.schema(Proposal), try c.schema(Proposal), .write);
        const prepare = try c.external("agent.repository.proposal.v1", try c.schema(Preparation), try c.schema(Proposal), .write);
        const gate = try define(c, principal, placement);
        const row = try (boundary.source.Row{ .effects = gate.effects }).unionWith(b.allocator(), .{ .effects = &.{ check, prepare } });
        b.functions.items[@intCast(entry)].effects = row.effects;
        const validation = try b.variable(try c.schema(Proposal));
        const proposal = try b.variable(try c.schema(Proposal));
        const input = try b.primitive(try c.schema(Preparation), .product, &.{ candidate, try b.reference(validation) }, 0);
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
        try b.define(entry, try b.bind(validation, checked, try b.bind(proposal, prepared, at_human)));
        return b.module(entry, try b.scalar(void));
    }
};
pub const System = agent.system(.{ .InitialArgs = Task, .Result = Result, .Failure = void, .application = Application });
pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const mode = args.next() orelse "image";
    inline for (.{ .{ "task", Task }, .{ "preparation", Preparation }, .{ "result", Result }, .{ "proposal", Proposal }, .{ "receipt", Receipt }, .{ "delivery", Delivery }, .{ "human", HumanInput }, .{ "human-reply", HumanReply }, .{ "identifier", Text(128) }, .{ "boolean", bool } }) |item| {
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
