const agent = @import("agent");
const boundary = @import("boundary");
const repository = @import("repository_system")
    .RepositoryRepairSystem(agent, boundary);
const std = @import("std");

const initial_goal =
    "Repair the normalizeRange implementation in the admitted repository. " ++
    "Inspect the package, source, and tests; observe the failing baseline; " ++
    "apply one digest-bound source correction; rerun the complete tests; and " ++
    "finish with the actual changed path and final source digest.";
const final_digest = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.InvalidArguments;
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    if (std.mem.eql(u8, args[1], "bpi1")) {
        try output.interface.writeAll(try encodedImage(init.arena.allocator()));
    } else if (std.mem.eql(u8, args[1], "initial")) {
        try writeValue(
            repository.Goal,
            repository.Goal.fromSlice(initial_goal) catch unreachable,
            &output.interface,
        );
    } else if (std.mem.eql(u8, args[1], "expected-final")) {
        try writeValue(
            repository.Result,
            .{
                .summary = repository.Summary.fromSlice(
                    "Corrected normalizeRange and verified the complete suite.",
                ) catch unreachable,
                .changed_path = repository.Path.fromSlice(
                    "src/range.mjs",
                ) catch unreachable,
                .final_source_sha256 = repository.Digest.fromSlice(
                    final_digest,
                ) catch unreachable,
            },
            &output.interface,
        );
    } else if (std.mem.eql(u8, args[1], "source-map")) {
        try writeSourceMap(
            try encodedImage(init.arena.allocator()),
            &output.interface,
        );
    } else return error.InvalidArguments;
    try output.interface.flush();
}

fn encodedImage(allocator: std.mem.Allocator) ![]const u8 {
    const image = try allocator.alloc(
        u8,
        repository.System.Source.representation.image_bytes,
    );
    const encoding_workspace = try allocator.create(
        repository.System.Program.ImageEncodingWorkspace,
    );
    const length = try repository.System.Program.encodeImage(
        image,
        encoding_workspace,
    );
    const workspace = try allocator.create(boundary.image.ValidationWorkspace);
    workspace.* = .{};
    _ = try boundary.image.validateImageView(image[0..length], workspace);
    return image[0..length];
}

fn writeSourceMap(image: []const u8, output: *std.Io.Writer) !void {
    const Program = repository.System.Program;
    const control = Program.control_ir;
    const PhaseMap = repository.System.source_phase_map;
    const Reachability = boundary.ir.Reachability(
        Program.compiler_limits.maximum_blocks,
    );
    const reachability = try Reachability.analyze(control);
    var function_source_to_dense =
        [_]?u16{null} ** Program.compiler_limits.maximum_blocks;
    var function_dense_to_source =
        [_]u16{0} ** Program.compiler_limits.maximum_blocks;
    var function_count: usize = 0;
    for (0..reachability.count) |dense_segment| {
        const source_segment = reachability.sourceId(
            @intCast(dense_segment),
        ).?;
        const source_function = control.blocks[source_segment].function_id;
        if (function_source_to_dense[source_function] == null) {
            function_source_to_dense[source_function] = @intCast(function_count);
            function_dense_to_source[function_count] = source_function;
            function_count += 1;
        }
    }

    var image_digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(image, &image_digest, .{});
    const image_hex = std.fmt.bytesToHex(image_digest, .lower);
    const transition_hex = std.fmt.bytesToHex(
        Program.program_transition_digest,
        .lower,
    );
    try output.print(
        "{{\"format\":\"agent-bpi1-source-map/v1\"," ++
            "\"imageSha256\":\"{s}\"," ++
            "\"programTransitionDigest\":\"{s}\",\"segments\":[",
        .{ &image_hex, &transition_hex },
    );
    for (0..reachability.count) |dense_segment| {
        if (dense_segment != 0) try output.writeByte(',');
        const source_segment = reachability.sourceId(
            @intCast(dense_segment),
        ).?;
        const block = control.blocks[source_segment];
        try output.print(
            "{{\"segmentId\":{d},\"functionId\":{d},\"phaseSpans\":[",
            .{
                dense_segment,
                function_source_to_dense[block.function_id].?,
            },
        );
        try writePhaseSpans(source_segment, output);
        try output.print(
            "],\"terminatorPhase\":\"{s}\"}}",
            .{PhaseMap.block_terminator_phases[source_segment].label()},
        );
    }
    try output.writeAll("],\"functions\":[");
    for (function_dense_to_source[0..function_count], 0..) |
        source_function,
        dense_function,
    | {
        if (dense_function != 0) try output.writeByte(',');
        const source_entry = if (control.functions.len == 0)
            control.entry
        else
            control.functions[source_function].entry;
        try output.print(
            "{{\"functionId\":{d},\"entrySegmentId\":{d},\"phases\":[",
            .{
                dense_function,
                reachability.denseId(source_entry).?,
            },
        );
        try writeFunctionPhases(source_function, control, reachability, output);
        try output.writeAll("]}");
    }
    try output.writeAll("]}\n");
}

fn writePhaseSpans(source_segment: u16, output: *std.Io.Writer) !void {
    const map = repository.System.source_phase_map;
    const start = map.block_instruction_starts[source_segment];
    const count = map.block_instruction_counts[source_segment];
    var index: u32 = 0;
    var wrote = false;
    while (index < count) {
        const phase = map.instruction_phases[start + index];
        var end = index + 1;
        while (end < count and map.instruction_phases[start + end] == phase) {
            end += 1;
        }
        if (wrote) try output.writeByte(',');
        try output.print(
            "{{\"phase\":\"{s}\",\"firstInstruction\":{d}," ++
                "\"instructionCount\":{d}}}",
            .{ phase.label(), index, end - index },
        );
        wrote = true;
        index = end;
    }
}

fn writeFunctionPhases(
    source_function: u16,
    control: boundary.ir.Program,
    reachability: anytype,
    output: *std.Io.Writer,
) !void {
    const phase_count = @typeInfo(agent.FlowPhase).@"enum".fields.len;
    var phases = [_]bool{false} ** phase_count;
    const map = repository.System.source_phase_map;
    for (control.blocks) |block| {
        if (block.function_id != source_function or
            !reachability.contains(block.id)) continue;
        const start = map.block_instruction_starts[block.id];
        const count = map.block_instruction_counts[block.id];
        for (map.instruction_phases[start .. start + count]) |phase| {
            phases[@intFromEnum(phase)] = true;
        }
        phases[@intFromEnum(map.block_terminator_phases[block.id])] = true;
    }
    var wrote = false;
    for (0..phase_count) |phase_value| {
        if (!phases[phase_value]) continue;
        if (wrote) try output.writeByte(',');
        const phase: agent.FlowPhase = @enumFromInt(phase_value);
        try output.print("\"{s}\"", .{phase.label()});
        wrote = true;
    }
}

fn writeValue(comptime T: type, value: T, output: *std.Io.Writer) !void {
    var bytes: [boundary.schema.maximumEncodedSize(T)]u8 = undefined;
    const length = try boundary.schema.encode(T, value, &bytes);
    try output.writeAll(bytes[0..length]);
}
