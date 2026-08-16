const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");

const ToolSite = boundary.effect.site(72, "fixture.agent-parity-tool.v1", u32, u32);
const Action = union(enum) { tool: u32, final: u32 };
const Observation = union(enum) { tool: u32 };
const Failure = enum {
    budget_exhausted,
    history_overflow,
    arithmetic_overflow,
    invalid_variant,
    capacity_exceeded,
};
const Definition = agent.define(.{
    .name = "agent-machine-parity",
    .version = "1.0.0",
    .instructions = "Return the exact typed result.",
    .Goal = u32,
    .Action = Action,
    .Observation = Observation,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.agent-parity-decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{
        agent.action.effect(.tool, .tool, ToolSite, .{
            .name = "tool",
            .description = "Return the parity observation.",
            .class = .tool,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the result.",
        }),
    },
    .budget = .{
        .maximum_turns = 2,
        .maximum_decisions = 2,
        .maximum_effect_actions = 1,
        .maximum_child_actions = 0,
    },
});
const Compiled = agent.compile(Definition, agent.strategy.react(.{}), agent.epistemics.verbatim(.{
    .maximum_observations = 1,
    .overflow = .fail,
    .final = agent.final_policy.none,
}), .{
    .machine = .{
        .maximum_frames = 16,
        .maximum_state_bytes = 64 * 1024,
        .maximum_machine_fuel = 4096,
    },
});
const Machine = Compiled.Machine;

const ParityText = boundary.Text(16);
const TextCompareArgs = struct {
    left: ParityText,
    right: ParityText,
};

fn TextCompareLowered() type {
    const Builder = agent.Flow(.{ .schema_types = .{ TextCompareArgs, ParityText } });
    comptime var flow = Builder.init("agent-flow-text-compare-parity");
    const args = flow.begin(TextCompareArgs);
    flow.returnValue(flow.textCompare(
        flow.productExtract(0, args),
        flow.productExtract(1, args),
    ));
    return flow.finish(i8);
}

const TextCompareBody = struct {
    const Lowering = TextCompareLowered();
    pub const InitialArgs = TextCompareArgs;
    pub const Result = i8;
    pub const Failure = enum { impossible };
    pub const effect_sites = boundary.effect.row(.{});
    pub const schema_types = Lowering.schema_types;
    pub const control_ir = Lowering.control_ir;
};

const TextCompareMachine = boundary.program(
    "agent-flow-text-compare-parity",
    TextCompareBody,
).compile(.{
    .maximum_frames = 2,
    .maximum_state_bytes = 1024,
    .maximum_machine_fuel = 32,
});

fn runTextCompareParity() ?i8 {
    var allocator = std.heap.FixedBufferAllocator.init(&text_compare_state_storage);
    const state = TextCompareMachine.initialState(
        allocator.allocator(),
        .{
            .left = ParityText.fromSlice("same") catch return null,
            .right = ParityText.fromSlice("same") catch return null,
        },
    ) catch return null;
    defer TextCompareMachine.deinitState(state);
    var fuel: u64 = 32;
    const done = switch (TextCompareMachine.step(state, &fuel) catch return null) {
        .done => |result| result,
        else => return null,
    };
    defer done.deinit();
    return done.value().*;
}

var state_storage: [256 * 1024]u8 = undefined;
var image_storage: [128 * 1024]u8 = undefined;
var output_storage: [256 * 1024]u8 = undefined;
var text_compare_state_storage: [4096]u8 = undefined;

fn writeInt(output: []u8, cursor: *usize, comptime T: type, value: T) void {
    const width = @divExact(@typeInfo(T).int.bits, 8);
    std.mem.writeInt(T, output[cursor.*..][0..width], value, .little);
    cursor.* += width;
}

fn writeBytes(output: []u8, cursor: *usize, bytes: []const u8) void {
    @memcpy(output[cursor.*..][0..bytes.len], bytes);
    cursor.* += bytes.len;
}

