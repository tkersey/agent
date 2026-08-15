const std = @import("std");
const agent = @import("agent");

const Action = union(enum) { final: u32 };
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
    .Observation = void,
    .Result = u32,
    .Failure = Failure,
    .decision = .{
        .interface = "fixture.agent-parity-decide.v1",
        .maximum_request_bytes = 4096,
        .maximum_result_bytes = 64,
    },
    .actions = .{
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return the result.",
        }),
    },
    .budget = .{
        .maximum_turns = 1,
        .maximum_decisions = 1,
        .maximum_effect_actions = 0,
        .maximum_child_actions = 0,
    },
});
const Compiled = agent.compile(Definition, agent.strategy.react(.{}), agent.epistemics.verbatim(.{
    .maximum_observations = 0,
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

var state_storage: [256 * 1024]u8 = undefined;
var image_storage: [128 * 1024]u8 = undefined;
var output_storage: [256 * 1024]u8 = undefined;

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
    const effect = switch (Machine.step(state, &fuel) catch return 0) {
        .request => |request| request,
        else => return 0,
    };
    const request = switch (effect.value) {
        .s0 => |value| value,
    };
    const history_length = request.context.len() catch return 0;
    const catalog_length: u32 = 0;
    const instruction_length: u32 = 0;

    var image_allocator = std.heap.FixedBufferAllocator.init(&image_storage);
    const encoded_state = Machine.encodeState(
        image_allocator.allocator(),
        state,
    ) catch return 0;
    {
        const prepared = Machine.prepareResume(state, effect) catch return 0;
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
    writeInt(&output_storage, &cursor, u64, effect.sequence);
    writeInt(&output_storage, &cursor, u32, effect.constructor_id);
    writeInt(&output_storage, &cursor, u32, request.goal);
    writeInt(&output_storage, &cursor, u32, request.counters.turns);
    writeInt(&output_storage, &cursor, u32, request.counters.decisions);
    writeInt(&output_storage, &cursor, u32, history_length);
    writeInt(&output_storage, &cursor, u32, catalog_length);
    writeInt(&output_storage, &cursor, u32, instruction_length);
    writeInt(&output_storage, &cursor, u32, @intFromEnum(request.phase));
    writeInt(&output_storage, &cursor, u32, done.value().*);
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
