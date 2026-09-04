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
    maximum_functions: usize = 32,
    maximum_values: usize = 256,
    maximum_blocks: usize = 128,
    maximum_instructions: usize = 512,
    maximum_operands: usize = 1024,
    maximum_parameters: usize = 512,
    maximum_requests: usize = 256,
    maximum_edge_arguments: usize = 512,
};

pub const Phase = enum {
    agent_initialization,
    agent_memory_projection,
    agent_prompt_render,
    agent_skill_activation,
    agent_tool_selection,
    agent_model_request,
    agent_model_resume,
    agent_action_name_match,
    agent_action_argument_decode,
    agent_action_admission,
    agent_tool_dispatch,
    agent_observation_fold,
    agent_final_admission,
    agent_completion,
    boundary_control,
    boundary_call,
    boundary_return,

    pub fn label(self: Phase) []const u8 {
        return switch (self) {
            .agent_initialization => "agent.initialization",
            .agent_memory_projection => "agent.memory_projection",
            .agent_prompt_render => "agent.prompt_render",
            .agent_skill_activation => "agent.skill_activation",
            .agent_tool_selection => "agent.tool_selection",
            .agent_model_request => "agent.model_request",
            .agent_model_resume => "agent.model_resume",
            .agent_action_name_match => "agent.action_name_match",
            .agent_action_argument_decode => "agent.action_argument_decode",
            .agent_action_admission => "agent.action_admission",
            .agent_tool_dispatch => "agent.tool_dispatch",
            .agent_observation_fold => "agent.observation_fold",
            .agent_final_admission => "agent.final_admission",
            .agent_completion => "agent.completion",
            .boundary_control => "boundary.control",
            .boundary_call => "boundary.call",
            .boundary_return => "boundary.return",
        };
    }
};

const TerminatorKind = enum {
    unset,
    jump,
    branch,
    suspend_effect,
    suspend_call,
    return_value,
    return_to_caller,
    fail_value,
};

const InstructionDraft = struct {
    kind: boundary.ir.InstructionKind,
    result: boundary.ir.ValueId,
    operand_start: usize,
    operand_count: usize,
    operation: boundary.ir.InstructionOperation,
    phase: Phase,
};

const BlockDraft = struct {
    id: boundary.ir.BlockId,
    function_id: boundary.ir.FunctionId = 0,
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
    callee_function: boundary.ir.FunctionId = 0,
    callee_target: boundary.ir.BlockId = 0,
    callee_argument_start: usize = 0,
    callee_argument_count: usize = 0,
    request_start: usize = 0,
    request_count: usize = 0,
    continuation_target: boundary.ir.BlockId = 0,
    continuation_argument_start: usize = 0,
    continuation_argument_count: usize = 0,
    resume_type: boundary.ir.ValueType = .{ .scalar = .unit },
    terminator_phase: Phase = .boundary_control,
    entered: bool = false,
};

