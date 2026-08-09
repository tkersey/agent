const std = @import("std");
const boundary = @import("boundary");

pub const Hasher = std.crypto.hash.sha2.Sha256;

pub fn unsigned(hasher: *Hasher, value: anytype) void {
    var encoded: [8]u8 = undefined;
    std.mem.writeInt(u64, &encoded, @intCast(value), .big);
    hasher.update(&encoded);
}

pub fn boolean(hasher: *Hasher, value: bool) void {
    hasher.update(&.{@intFromBool(value)});
}

pub fn bytes(hasher: *Hasher, value: []const u8) void {
    unsigned(hasher, value.len);
    hasher.update(value);
}

pub fn digestBytes(value: []const u8) [32]u8 {
    var result: [32]u8 = undefined;
    Hasher.hash(value, &result, .{});
    return result;
}

pub fn finish(hasher: *Hasher) [32]u8 {
    var result: [32]u8 = undefined;
    hasher.final(&result);
    return result;
}

fn valueType(hasher: *Hasher, value: boundary.ir.ValueType) void {
    switch (value) {
        .scalar => |scalar| {
            unsigned(hasher, 0);
            unsigned(hasher, @intFromEnum(scalar));
        },
        .schema => |schema| {
            unsigned(hasher, 1);
            unsigned(hasher, schema);
        },
    }
}

fn operation(hasher: *Hasher, value: boundary.ir.InstructionOperation) void {
    unsigned(hasher, @intFromEnum(std.meta.activeTag(value)));
    switch (value) {
        inline else => |payload| {
            if (@TypeOf(payload) != void) unsigned(hasher, payload);
        },
    }
}

fn edgeArgument(hasher: *Hasher, value: boundary.ir.EdgeArgument) void {
    switch (value) {
        .value => |id| {
            unsigned(hasher, 0);
            unsigned(hasher, id);
        },
        .@"resume" => unsigned(hasher, 1),
    }
}

fn edge(hasher: *Hasher, value: boundary.ir.Edge) void {
    unsigned(hasher, value.target);
    unsigned(hasher, value.arguments.len);
    for (value.arguments) |argument| edgeArgument(hasher, argument);
}

fn optionalUnsigned(hasher: *Hasher, value: anytype) void {
    if (value) |present| {
        boolean(hasher, true);
        unsigned(hasher, present);
    } else boolean(hasher, false);
}

fn optionalValueType(hasher: *Hasher, value: ?boundary.ir.ValueType) void {
    if (value) |present| {
        boolean(hasher, true);
        valueType(hasher, present);
    } else boolean(hasher, false);
}

fn terminator(hasher: *Hasher, value: boundary.ir.Terminator) void {
    unsigned(hasher, @intFromEnum(std.meta.activeTag(value)));
    switch (value) {
        .jump => |jump| edge(hasher, jump),
        .branch => |branch| {
            unsigned(hasher, branch.condition);
            edge(hasher, branch.then_edge);
            edge(hasher, branch.else_edge);
        },
        .@"suspend" => |suspension| {
            unsigned(hasher, @intFromEnum(suspension.kind));
            optionalUnsigned(hasher, suspension.site_id);
            unsigned(hasher, suspension.request_values.len);
            for (suspension.request_values) |request| unsigned(hasher, request);
            optionalUnsigned(hasher, suspension.callee_function);
            if (suspension.callee) |callee| {
                boolean(hasher, true);
                edge(hasher, callee);
            } else boolean(hasher, false);
            edge(hasher, suspension.continuation);
            optionalValueType(hasher, suspension.resume_type);
        },
        .return_value => |result| optionalUnsigned(hasher, result),
        .return_to_caller => |result| unsigned(hasher, result),
        .fail => |failure| unsigned(hasher, failure),
        .fail_value => |failure| unsigned(hasher, failure),
    }
}

/// Canonical target-neutral digest of normalized generated Boundary Control IR.
pub fn controlDigest(comptime program: boundary.ir.Program) [32]u8 {
    @setEvalBranchQuota(10_000_000);
    var hasher = Hasher.init(.{});
    bytes(&hasher, "agent-control-ir/v1");
    unsigned(&hasher, program.value_types.len);
    for (program.value_types) |value| valueType(&hasher, value);
    unsigned(&hasher, program.blocks.len);
    for (program.blocks) |block| {
        unsigned(&hasher, block.id);
        unsigned(&hasher, block.function_id);
        unsigned(&hasher, @intFromEnum(block.role));
        unsigned(&hasher, block.parameters.len);
        for (block.parameters) |parameter| unsigned(&hasher, parameter);
        unsigned(&hasher, block.instructions.len);
        for (block.instructions) |instruction| {
            unsigned(&hasher, @intFromEnum(instruction.kind));
            unsigned(&hasher, instruction.result);
            unsigned(&hasher, instruction.operands.len);
            for (instruction.operands) |operand| unsigned(&hasher, operand);
            operation(&hasher, instruction.operation);
        }
        terminator(&hasher, block.terminator);
    }
    unsigned(&hasher, program.entry);
    valueType(&hasher, program.result_type);
    unsigned(&hasher, program.functions.len);
    for (program.functions) |function| {
        unsigned(&hasher, function.id);
        unsigned(&hasher, function.entry);
        valueType(&hasher, function.result_type);
    }
    return finish(&hasher);
}