pub export fn agentMachineParityRun() u32 {
    var state_allocator = std.heap.FixedBufferAllocator.init(&state_storage);
    const state = Machine.initialState(state_allocator.allocator(), 21) catch
        return 0;
    defer Machine.deinitState(state);
    var fuel: u64 = 4096;
    const first_decision = switch (Machine.step(state, &fuel) catch return 0) {
        .request => |request| request,
        else => return 0,
    };
    {
        const prepared = Machine.prepareResume(state, first_decision) catch return 0;
        defer Machine.deinitPreparedResume(prepared);
        Machine.@"resume"(prepared, Action{ .tool = 7 }) catch return 0;
    }
    const tool_request = switch (Machine.step(state, &fuel) catch return 0) {
        .request => |request| request,
        else => return 0,
    };
    switch (tool_request.value) {
        .s1 => |payload| if (payload != 7) return 0,
        else => return 0,
    }
    {
        const prepared = Machine.prepareResume(state, tool_request) catch return 0;
        defer Machine.deinitPreparedResume(prepared);
        Machine.@"resume"(prepared, @as(u32, 11)) catch return 0;
    }
    const decision = switch (Machine.step(state, &fuel) catch return 0) {
        .request => |request| request,
        else => return 0,
    };
    const request = switch (decision.value) {
        .s0 => |value| value,
        else => return 0,
    };
    const history_length = request.context.len() catch return 0;
    if (history_length != 1) return 0;
    const observation = (request.context.get(0) catch return 0) orelse return 0;
    const observed_tool = switch (observation) {
        .tool => |value| value,
    };
    if (observed_tool != 11) return 0;
    const catalog_length: u32 = 0;
    const instruction_length: u32 = 0;

    var image_allocator = std.heap.FixedBufferAllocator.init(&image_storage);
    const encoded_state = Machine.encodeState(
        image_allocator.allocator(),
        state,
    ) catch return 0;
    {
        const prepared = Machine.prepareResume(state, decision) catch return 0;
        defer Machine.deinitPreparedResume(prepared);
        Machine.@"resume"(prepared, Action{ .final = 42 }) catch return 0;
    }
    const done = switch (Machine.step(state, &fuel) catch return 0) {
        .done => |value| value,
        else => return 0,
    };
    defer done.deinit();
    if (done.value().* != 42) return 0;

    var cursor: usize = 0;
    writeInt(&output_storage, &cursor, u32, @intCast(encoded_state.len));
    writeBytes(&output_storage, &cursor, encoded_state);
    writeInt(&output_storage, &cursor, u64, decision.sequence);
    writeInt(&output_storage, &cursor, u32, decision.constructor_id);
    writeInt(&output_storage, &cursor, u32, request.goal);
    writeInt(&output_storage, &cursor, u32, request.counters.turns);
    writeInt(&output_storage, &cursor, u32, request.counters.decisions);
    writeInt(&output_storage, &cursor, u32, history_length);
    writeInt(&output_storage, &cursor, u32, observed_tool);
    writeInt(&output_storage, &cursor, u32, catalog_length);
    writeInt(&output_storage, &cursor, u32, instruction_length);
    writeInt(&output_storage, &cursor, u32, @intFromEnum(request.phase));
    writeInt(&output_storage, &cursor, u32, done.value().*);
    writeInt(&output_storage, &cursor, i8, runTextCompareParity() orelse return 0);
    writeBytes(&output_storage, &cursor, &Compiled.DefinitionManifestBytes);
    writeBytes(&output_storage, &cursor, &Compiled.StrategyManifestBytes);
    writeBytes(&output_storage, &cursor, &Compiled.ManifestBytes);
    return @intCast(cursor);
}

pub export fn agentMachineParityOutputPointer() u32 {
    return @intCast(@intFromPtr(&output_storage));
}

pub fn outputBytes(length: u32) []const u8 {
    return output_storage[0..length];
}
