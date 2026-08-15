const std = @import("std");
const boundary = @import("boundary");

/// Compiler-only symbolic value. It never appears in a Boundary Machine.
pub fn Value(comptime T: type) type {
    return struct {
        pub const Type = T;
        id: boundary.ir.ValueId,
    };
}

pub const Limits = struct {
    maximum_values: usize = 256,
    maximum_blocks: usize = 128,
    maximum_instructions: usize = 512,
    maximum_operands: usize = 1024,
    maximum_parameters: usize = 512,
    maximum_requests: usize = 256,
    maximum_edge_arguments: usize = 512,
};

const TerminatorKind = enum {
    unset,
    jump,
    branch,
    suspend_effect,
    return_value,
    fail_value,
};

const InstructionDraft = struct {
    kind: boundary.ir.InstructionKind,
    result: boundary.ir.ValueId,
    operand_start: usize,
    operand_count: usize,
    operation: boundary.ir.InstructionOperation,
};

const BlockDraft = struct {
    id: boundary.ir.BlockId,
    role: boundary.ir.BlockRole = .segment,
    parameter_start: usize,
    parameter_count: usize = 0,
    instruction_start: usize,
    instruction_count: usize = 0,
    terminator_kind: TerminatorKind = .unset,
    result_value: boundary.ir.ValueId = 0,
    failure_value: boundary.ir.ValueId = 0,
    condition: boundary.ir.ValueId = 0,
    jump_target: boundary.ir.BlockId = 0,
    jump_argument_start: usize = 0,
    jump_argument_count: usize = 0,
    then_target: boundary.ir.BlockId = 0,
    then_argument_start: usize = 0,
    then_argument_count: usize = 0,
    else_target: boundary.ir.BlockId = 0,
    else_argument_start: usize = 0,
    else_argument_count: usize = 0,
    site_id: u32 = 0,
    request_start: usize = 0,
    request_count: usize = 0,
    continuation_target: boundary.ir.BlockId = 0,
    continuation_argument_start: usize = 0,
    continuation_argument_count: usize = 0,
    resume_type: boundary.ir.ValueType = .{ .scalar = .unit },
    entered: bool = false,
};

fn SymbolicTuple(comptime Types: anytype) type {
    var symbolic_types: [Types.len]type = undefined;
    inline for (Types, 0..) |T, index| symbolic_types[index] = Value(T);
    return std.meta.Tuple(&symbolic_types);
}

fn Block(comptime Types: anytype) type {
    return struct {
        id: boundary.ir.BlockId,
        parameters: SymbolicTuple(Types),
    };
}

fn PerformOutput(comptime Resume: type, comptime Carry: type) type {
    const fields = std.meta.fields(Carry);
    const carried_types = blk: {
        var result: [fields.len]type = undefined;
        inline for (fields, 0..) |field, index| {
            if (!@hasDecl(field.type, "Type")) {
                @compileError("agent.Flow perform carry values must be agent.Value instances");
            }
            result[index] = Value(field.type.Type);
        }
        break :blk result;
    };
    return struct {
        value: Value(Resume),
        carried: std.meta.Tuple(&carried_types),
    };
}