const FunctionDraft = struct {
    id: boundary.ir.FunctionId = 0,
    entry: boundary.ir.BlockId = 0,
    result_type: boundary.ir.ValueType = .{ .scalar = .unit },
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

fn Helper(comptime ParameterTypes: anytype, comptime Result: type) type {
    return struct {
        pub const ResultType = Result;
        id: boundary.ir.FunctionId,
        entry: Block(ParameterTypes),
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
    @setEvalBranchQuota(10_000_000);
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
        functions: [limits.maximum_functions]FunctionDraft = undefined,
        function_count: usize = 0,
        parameters: [limits.maximum_parameters]boundary.ir.ValueId = undefined,
        parameter_count: usize = 0,
        requests: [limits.maximum_requests]boundary.ir.ValueId = undefined,
        request_count: usize = 0,
        edge_arguments: [limits.maximum_edge_arguments]boundary.ir.EdgeArgument = undefined,
        edge_argument_count: usize = 0,
        current_block: boundary.ir.BlockId = 0,
        current_function: boundary.ir.FunctionId = 0,
        started: bool = false,
        terminal_handoff_count: usize = 0,
        return_handoff_count: usize = 0,
        control_mutation_count: usize = 0,
        current_phase: Phase = .boundary_control,

        pub fn init(comptime label: []const u8) Self {
            if (label.len == 0) @compileError("agent.Flow label must not be empty");
            return .{ .label = label };
        }

        /// Set compiler-only attribution for subsequently emitted instructions
        /// and terminators. It never changes Control IR or BPI1 bytes.
        pub fn setPhase(self: *Self, comptime phase: Phase) void {
            self.current_phase = phase;
        }

        /// Number of external-effect suspensions emitted so far. Compiler-owned
        /// facades use this to reject effects introduced by pure lowering hooks.
        pub fn suspensionCount(self: *const Self) usize {
            return self.request_count;
        }

        /// Number of authored terminal handoffs emitted so far. Admission
        /// surfaces use the exact topology snapshots below to select which
        /// terminal kinds they permit.
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

        const SuspensionSnapshot = struct {
            count: usize,
            blocks: [limits.maximum_blocks]BlockDraft,
            request_count: usize,
            requests: [limits.maximum_requests]boundary.ir.ValueId,
        };

        const ReturnSnapshot = struct {
            count: usize,
            block_ids: [limits.maximum_blocks]boundary.ir.BlockId,
            result_values: [limits.maximum_blocks]boundary.ir.ValueId,
        };

        const ControlTopologySnapshot = struct {
            function_count: usize,
            functions: [limits.maximum_functions]FunctionDraft,
            block_count: usize,
            blocks: [limits.maximum_blocks]BlockDraft,
            parameter_count: usize,
            parameters: [limits.maximum_parameters]boundary.ir.ValueId,
            request_count: usize,
            requests: [limits.maximum_requests]boundary.ir.ValueId,
            edge_argument_count: usize,
            edge_arguments: [limits.maximum_edge_arguments]boundary.ir.EdgeArgument,
            current_block: boundary.ir.BlockId,
            current_function: boundary.ir.FunctionId,
            started: bool,
        };

        /// Exact effect topology visible to compiler-only hook admission.
        /// Unlike the diagnostic counters, this snapshot cannot be forged by
        /// decrementing one mutable field after emitting an effect.
        pub fn suspensionSnapshot(self: *const Self) SuspensionSnapshot {
            var result = SuspensionSnapshot{
                .count = 0,
                .blocks = [_]BlockDraft{.{
                    .id = 0,
                    .parameter_start = 0,
                    .instruction_start = 0,
                }} ** limits.maximum_blocks,
                .request_count = self.request_count,
                .requests = [_]boundary.ir.ValueId{0} ** limits.maximum_requests,
            };
            for (self.blocks[0..self.block_count]) |draft| {
                if (draft.terminator_kind != .suspend_effect) continue;
                result.blocks[result.count] = draft;
                result.blocks[result.count].instruction_start = 0;
                result.blocks[result.count].instruction_count = 0;
                result.count += 1;
            }
            @memcpy(result.requests[0..self.request_count], self.requests[0..self.request_count]);
            return result;
        }

        /// Exact successful-return topology visible to epistemic hook admission.
        pub fn returnSnapshot(self: *const Self) ReturnSnapshot {
            var result = ReturnSnapshot{
                .count = 0,
                .block_ids = [_]boundary.ir.BlockId{0} ** limits.maximum_blocks,
                .result_values = [_]boundary.ir.ValueId{0} ** limits.maximum_blocks,
            };
            for (self.blocks[0..self.block_count]) |draft| {
                if (draft.terminator_kind != .return_value) continue;
                result.block_ids[result.count] = draft.id;
                result.result_values[result.count] = draft.result_value;
                result.count += 1;
            }
            return result;
        }

        /// Exact compiler-owned control topology. Pure instructions are
        /// intentionally excluded so a decision-local hook can elaborate a
        /// value but cannot add, remove, or rewrite blocks and terminators.
        pub fn controlTopologySnapshot(self: *const Self) ControlTopologySnapshot {
            var result = ControlTopologySnapshot{
                .function_count = self.function_count,
                .functions = [_]FunctionDraft{.{}} ** limits.maximum_functions,
                .block_count = self.block_count,
                .blocks = [_]BlockDraft{.{
                    .id = 0,
                    .parameter_start = 0,
                    .instruction_start = 0,
                }} ** limits.maximum_blocks,
                .parameter_count = self.parameter_count,
                .parameters = [_]boundary.ir.ValueId{0} ** limits.maximum_parameters,
                .request_count = self.request_count,
                .requests = [_]boundary.ir.ValueId{0} ** limits.maximum_requests,
                .edge_argument_count = self.edge_argument_count,
                .edge_arguments = [_]boundary.ir.EdgeArgument{.{ .value = 0 }} ** limits.maximum_edge_arguments,
                .current_block = self.current_block,
                .current_function = self.current_function,
                .started = self.started,
            };
            @memcpy(
                result.functions[0..self.function_count],
                self.functions[0..self.function_count],
            );
            for (self.blocks[0..self.block_count], 0..) |draft, index| {
                result.blocks[index] = draft;
                result.blocks[index].instruction_start = 0;
                result.blocks[index].instruction_count = 0;
            }
            @memcpy(result.parameters[0..self.parameter_count], self.parameters[0..self.parameter_count]);
            @memcpy(result.requests[0..self.request_count], self.requests[0..self.request_count]);
            @memcpy(result.edge_arguments[0..self.edge_argument_count], self.edge_arguments[0..self.edge_argument_count]);
            return result;
        }

        pub fn dataPrefixIsPreserved(
            self: *const Self,
            before: *const Self,
        ) bool {
            if (self.value_count < before.value_count or
                self.instruction_count < before.instruction_count or
                self.operand_count < before.operand_count or
                self.block_count < before.block_count or
                self.function_count < before.function_count or
                self.parameter_count < before.parameter_count or
                self.request_count < before.request_count or
                self.edge_argument_count < before.edge_argument_count or
                self.current_phase != before.current_phase)
            {
                return false;
            }
            for (self.value_types[0..before.value_count], 0..) |value, index| {
                if (!std.meta.eql(value, before.value_types[index])) return false;
            }
            for (self.instructions[0..before.instruction_count], 0..) |value, index| {
                if (!std.meta.eql(value, before.instructions[index])) return false;
            }
            if (!std.mem.eql(
                boundary.ir.ValueId,
                self.operands[0..before.operand_count],
                before.operands[0..before.operand_count],
            )) return false;
            for (self.functions[0..before.function_count], 0..) |value, index| {
                if (!std.meta.eql(value, before.functions[index])) return false;
            }
            for (self.blocks[0..before.block_count], 0..) |value, index| {
                if (value.id == before.current_block) continue;
                if (!std.meta.eql(value, before.blocks[index])) return false;
            }
            if (!std.mem.eql(
                boundary.ir.ValueId,
                self.parameters[0..before.parameter_count],
                before.parameters[0..before.parameter_count],
            )) return false;
            if (!std.mem.eql(
                boundary.ir.ValueId,
                self.requests[0..before.request_count],
                before.requests[0..before.request_count],
            )) return false;
            for (self.edge_arguments[0..before.edge_argument_count], 0..) |value, index| {
                if (!std.meta.eql(value, before.edge_arguments[index])) return false;
            }
            return true;
        }

        pub fn counts(self: *const Self) struct {
            values: usize,
            blocks: usize,
            functions: usize,
            instructions: usize,
        } {
            return .{
                .values = self.value_count,
                .blocks = self.block_count,
                .functions = self.function_count,
                .instructions = self.instruction_count,
            };
        }

        fn failLimit(comptime message: []const u8) noreturn {
            @compileError("agent.Flow " ++ message);
        }

        fn LoweredType(comptime T: type) type {
            return struct {
                pub const value: boundary.ir.ValueType = blk: {
                    boundary.schema.assertPortable(T);
                    if (T == void) break :blk .{ .scalar = .unit };
                    if (T == bool) break :blk .{ .scalar = .boolean };
                    if (T == i8) break :blk .{ .scalar = .i8 };
                    if (T == i16) break :blk .{ .scalar = .i16 };
                    if (T == i32) break :blk .{ .scalar = .i32 };
                    if (T == i64) break :blk .{ .scalar = .i64 };
                    if (T == u8) break :blk .{ .scalar = .u8 };
                    if (T == u16) break :blk .{ .scalar = .u16 };
                    if (T == u32) break :blk .{ .scalar = .u32 };
                    if (T == u64) break :blk .{ .scalar = .u64 };
                    for (config.schema_types, 0..) |Schema, index| {
                        if (T == Schema) break :blk .{ .schema = @intCast(index) };
                    }
                    @compileError(
                        "agent.Flow structured type is absent from config.schema_types: " ++
                            @typeName(T),
                    );
                };
            };
        }

        fn loweredType(comptime T: type) boundary.ir.ValueType {
            return LoweredType(T).value;
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

        fn addBlock(
            self: *Self,
            role: boundary.ir.BlockRole,
            function_id: boundary.ir.FunctionId,
        ) boundary.ir.BlockId {
            if (self.block_count >= limits.maximum_blocks) {
                failLimit("maximum_blocks exceeded");
            }
            const id: boundary.ir.BlockId = @intCast(self.block_count);
            self.blocks[self.block_count] = .{
                .id = id,
                .function_id = function_id,
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
            self.current_function = draft.function_id;
        }

        /// Begin the root function with one typed InitialArgs parameter.
        pub fn begin(self: *Self, comptime InitialArgs: type) Value(InitialArgs) {
            if (self.started) @compileError("agent.Flow may begin only once");
            self.started = true;
            self.function_count = 1;
            const entry = self.addBlock(.loop_header, 0);
            self.functions[0] = .{ .id = 0, .entry = entry };
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
            const id = self.addBlock(role, self.current_function);
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

        /// Declare one private typed helper function. Numeric function and
        /// entry-block identities remain compiler-owned.
        pub fn helper(
            self: *Self,
            comptime ParameterTypes: anytype,
            comptime Result: type,
        ) Helper(ParameterTypes, Result) {
            if (!self.started) @compileError("agent.Flow must begin before declaring a helper");
            if (self.function_count >= limits.maximum_functions) {
                failLimit("maximum_functions exceeded");
            }
            const id: boundary.ir.FunctionId = @intCast(self.function_count);
            const entry_id = self.addBlock(.segment, id);
            var result: Helper(ParameterTypes, Result) = .{
                .id = id,
                .entry = .{ .id = entry_id, .parameters = undefined },
            };
            inline for (ParameterTypes, 0..) |T, index| {
                const parameter = self.addValue(T);
                self.addParameterTo(entry_id, parameter.id);
                result.entry.parameters[index] = parameter;
            }
            self.functions[self.function_count] = .{
                .id = id,
                .entry = entry_id,
                .result_type = loweredType(Result),
            };
            self.function_count += 1;
            self.control_mutation_count += 1;
            return result;
        }

        /// Compiler-only helper handle type for generic staged emitters.
        pub fn HelperType(
            comptime ParameterTypes: anytype,
            comptime Result: type,
        ) type {
            return Helper(ParameterTypes, Result);
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
                .phase = self.current_phase,
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
            const expected = @typeInfo(Product).@"struct".fields.len;
            const observed = @typeInfo(@TypeOf(fields)).@"struct".fields.len;
            if (expected != observed) {
                @compileError(std.fmt.comptimePrint(
                    "agent.Flow productConstruct {s} expected {d} fields, observed {d}",
                    .{ @typeName(Product), expected, observed },
                ));
            }
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

        pub fn sumExtractOrFail(
            self: *Self,
            comptime variant_index: u16,
            sum: anytype,
            invalid_variant: anytype,
        ) Value(@typeInfo(@TypeOf(sum).Type).@"union".fields[variant_index].type) {
            const Payload = @typeInfo(@TypeOf(sum).Type).@"union".fields[variant_index].type;
            return self.instruction(
                Payload,
                .pure,
                .{ .sum_extract = variant_index },
                .{ sum, invalid_variant },
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

        pub fn integerAddOrFail(
            self: *Self,
            left: anytype,
            right: @TypeOf(left),
            overflow_failure: anytype,
        ) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_add,
                .{ left, right, overflow_failure },
            );
        }

        pub fn integerMultiplyOrFail(
            self: *Self,
            left: anytype,
            right: @TypeOf(left),
            overflow_failure: anytype,
        ) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_multiply,
                .{ left, right, overflow_failure },
            );
        }

        pub fn integerDivideOrFail(
            self: *Self,
            left: anytype,
            right: @TypeOf(left),
            overflow_failure: anytype,
            division_by_zero_failure: @TypeOf(overflow_failure),
        ) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_divide,
                .{ left, right, overflow_failure, division_by_zero_failure },
            );
        }

        pub fn integerRemainderOrFail(
            self: *Self,
            left: anytype,
            right: @TypeOf(left),
            overflow_failure: anytype,
            division_by_zero_failure: @TypeOf(overflow_failure),
        ) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_remainder,
                .{ left, right, overflow_failure, division_by_zero_failure },
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

        pub fn integerSubtractOrFail(
            self: *Self,
            left: anytype,
            right: @TypeOf(left),
            overflow_failure: anytype,
        ) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_subtract,
                .{ left, right, overflow_failure },
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

        pub fn integerNotEqual(self: *Self, left: anytype, right: @TypeOf(left)) Value(bool) {
            return self.instruction(bool, .pure, .integer_not_equal, .{ left, right });
        }

        pub fn integerLessThan(self: *Self, left: anytype, right: @TypeOf(left)) Value(bool) {
            return self.instruction(bool, .pure, .integer_less_than, .{ left, right });
        }

        pub fn integerLessEqual(self: *Self, left: anytype, right: @TypeOf(left)) Value(bool) {
            return self.instruction(bool, .pure, .integer_less_equal, .{ left, right });
        }

        pub fn integerGreaterThan(self: *Self, left: anytype, right: @TypeOf(left)) Value(bool) {
            return self.instruction(bool, .pure, .integer_greater_than, .{ left, right });
        }

        pub fn integerBitAnd(self: *Self, left: anytype, right: @TypeOf(left)) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_bit_and,
                .{ left, right },
            );
        }

        pub fn integerBitOr(self: *Self, left: anytype, right: @TypeOf(left)) @TypeOf(left) {
            return self.instruction(
                @TypeOf(left).Type,
                .pure,
                .integer_bit_or,
                .{ left, right },
            );
        }

        /// Compare two bounded UTF-8 Text values using Boundary's canonical
        /// bytewise ordering. The result is negative, zero, or positive.
        pub fn textCompare(self: *Self, left: anytype, right: anytype) Value(i8) {
            const Left = @TypeOf(left).Type;
            const Right = @TypeOf(right).Type;
            if (comptime !boundary.schema.isTextType(Left) or
                !boundary.schema.isTextType(Right))
            {
                @compileError("agent.Flow textCompare requires Text values");
            }
            return self.instruction(i8, .pure, .text_compare, .{ left, right });
        }

        pub fn textEmpty(self: *Self, comptime Text: type) Value(Text) {
            if (comptime !boundary.schema.isTextType(Text)) {
                @compileError("agent.Flow textEmpty requires a Text type");
            }
            return self.instruction(Text, .pure, .text_empty, .{});
        }

        pub fn textLength(self: *Self, text: anytype) Value(u32) {
            if (comptime !boundary.schema.isTextType(@TypeOf(text).Type)) {
                @compileError("agent.Flow textLength requires a Text value");
            }
            return self.instruction(u32, .pure, .text_length, .{text});
        }

        pub fn textAppendOrFail(
            self: *Self,
            text: anytype,
            suffix: anytype,
            capacity_failure: anytype,
        ) @TypeOf(text) {
            const Text = @TypeOf(text).Type;
            const Suffix = @TypeOf(suffix).Type;
            if (comptime !boundary.schema.isTextType(Text) or
                !boundary.schema.isTextType(Suffix))
            {
                @compileError("agent.Flow textAppendOrFail requires Text values");
            }
            return self.instruction(
                Text,
                .pure,
                .text_append,
                .{ text, suffix, capacity_failure },
            );
        }

        pub fn textAppendUnsignedOrFail(
            self: *Self,
            text: anytype,
            value: anytype,
            capacity_failure: anytype,
        ) @TypeOf(text) {
            const Integer = @TypeOf(value).Type;
            if (comptime @typeInfo(Integer) != .int or
                @typeInfo(Integer).int.signedness != .unsigned)
            {
                @compileError("agent.Flow textAppendUnsignedOrFail requires an unsigned integer");
            }
            return self.instruction(
                @TypeOf(text).Type,
                .pure,
                .text_append_unsigned,
                .{ text, value, capacity_failure },
            );
        }

        pub fn textAppendSignedOrFail(
            self: *Self,
            text: anytype,
            value: anytype,
            capacity_failure: anytype,
        ) @TypeOf(text) {
            const Integer = @TypeOf(value).Type;
            if (comptime @typeInfo(Integer) != .int or
                @typeInfo(Integer).int.signedness != .signed)
            {
                @compileError("agent.Flow textAppendSignedOrFail requires a signed integer");
            }
            return self.instruction(
                @TypeOf(text).Type,
                .pure,
                .text_append_signed,
                .{ text, value, capacity_failure },
            );
        }

        pub fn textAppendScalarOrFail(
            self: *Self,
            text: anytype,
            scalar: Value(u32),
            capacity_failure: anytype,
            utf8_failure: @TypeOf(capacity_failure),
        ) @TypeOf(text) {
            return self.instruction(
                @TypeOf(text).Type,
                .pure,
                .text_append_scalar,
                .{ text, scalar, capacity_failure, utf8_failure },
            );
        }

        /// Project one canonical UTF-8 byte and map an invalid index to the
        /// exact authored Failure value supplied by the caller.
        pub fn textByteAt(
            self: *Self,
            text: anytype,
            index: Value(u32),
            invalid_index: anytype,
        ) Value(u8) {
            if (comptime !boundary.schema.isTextType(@TypeOf(text).Type)) {
                @compileError("agent.Flow textByteAt requires a Text value");
            }
            return self.instruction(
                u8,
                .pure,
                .text_byte_at,
                .{ text, index, invalid_index },
            );
        }

        pub fn textToBytes(
            self: *Self,
            comptime Bytes: type,
            text: anytype,
        ) Value(Bytes) {
            const Text = @TypeOf(text).Type;
            if (comptime !boundary.schema.isTextType(Text) or
                !boundary.schema.isBytesType(Bytes) or
                Bytes.maximum_length < Text.maximum_length)
            {
                @compileError("agent.Flow textToBytes requires capacity-compatible Text -> Bytes");
            }
            return self.instruction(Bytes, .pure, .text_to_bytes, .{text});
        }

        pub fn textCopyOrFail(
            self: *Self,
            comptime Result: type,
            text: anytype,
            start: Value(u32),
            end: Value(u32),
            capacity_failure: anytype,
            utf8_failure: @TypeOf(capacity_failure),
        ) Value(Result) {
            if (comptime !boundary.schema.isTextType(Result) or
                !boundary.schema.isTextType(@TypeOf(text).Type))
            {
                @compileError("agent.Flow textCopyOrFail requires Text types");
            }
            return self.instruction(
                Result,
                .pure,
                .text_copy,
                .{ text, start, end, capacity_failure, utf8_failure },
            );
        }

        pub fn integerConvert(
            self: *Self,
            comptime Result: type,
            value: anytype,
        ) Value(Result) {
            if (comptime @typeInfo(Result) != .int or
                @typeInfo(@TypeOf(value).Type) != .int)
            {
                @compileError("agent.Flow integerConvert requires integer types");
            }
            return self.instruction(Result, .pure, .integer_convert, .{value});
        }

        pub fn integerConvertOrFail(
            self: *Self,
            comptime Result: type,
            value: anytype,
            overflow_failure: anytype,
        ) Value(Result) {
            if (comptime @typeInfo(Result) != .int or
                @typeInfo(@TypeOf(value).Type) != .int)
            {
                @compileError("agent.Flow integerConvertOrFail requires integer types");
            }
            return self.instruction(
                Result,
                .pure,
                .integer_convert,
                .{ value, overflow_failure },
            );
        }

        /// Project an exhaustive portable enum to the canonical u32 tag used
        /// by Boundary encoding.
        pub fn enumToU32(self: *Self, value: anytype) Value(u32) {
            const Enum = @TypeOf(value).Type;
            if (comptime @typeInfo(Enum) != .@"enum") {
                @compileError("agent.Flow enumToU32 requires an enum value");
            }
            return self.instruction(u32, .pure, .enum_to_u32, .{value});
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
            if (comptime @TypeOf(payload).Type == void) {
                return self.instruction(
                    Sum,
                    .pure,
                    .{ .sum_construct = variant_index },
                    .{},
                );
            }
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

        pub fn vectorGetOrFail(
            self: *Self,
            vector: anytype,
            index: Value(u32),
            invalid_index: anytype,
        ) Value(@TypeOf(vector).Type.ElementType) {
            return self.instruction(
                @TypeOf(vector).Type.ElementType,
                .pure,
                .vector_get,
                .{ vector, index, invalid_index },
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

        pub fn vectorPushOrFail(
            self: *Self,
            vector: anytype,
            element: anytype,
            capacity_failure: anytype,
        ) @TypeOf(vector) {
            return self.instruction(
                @TypeOf(vector).Type,
                .pure,
                .vector_push,
                .{ vector, element, capacity_failure },
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

        pub fn bytesEmpty(self: *Self, comptime Bytes: type) Value(Bytes) {
            if (comptime !boundary.schema.isBytesType(Bytes)) {
                @compileError("agent.Flow bytesEmpty requires a Bytes type");
            }
            return self.instruction(Bytes, .pure, .bytes_empty, .{});
        }

        pub fn bytesLength(self: *Self, bytes: anytype) Value(u32) {
            if (comptime !boundary.schema.isBytesType(@TypeOf(bytes).Type)) {
                @compileError("agent.Flow bytesLength requires a Bytes value");
            }
            return self.instruction(u32, .pure, .bytes_length, .{bytes});
        }

        pub fn bytesByteAt(
            self: *Self,
            bytes: anytype,
            index: Value(u32),
            invalid_index: anytype,
        ) Value(u8) {
            if (comptime !boundary.schema.isBytesType(@TypeOf(bytes).Type)) {
                @compileError("agent.Flow bytesByteAt requires a Bytes value");
            }
            return self.instruction(
                u8,
                .pure,
                .bytes_byte_at,
                .{ bytes, index, invalid_index },
            );
        }

        pub fn bytesAppendOrFail(
            self: *Self,
            bytes: anytype,
            suffix: anytype,
            capacity_failure: anytype,
        ) @TypeOf(bytes) {
            return self.instruction(
                @TypeOf(bytes).Type,
                .pure,
                .bytes_append,
                .{ bytes, suffix, capacity_failure },
            );
        }

        pub fn bytesAppendScalarOrFail(
            self: *Self,
            bytes: anytype,
            scalar: Value(u8),
            capacity_failure: anytype,
        ) @TypeOf(bytes) {
            return self.instruction(
                @TypeOf(bytes).Type,
                .pure,
                .bytes_append_scalar,
                .{ bytes, scalar, capacity_failure },
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
            self.current().terminator_phase = self.current_phase;
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
            self.current().terminator_phase = self.current_phase;
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

            const continuation = self.addBlock(.after_handler, self.current_function);
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
            self.blocks[@intCast(source_block)].terminator_phase = self.current_phase;
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

        /// Call one declared private helper and enter its typed continuation.
        pub fn call(
            self: *Self,
            helper_function: anytype,
            arguments: anytype,
            carry: anytype,
        ) PerformOutput(@TypeOf(helper_function).ResultType, @TypeOf(carry)) {
            const source_block = self.current_block;
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow call follows a terminated block");
            }
            if (helper_function.id == 0 or
                @as(usize, helper_function.id) >= self.function_count)
            {
                @compileError("agent.Flow call requires one declared private helper");
            }
            const callee = self.appendValueArguments(
                helper_function.entry,
                arguments,
            );
            const continuation_argument_start = self.edge_argument_count;
            self.appendEdgeArgument(.@"resume");
            inline for (carry) |value| {
                self.appendEdgeArgument(.{ .value = value.id });
            }

            const continuation = self.addBlock(.call_return, self.current_function);
            const Resume = @TypeOf(helper_function).ResultType;
            var output: PerformOutput(Resume, @TypeOf(carry)) = undefined;
            output.value = self.addValue(Resume);
            self.addParameterTo(continuation, output.value.id);
            inline for (std.meta.fields(@TypeOf(carry))) |field| {
                const old_value = @field(carry, field.name);
                const new_value = self.addValue(@TypeOf(old_value).Type);
                self.addParameterTo(continuation, new_value.id);
                @field(output.carried, field.name) = new_value;
            }

            const draft = &self.blocks[@intCast(source_block)];
            draft.terminator_kind = .suspend_call;
            draft.terminator_phase = self.current_phase;
            draft.callee_function = helper_function.id;
            draft.callee_target = helper_function.entry.id;
            draft.callee_argument_start = callee.start;
            draft.callee_argument_count = callee.count;
            draft.continuation_target = continuation;
            draft.continuation_argument_start = continuation_argument_start;
            draft.continuation_argument_count =
                self.edge_argument_count - continuation_argument_start;
            draft.resume_type = loweredType(Resume);
            self.enterRaw(continuation);
            self.control_mutation_count += 1;
            return output;
        }

        pub fn returnValue(self: *Self, value: anytype) void {
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow block already has a terminator");
            }
            self.current().terminator_kind = .return_value;
            self.current().terminator_phase = self.current_phase;
            self.current().result_value = value.id;
            self.terminal_handoff_count += 1;
            self.return_handoff_count += 1;
            self.control_mutation_count += 1;
        }

        /// Return one exact typed value from a private helper.
        pub fn returnToCaller(self: *Self, value: anytype) void {
            if (self.current_function == 0) {
                @compileError("agent.Flow root function must use returnValue");
            }
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow block already has a terminator");
            }
            const function = self.functions[@intCast(self.current_function)];
            if (!loweredType(@TypeOf(value).Type).eql(function.result_type)) {
                @compileError("agent.Flow helper return type mismatch");
            }
            self.current().terminator_kind = .return_to_caller;
            self.current().terminator_phase = self.current_phase;
            self.current().result_value = value.id;
            self.control_mutation_count += 1;
        }

        /// Terminate with the exact typed authored failure value.
        pub fn failValue(self: *Self, failure: anytype) void {
            if (self.current().terminator_kind != .unset) {
                @compileError("agent.Flow block already has a terminator");
            }
            self.current().terminator_kind = .fail_value;
            self.current().terminator_phase = self.current_phase;
            self.current().failure_value = failure.id;
            self.terminal_handoff_count += 1;
            self.control_mutation_count += 1;
        }

        fn finalizeInstructions(
            comptime snapshot: Self,
            operands: *const [snapshot.operand_count]boundary.ir.ValueId,
        ) [snapshot.instruction_count]boundary.ir.Instruction {
            @setEvalBranchQuota(100_000_000);
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
            @setEvalBranchQuota(100_000_000);
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
                    .return_to_caller => .{ .return_to_caller = draft.result_value },
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
                    .suspend_call => .{ .@"suspend" = .{
                        .kind = .call,
                        .callee_function = draft.callee_function,
                        .callee = .{
                            .target = draft.callee_target,
                            .arguments = edge_arguments[draft.callee_argument_start .. draft.callee_argument_start + draft.callee_argument_count],
                        },
                        .continuation = .{
                            .target = draft.continuation_target,
                            .arguments = edge_arguments[draft.continuation_argument_start .. draft.continuation_argument_start + draft.continuation_argument_count],
                        },
                        .resume_type = draft.resume_type,
                    } },
                };
                result[index] = .{
                    .id = draft.id,
                    .function_id = draft.function_id,
                    .role = draft.role,
                    .parameters = parameters[draft.parameter_start .. draft.parameter_start + draft.parameter_count],
                    .instructions = instructions[draft.instruction_start .. draft.instruction_start + draft.instruction_count],
                    .terminator = terminator,
                };
            }
            return result;
        }

        fn finalizeFunctions(
            comptime snapshot: Self,
            comptime RootResult: type,
        ) [if (snapshot.function_count == 1) 0 else snapshot.function_count]boundary.ir.Function {
            @setEvalBranchQuota(100_000_000);
            const count = if (snapshot.function_count == 1)
                0
            else
                snapshot.function_count;
            var result: [count]boundary.ir.Function = undefined;
            if (count == 0) return result;
            for (snapshot.functions[0..snapshot.function_count], 0..) |draft, index| {
                result[index] = .{
                    .id = draft.id,
                    .entry = draft.entry,
                    .result_type = if (index == 0)
                        Self.loweredType(RootResult)
                    else
                        draft.result_type,
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
                const functions = snapshot.finalizeFunctions(Result);
                const instruction_phases = blk: {
                    @setEvalBranchQuota(100_000_000);
                    var result: [snapshot.instruction_count]Phase = undefined;
                    for (
                        snapshot.instructions[0..snapshot.instruction_count],
                        0..,
                    ) |draft, index| {
                        result[index] = draft.phase;
                    }
                    break :blk result;
                };
                const block_instruction_starts = blk: {
                    @setEvalBranchQuota(100_000_000);
                    var result: [snapshot.block_count]u32 = undefined;
                    for (snapshot.blocks[0..snapshot.block_count], 0..) |draft, index| {
                        result[index] = @intCast(draft.instruction_start);
                    }
                    break :blk result;
                };
                const block_instruction_counts = blk: {
                    @setEvalBranchQuota(100_000_000);
                    var result: [snapshot.block_count]u32 = undefined;
                    for (snapshot.blocks[0..snapshot.block_count], 0..) |draft, index| {
                        result[index] = @intCast(draft.instruction_count);
                    }
                    break :blk result;
                };
                const block_terminator_phases = blk: {
                    @setEvalBranchQuota(100_000_000);
                    var result: [snapshot.block_count]Phase = undefined;
                    for (snapshot.blocks[0..snapshot.block_count], 0..) |draft, index| {
                        result[index] = draft.terminator_phase;
                    }
                    break :blk result;
                };

                pub const SourcePhaseMap = struct {
                    instruction_phases: [snapshot.instruction_count]Phase,
                    block_instruction_starts: [snapshot.block_count]u32,
                    block_instruction_counts: [snapshot.block_count]u32,
                    block_terminator_phases: [snapshot.block_count]Phase,
                };

                pub const source_phase_map: SourcePhaseMap = .{
                    .instruction_phases = instruction_phases,
                    .block_instruction_starts = block_instruction_starts,
                    .block_instruction_counts = block_instruction_counts,
                    .block_terminator_phases = block_terminator_phases,
                };

                pub const control_ir: boundary.ir.Program = .{
                    .label = snapshot.label,
                    .value_types = &value_types,
                    .blocks = &blocks,
                    .entry = 0,
                    .result_type = Self.loweredType(Result),
                    .functions = &functions,
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