/// Create one bounded comptime Flow builder over an explicit schema catalog.
///
/// Flow assigns every numeric Control IR identity and continuation placeholder.
/// Its output is one ordinary `boundary.ir.Program`; it owns no runtime meaning.
pub fn Flow(comptime config: anytype) type {
    const limits: Limits = if (@hasField(@TypeOf(config), "limits"))
        config.limits
    else
        .{};

    return struct {
        const Self = @This();

        label: []const u8,
        value_types: [limits.maximum_values]boundary.ir.ValueType = undefined,
        value_count: usize = 0,
        instructions: [limits.maximum_instructions]InstructionDraft = undefined,
        instruction_count: usize = 0,
        operands: [limits.maximum_operands]boundary.ir.ValueId = undefined,
        operand_count: usize = 0,
        blocks: [limits.maximum_blocks]BlockDraft = undefined,
        block_count: usize = 0,
        parameters: [limits.maximum_parameters]boundary.ir.ValueId = undefined,
        parameter_count: usize = 0,
        requests: [limits.maximum_requests]boundary.ir.ValueId = undefined,
        request_count: usize = 0,
        edge_arguments: [limits.maximum_edge_arguments]boundary.ir.EdgeArgument = undefined,
        edge_argument_count: usize = 0,
        current_block: boundary.ir.BlockId = 0,
        started: bool = false,
        terminal_handoff_count: usize = 0,
        return_handoff_count: usize = 0,
        control_mutation_count: usize = 0,

        pub fn init(comptime label: []const u8) Self {
            if (label.len == 0) @compileError("agent.Flow label must not be empty");
            return .{ .label = label };
        }

        /// Number of external-effect suspensions emitted so far. Compiler-owned
        /// facades use this to reject effects introduced by pure lowering hooks.
        pub fn suspensionCount(self: *const Self) usize {
            return self.request_count;
        }

        /// Number of authored terminal handoffs emitted so far. Pure strategy
        /// and epistemic hooks may elaborate local deterministic control flow,
        /// but they may not return or fail the enclosing Agent program.
        pub fn terminalHandoffCount(self: *const Self) usize {
            return self.terminal_handoff_count;
        }

        /// Number of successful program returns emitted so far. Epistemic
        /// folds may author deterministic failures, but never a final result.
        pub fn returnHandoffCount(self: *const Self) usize {
            return self.return_handoff_count;
        }

        /// Number of compiler control-topology mutations emitted so far.
        pub fn controlMutationCount(self: *const Self) usize {
            return self.control_mutation_count;
        }

        fn failLimit(comptime message: []const u8) noreturn {
            @compileError("agent.Flow " ++ message);
        }

        fn loweredType(comptime T: type) boundary.ir.ValueType {
            boundary.schema.assertPortable(T);
            if (T == void) return .{ .scalar = .unit };
            if (T == bool) return .{ .scalar = .boolean };
            if (T == i8) return .{ .scalar = .i8 };
            if (T == i16) return .{ .scalar = .i16 };
            if (T == i32) return .{ .scalar = .i32 };
            if (T == i64) return .{ .scalar = .i64 };
            if (T == u8) return .{ .scalar = .u8 };
            if (T == u16) return .{ .scalar = .u16 };
            if (T == u32) return .{ .scalar = .u32 };
            if (T == u64) return .{ .scalar = .u64 };
            inline for (config.schema_types, 0..) |Schema, index| {
                if (T == Schema) return .{ .schema = @intCast(index) };
            }
            @compileError(
                "agent.Flow structured type is absent from config.schema_types: " ++
                    @typeName(T),
            );
        }

        fn addValue(self: *Self, comptime T: type) Value(T) {
            if (self.value_count >= limits.maximum_values) {
                failLimit("maximum_values exceeded");
            }
            const id: boundary.ir.ValueId = @intCast(self.value_count);
            self.value_types[self.value_count] = loweredType(T);
            self.value_count += 1;
            return .{ .id = id };
        }

        fn addBlock(self: *Self, role: boundary.ir.BlockRole) boundary.ir.BlockId {
            if (self.block_count >= limits.maximum_blocks) {
                failLimit("maximum_blocks exceeded");
            }
            const id: boundary.ir.BlockId = @intCast(self.block_count);
            self.blocks[self.block_count] = .{
                .id = id,
                .role = role,
                .parameter_start = self.parameter_count,
                .instruction_start = 0,
            };
            self.block_count += 1;
            return id;
        }

        fn current(self: *Self) *BlockDraft {
            if (!self.started) @compileError("agent.Flow must begin before use");
            if (!self.blocks[@intCast(self.current_block)].entered) {
                @compileError("agent.Flow current block was not entered");
            }
            return &self.blocks[@intCast(self.current_block)];
        }

        fn addParameterTo(
            self: *Self,
            block_id: boundary.ir.BlockId,
            value: boundary.ir.ValueId,
        ) void {
            if (self.parameter_count >= limits.maximum_parameters) {
                failLimit("maximum_parameters exceeded");
            }
            self.parameters[self.parameter_count] = value;
            self.parameter_count += 1;
            self.blocks[@intCast(block_id)].parameter_count += 1;
        }

        fn enterRaw(self: *Self, block_id: boundary.ir.BlockId) void {
            const draft = &self.blocks[@intCast(block_id)];
            if (draft.entered) @compileError("agent.Flow block may be entered only once");
            draft.entered = true;
            draft.instruction_start = self.instruction_count;
            self.current_block = block_id;
        }

        /// Begin the root function with one typed InitialArgs parameter.
        pub fn begin(self: *Self, comptime InitialArgs: type) Value(InitialArgs) {
            if (self.started) @compileError("agent.Flow may begin only once");
            const entry = self.addBlock(.loop_header);
            self.started = true;
            self.control_mutation_count += 1;
            self.enterRaw(entry);
            const input = self.addValue(InitialArgs);
            self.addParameterTo(entry, input.id);
            return input;
        }

        /// Declare a typed successor block without exposing numeric identities.
        pub fn block(
            self: *Self,
            comptime role: boundary.ir.BlockRole,
            comptime ParameterTypes: anytype,
        ) Block(ParameterTypes) {
            const id = self.addBlock(role);
            self.control_mutation_count += 1;
            var result: Block(ParameterTypes) = .{
                .id = id,
                .parameters = undefined,
            };
            inline for (ParameterTypes, 0..) |T, index| {
                const parameter = self.addValue(T);
                self.addParameterTo(id, parameter.id);
                result.parameters[index] = parameter;
            }
            return result;
        }

        /// Enter a previously declared successor block for lexical emission.
        pub fn enter(self: *Self, target: anytype) @TypeOf(target.parameters) {
            if (self.current().terminator_kind == .unset) {
                @compileError("agent.Flow must terminate the current block before entering another");
            }
            self.enterRaw(target.id);
            self.control_mutation_count += 1;
            return target.parameters;
        }

        fn appendOperand(self: *Self, value: boundary.ir.ValueId) void {
            if (self.operand_count >= limits.maximum_operands) {
                failLimit("maximum_operands exceeded");
            }
            self.operands[self.operand_count] = value;
            self.operand_count += 1;
        }

        fn instruction(
            self: *Self,
            comptime Result: type,
            kind: boundary.ir.InstructionKind,
            operation: boundary.ir.InstructionOperation,
            operands: anytype,
        ) Value(Result) {
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow cannot append after a block terminator");
            }
            if (self.instruction_count >= limits.maximum_instructions) {
                failLimit("maximum_instructions exceeded");
            }
            const result = self.addValue(Result);
            const operand_start = self.operand_count;
            inline for (operands) |operand| self.appendOperand(operand.id);
            self.instructions[self.instruction_count] = .{
                .kind = kind,
                .result = result.id,
                .operand_start = operand_start,
                .operand_count = self.operand_count - operand_start,
                .operation = operation,
            };
            self.instruction_count += 1;
            self.current().instruction_count += 1;
            return result;
        }

        pub fn constant(
            self: *Self,
            comptime T: type,
            comptime constant_index: u16,
        ) Value(T) {
            return self.instruction(
                T,
                .constant,
                .{ .constant = constant_index },
                .{},
            );
        }

        pub fn copy(self: *Self, value: anytype) Value(@TypeOf(value).Type) {
            return self.instruction(@TypeOf(value).Type, .copy, .copy, .{value});
        }

        pub fn productConstruct(
            self: *Self,
            comptime Product: type,
            fields: anytype,
        ) Value(Product) {
            return self.instruction(Product, .pure, .product_construct, fields);
        }

        pub fn productExtract(
            self: *Self,
            comptime field_index: u16,
            product: anytype,
        ) Value(@typeInfo(@TypeOf(product).Type).@"struct".fields[field_index].type) {
            const Field = @typeInfo(@TypeOf(product).Type).@"struct".fields[field_index].type;
            return self.instruction(
                Field,
                .pure,
                .{ .product_extract = field_index },
                .{product},
            );
        }

        pub fn productReplace(
            self: *Self,
            comptime field_index: u16,
            product: anytype,
            replacement: anytype,
        ) @TypeOf(product) {
            return self.instruction(
                @TypeOf(product).Type,
                .pure,
                .{ .product_replace = field_index },
                .{ product, replacement },
            );
        }

        pub fn sumTagIs(
            self: *Self,
            comptime variant_index: u16,
            sum: anytype,
        ) Value(bool) {
            return self.instruction(
                bool,
                .pure,
                .{ .sum_tag_is = variant_index },
                .{sum},
            );
        }

        pub fn sumExtract(
            self: *Self,
            comptime variant_index: u16,
            sum: anytype,
        ) Value(@typeInfo(@TypeOf(sum).Type).@"union".fields[variant_index].type) {
            const Payload = @typeInfo(@TypeOf(sum).Type).@"union".fields[variant_index].type;
            return self.instruction(
                Payload,
                .pure,
                .{ .sum_extract = variant_index },
                .{sum},
            );
        }

        pub fn integerAdd(self: *Self, left: anytype, right: @TypeOf(left)) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_add,
                .{ left, right },
            );
        }

        pub fn integerSubtract(self: *Self, left: anytype, right: @TypeOf(left)) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_subtract,
                .{ left, right },
            );
        }

        pub fn integerGreaterEqual(
            self: *Self,
            left: anytype,
            right: @TypeOf(left),
        ) Value(bool) {
            return self.instruction(bool, .pure, .integer_greater_equal, .{ left, right });
        }

        pub fn integerEqual(self: *Self, left: anytype, right: @TypeOf(left)) Value(bool) {
            return self.instruction(bool, .pure, .integer_equal, .{ left, right });
        }

        pub fn compareEqZero(self: *Self, value: anytype) Value(bool) {
            return self.instruction(bool, .compare_eq_zero, .compare_eq_zero, .{value});
        }

        pub fn booleanOr(self: *Self, left: Value(bool), right: Value(bool)) Value(bool) {
            return self.instruction(bool, .pure, .boolean_or, .{ left, right });
        }

        pub fn booleanAnd(self: *Self, left: Value(bool), right: Value(bool)) Value(bool) {
            return self.instruction(bool, .pure, .boolean_and, .{ left, right });
        }

        pub fn booleanNot(self: *Self, value: Value(bool)) Value(bool) {
            return self.instruction(bool, .pure, .boolean_not, .{value});
        }

        pub fn select(self: *Self, condition: Value(bool), when_true: anytype, when_false: @TypeOf(when_true)) @TypeOf(when_true) {
            return self.instruction(
                @TypeOf(when_true).Type,
                .pure,
                .select,
                .{ condition, when_true, when_false },
            );
        }

        pub fn sumConstruct(
            self: *Self,
            comptime Sum: type,
            comptime variant_index: u16,
            payload: anytype,
        ) Value(Sum) {
            return self.instruction(
                Sum,
                .pure,
                .{ .sum_construct = variant_index },
                .{payload},
            );
        }

        pub fn optionalNone(self: *Self, comptime Optional: type) Value(Optional) {
            return self.instruction(Optional, .pure, .optional_none, .{});
        }

        pub fn optionalSome(
            self: *Self,
            comptime Optional: type,
            value: anytype,
        ) Value(Optional) {
            return self.instruction(Optional, .pure, .optional_some, .{value});
        }

        pub fn vectorEmpty(self: *Self, comptime Vector: type) Value(Vector) {
            return self.instruction(Vector, .pure, .vector_empty, .{});
        }

        pub fn vectorLength(self: *Self, vector: anytype) Value(u32) {
            return self.instruction(u32, .pure, .vector_length, .{vector});
        }

        pub fn vectorGet(
            self: *Self,
            vector: anytype,
            index: Value(u32),
        ) Value(@TypeOf(vector).Type.ElementType) {
            return self.instruction(
                @TypeOf(vector).Type.ElementType,
                .pure,
                .vector_get,
                .{ vector, index },
            );
        }

        pub fn vectorSet(
            self: *Self,
            vector: anytype,
            index: Value(u32),
            element: Value(@TypeOf(vector).Type.ElementType),
        ) @TypeOf(vector) {
            return self.instruction(
                @TypeOf(vector).Type,
                .pure,
                .vector_set,
                .{ vector, index, element },
            );
        }

        pub fn vectorPush(self: *Self, vector: anytype, element: anytype) @TypeOf(vector) {
            return self.instruction(
                @TypeOf(vector).Type,
                .pure,
                .vector_push,
                .{ vector, element },
            );
        }

        pub fn vectorTruncate(
            self: *Self,
            vector: anytype,
            length: Value(u32),
        ) @TypeOf(vector) {
            return self.instruction(
                @TypeOf(vector).Type,
                .pure,
                .vector_truncate,
                .{ vector, length },
            );
        }

        fn appendRequest(self: *Self, value: boundary.ir.ValueId) void {
            if (self.request_count >= limits.maximum_requests) {
                failLimit("maximum_requests exceeded");
            }
            self.requests[self.request_count] = value;
            self.request_count += 1;
        }

        fn appendEdgeArgument(self: *Self, argument: boundary.ir.EdgeArgument) void {
            if (self.edge_argument_count >= limits.maximum_edge_arguments) {
                failLimit("maximum_edge_arguments exceeded");
            }
            self.edge_arguments[self.edge_argument_count] = argument;
            self.edge_argument_count += 1;
        }

        fn appendValueArguments(self: *Self, target: anytype, arguments: anytype) struct {
            start: usize,
            count: usize,
        } {
            const expected = std.meta.fields(@TypeOf(target.parameters));
            const actual = std.meta.fields(@TypeOf(arguments));
            if (expected.len != actual.len) {
                @compileError("agent.Flow edge argument count differs from target parameters");
            }
            const start = self.edge_argument_count;
            inline for (actual, 0..) |field, index| {
                const argument = @field(arguments, field.name);
                const parameter = target.parameters[index];
                if (@TypeOf(argument).Type != @TypeOf(parameter).Type) {
                    @compileError("agent.Flow edge argument type differs from target parameter");
                }
                self.appendEdgeArgument(.{ .value = argument.id });
            }
            return .{ .start = start, .count = self.edge_argument_count - start };
        }

        /// Transfer typed values to one declared block.
        pub fn jump(self: *Self, target: anytype, arguments: anytype) void {
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow block already has a terminator");
            }
            const edge = self.appendValueArguments(target, arguments);
            self.current().terminator_kind = .jump;
            self.current().jump_target = target.id;
            self.current().jump_argument_start = edge.start;
            self.current().jump_argument_count = edge.count;
            self.control_mutation_count += 1;
        }

        /// Select one of two typed successor blocks.
        pub fn branch(
            self: *Self,
            condition: Value(bool),
            then_target: anytype,
            then_arguments: anytype,
            else_target: anytype,
            else_arguments: anytype,
        ) void {
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow block already has a terminator");
            }
            const then_edge = self.appendValueArguments(then_target, then_arguments);
            const else_edge = self.appendValueArguments(else_target, else_arguments);
            self.current().terminator_kind = .branch;
            self.current().condition = condition.id;
            self.current().then_target = then_target.id;
            self.current().then_argument_start = then_edge.start;
            self.current().then_argument_count = then_edge.count;
            self.current().else_target = else_target.id;
            self.current().else_argument_start = else_edge.start;
            self.current().else_argument_count = else_edge.count;
            self.control_mutation_count += 1;
        }

        /// Perform one declared typed effect and enter its continuation block.
        /// Carried symbolic values are explicitly remapped; resume placeholders
        /// and continuation arguments remain private to Flow.
        pub fn perform(
            self: *Self,
            comptime Site: type,
            payload: Value(Site.Payload),
            carry: anytype,
        ) PerformOutput(Site.Resume, @TypeOf(carry)) {
            const source_block = self.current_block;
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow effect follows a terminated block");
            }
            const request_start = self.request_count;
            self.appendRequest(payload.id);
            const continuation_argument_start = self.edge_argument_count;
            self.appendEdgeArgument(.@"resume");
            inline for (carry) |value| {
                self.appendEdgeArgument(.{ .value = value.id });
            }

            const continuation = self.addBlock(.after_handler);
            var output: PerformOutput(Site.Resume, @TypeOf(carry)) = undefined;
            output.value = self.addValue(Site.Resume);
            self.addParameterTo(continuation, output.value.id);
            inline for (std.meta.fields(@TypeOf(carry))) |field| {
                const old_value = @field(carry, field.name);
                const new_value = self.addValue(@TypeOf(old_value).Type);
                self.addParameterTo(continuation, new_value.id);
                @field(output.carried, field.name) = new_value;
            }

            self.blocks[@intCast(source_block)].terminator_kind = .suspend_effect;
            self.blocks[@intCast(source_block)].site_id = Site.site_id;
            self.blocks[@intCast(source_block)].request_start = request_start;
            self.blocks[@intCast(source_block)].request_count = 1;
            self.blocks[@intCast(source_block)].continuation_target = continuation;
            self.blocks[@intCast(source_block)].continuation_argument_start =
                continuation_argument_start;
            self.blocks[@intCast(source_block)].continuation_argument_count =
                self.edge_argument_count - continuation_argument_start;
            self.blocks[@intCast(source_block)].resume_type = loweredType(Site.Resume);
            self.enterRaw(continuation);
            self.control_mutation_count += 1;
            return output;
        }

        pub fn returnValue(self: *Self, value: anytype) void {
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow block already has a terminator");
            }
            self.current().terminator_kind = .return_value;
            self.current().result_value = value.id;
            self.terminal_handoff_count += 1;
            self.return_handoff_count += 1;
            self.control_mutation_count += 1;
        }

        /// Terminate with the exact typed authored failure value.
        pub fn failValue(self: *Self, failure: anytype) void {
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow block already has a terminator");
            }
            self.current().terminator_kind = .fail_value;
            self.current().failure_value = failure.id;
            self.terminal_handoff_count += 1;
            self.control_mutation_count += 1;
        }

        fn finalizeInstructions(
            comptime snapshot: Self,
            operands: *const [snapshot.operand_count]boundary.ir.ValueId,
        ) [snapshot.instruction_count]boundary.ir.Instruction {
            var result: [snapshot.instruction_count]boundary.ir.Instruction = undefined;
            for (snapshot.instructions[0..snapshot.instruction_count], 0..) |draft, index| {
                result[index] = .{
                    .kind = draft.kind,
                    .result = draft.result,
                    .operands = operands[draft.operand_start .. draft.operand_start + draft.operand_count],
                    .operation = draft.operation,
                };
            }
            return result;
        }

        fn finalizeBlocks(
            comptime snapshot: Self,
            parameters: *const [snapshot.parameter_count]boundary.ir.ValueId,
            instructions: *const [snapshot.instruction_count]boundary.ir.Instruction,
            requests: *const [snapshot.request_count]boundary.ir.ValueId,
            edge_arguments: *const [snapshot.edge_argument_count]boundary.ir.EdgeArgument,
        ) [snapshot.block_count]boundary.ir.Block {
            var result: [snapshot.block_count]boundary.ir.Block = undefined;
            for (snapshot.blocks[0..snapshot.block_count], 0..) |draft, index| {
                const terminator: boundary.ir.Terminator = switch (draft.terminator_kind) {
                    .unset => @compileError("agent.Flow block lacks a terminator"),
                    .jump => .{ .jump = .{
                        .target = draft.jump_target,
                        .arguments = edge_arguments[draft.jump_argument_start .. draft.jump_argument_start + draft.jump_argument_count],
                    } },
                    .branch => .{ .branch = .{
                        .condition = draft.condition,
                        .then_edge = .{
                            .target = draft.then_target,
                            .arguments = edge_arguments[draft.then_argument_start .. draft.then_argument_start + draft.then_argument_count],
                        },
                        .else_edge = .{
                            .target = draft.else_target,
                            .arguments = edge_arguments[draft.else_argument_start .. draft.else_argument_start + draft.else_argument_count],
                        },
                    } },
                    .return_value => .{ .return_value = draft.result_value },
                    .fail_value => .{ .fail_value = draft.failure_value },
                    .suspend_effect => .{ .@"suspend" = .{
                        .kind = .effect,
                        .site_id = draft.site_id,
                        .request_values = requests[draft.request_start .. draft.request_start + draft.request_count],
                        .continuation = .{
                            .target = draft.continuation_target,
                            .arguments = edge_arguments[draft.continuation_argument_start .. draft.continuation_argument_start + draft.continuation_argument_count],
                        },
                        .resume_type = draft.resume_type,
                    } },
                };
                result[index] = .{
                    .id = draft.id,
                    .role = draft.role,
                    .parameters = parameters[draft.parameter_start .. draft.parameter_start + draft.parameter_count],
                    .instructions = instructions[draft.instruction_start .. draft.instruction_start + draft.instruction_count],
                    .terminator = terminator,
                };
            }
            return result;
        }

        /// Freeze the builder into one validated ordinary Boundary Control IR.
        pub fn finish(comptime self: Self, comptime Result: type) type {
            if (!self.started) @compileError("agent.Flow is empty");
            return struct {
                const snapshot = self;
                pub const schema_types = config.schema_types;
                const value_types = snapshot.value_types[0..snapshot.value_count].*;
                const operands = snapshot.operands[0..snapshot.operand_count].*;
                const parameters = snapshot.parameters[0..snapshot.parameter_count].*;
                const requests = snapshot.requests[0..snapshot.request_count].*;
                const edge_arguments = snapshot.edge_arguments[0..snapshot.edge_argument_count].*;
                const instructions = snapshot.finalizeInstructions(&operands);
                const blocks = snapshot.finalizeBlocks(
                    &parameters,
                    &instructions,
                    &requests,
                    &edge_arguments,
                );

                pub const control_ir: boundary.ir.Program = .{
                    .label = snapshot.label,
                    .value_types = &value_types,
                    .blocks = &blocks,
                    .entry = 0,
                    .result_type = Self.loweredType(Result),
                };

                comptime {
                    @setEvalBranchQuota(10_000_000);
                    boundary.ir.validate(
                        limits.maximum_values,
                        limits.maximum_blocks,
                        control_ir,
                    ) catch |err| @compileError(
                        "agent.Flow produced invalid Boundary Control IR: " ++
                            @errorName(err),
                    );
                }
            };
        }
    };
}
