const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const Research = @import("research_agent");

const Definition = Research.Definition;
const Strategy = agent.strategy.react(.{});
const History = agent.strategy.History(Definition);
const State = agent.strategy.State(Definition);
const DecisionRequest = Strategy.DecisionRequestType(Definition);
const ActionCatalog = agent.strategy.ActionCatalog(Definition);

const machine_options: boundary.MachineOptions = .{
    .maximum_frames = 64,
    .maximum_state_bytes = 4 * 1024 * 1024,
    .maximum_machine_fuel = 10_000_000,
};

pub const Generated = agent.compile(
    Definition,
    Strategy,
    .{ .machine = machine_options },
);

const reference_value_types = [_]boundary.ir.ValueType{
    .{ .schema = 0 },
    .{ .schema = 6 },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .schema = 7 },
    .{ .schema = 7 },
    .{ .schema = 5 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .scalar = .boolean },
    .{ .scalar = .boolean },
    .{ .schema = 7 },
    .{ .schema = 4 },
    .{ .schema = 9 },
    .{ .schema = 10 },
    .{ .schema = 0 },
    .{ .schema = 6 },
    .{ .schema = 5 },
    .{ .schema = 11 },
    .{ .schema = 8 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .schema = 5 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .schema = 5 },
    .{ .schema = 0 },
    .{ .schema = 6 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .scalar = .boolean },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .schema = 4 },
    .{ .schema = 6 },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .schema = 4 },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .schema = 0 },
    .{ .schema = 6 },
    .{ .schema = 5 },
    .{ .schema = 2 },
    .{ .scalar = .u32 },
    .{ .schema = 6 },
    .{ .schema = 2 },
    .{ .schema = 0 },
    .{ .schema = 5 },
    .{ .schema = 6 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .scalar = .boolean },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .schema = 4 },
    .{ .schema = 6 },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .schema = 4 },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .schema = 0 },
    .{ .schema = 6 },
    .{ .schema = 5 },
    .{ .schema = 2 },
    .{ .scalar = .u32 },
    .{ .schema = 6 },
    .{ .schema = 2 },
    .{ .schema = 0 },
    .{ .schema = 5 },
    .{ .schema = 6 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .scalar = .boolean },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .scalar = .boolean },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .schema = 4 },
    .{ .schema = 6 },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .scalar = .boolean },
    .{ .schema = 4 },
    .{ .scalar = .u32 },
    .{ .schema = 7 },
    .{ .schema = 0 },
    .{ .schema = 6 },
    .{ .schema = 5 },
    .{ .schema = 2 },
    .{ .scalar = .u32 },
    .{ .schema = 6 },
    .{ .schema = 2 },
    .{ .schema = 0 },
    .{ .schema = 5 },
    .{ .schema = 6 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .scalar = .u32 },
    .{ .scalar = .u32 },
    .{ .schema = 5 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .schema = 1 },
    .{ .schema = 7 },
    .{ .scalar = .boolean },
    .{ .schema = 3 },
    .{ .schema = 4 },
};

const reference_blocks = [_]boundary.ir.Block{
    .{ .id = 0, .role = .loop_header, .parameters = &.{0}, .instructions = &.{
        .{ .kind = .pure, .result = 1, .operands = &.{}, .operation = .vector_empty },
        .{ .kind = .constant, .result = 2, .operands = &.{}, .operation = .{ .constant = 2 } },
        .{ .kind = .pure, .result = 3, .operands = &.{ 2, 2, 2, 2 }, .operation = .product_construct },
        .{ .kind = .pure, .result = 4, .operands = &.{ 0, 1, 3 }, .operation = .product_construct },
    }, .terminator = .{ .jump = .{ .target = 1, .arguments = &.{.{ .value = 4 }} } } },
    .{ .id = 1, .role = .loop_header, .parameters = &.{5}, .instructions = &.{
        .{ .kind = .pure, .result = 6, .operands = &.{5}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 7, .operands = &.{6}, .operation = .{ .product_extract = 0 } },
        .{ .kind = .pure, .result = 8, .operands = &.{6}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .constant, .result = 9, .operands = &.{}, .operation = .{ .constant = 4 } },
        .{ .kind = .constant, .result = 10, .operands = &.{}, .operation = .{ .constant = 5 } },
        .{ .kind = .pure, .result = 11, .operands = &.{ 7, 9 }, .operation = .integer_greater_equal },
        .{ .kind = .pure, .result = 12, .operands = &.{ 8, 10 }, .operation = .integer_greater_equal },
        .{ .kind = .pure, .result = 13, .operands = &.{ 11, 12 }, .operation = .boolean_or },
    }, .terminator = .{ .branch = .{ .condition = 13, .then_edge = .{ .target = 2, .arguments = &.{} }, .else_edge = .{ .target = 3, .arguments = &.{.{ .value = 5 }} } } } },
    .{ .id = 2, .role = .terminal_handoff, .parameters = &.{}, .instructions = &.{
        .{ .kind = .constant, .result = 15, .operands = &.{}, .operation = .{ .constant = 10 } },
    }, .terminator = .{ .fail_value = 15 } },
    .{ .id = 3, .role = .segment, .parameters = &.{14}, .instructions = &.{
        .{ .kind = .constant, .result = 16, .operands = &.{}, .operation = .{ .constant = 0 } },
        .{ .kind = .constant, .result = 17, .operands = &.{}, .operation = .{ .constant = 1 } },
        .{ .kind = .pure, .result = 18, .operands = &.{14}, .operation = .{ .product_extract = 0 } },
        .{ .kind = .pure, .result = 19, .operands = &.{14}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 20, .operands = &.{14}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .constant, .result = 21, .operands = &.{}, .operation = .{ .constant = 9 } },
        .{ .kind = .pure, .result = 22, .operands = &.{ 16, 17, 18, 20, 21, 19 }, .operation = .product_construct },
    }, .terminator = .{ .@"suspend" = .{ .kind = .effect, .site_id = 0, .request_values = &.{22}, .continuation = .{ .target = 4, .arguments = &.{ .@"resume", .{ .value = 14 } } }, .resume_type = .{ .schema = 1 } } } },
    .{ .id = 4, .role = .after_handler, .parameters = &.{ 23, 24 }, .instructions = &.{
        .{ .kind = .pure, .result = 25, .operands = &.{24}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 26, .operands = &.{25}, .operation = .{ .product_extract = 0 } },
        .{ .kind = .pure, .result = 27, .operands = &.{25}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .constant, .result = 28, .operands = &.{}, .operation = .{ .constant = 3 } },
        .{ .kind = .pure, .result = 29, .operands = &.{ 26, 28 }, .operation = .integer_add },
        .{ .kind = .pure, .result = 30, .operands = &.{ 27, 28 }, .operation = .integer_add },
        .{ .kind = .pure, .result = 31, .operands = &.{ 25, 29 }, .operation = .{ .product_replace = 0 } },
        .{ .kind = .pure, .result = 32, .operands = &.{ 31, 30 }, .operation = .{ .product_replace = 1 } },
        .{ .kind = .pure, .result = 33, .operands = &.{24}, .operation = .{ .product_extract = 0 } },
        .{ .kind = .pure, .result = 34, .operands = &.{24}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 35, .operands = &.{ 33, 34, 32 }, .operation = .product_construct },
        .{ .kind = .pure, .result = 40, .operands = &.{23}, .operation = .{ .sum_tag_is = 0 } },
    }, .terminator = .{ .branch = .{ .condition = 40, .then_edge = .{ .target = 5, .arguments = &.{ .{ .value = 23 }, .{ .value = 35 } } }, .else_edge = .{ .target = 6, .arguments = &.{ .{ .value = 23 }, .{ .value = 35 } } } } } },
    .{ .id = 5, .role = .segment, .parameters = &.{ 36, 37 }, .instructions = &.{
        .{ .kind = .pure, .result = 41, .operands = &.{36}, .operation = .{ .sum_extract = 0 } },
        .{ .kind = .pure, .result = 42, .operands = &.{37}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 43, .operands = &.{42}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .constant, .result = 44, .operands = &.{}, .operation = .{ .constant = 6 } },
        .{ .kind = .pure, .result = 45, .operands = &.{ 43, 44 }, .operation = .integer_greater_equal },
    }, .terminator = .{ .branch = .{ .condition = 45, .then_edge = .{ .target = 7, .arguments = &.{} }, .else_edge = .{ .target = 8, .arguments = &.{ .{ .value = 41 }, .{ .value = 37 } } } } } },
    .{ .id = 6, .role = .segment, .parameters = &.{ 38, 39 }, .instructions = &.{
        .{ .kind = .pure, .result = 76, .operands = &.{38}, .operation = .{ .sum_tag_is = 1 } },
    }, .terminator = .{ .branch = .{ .condition = 76, .then_edge = .{ .target = 13, .arguments = &.{ .{ .value = 38 }, .{ .value = 39 } } }, .else_edge = .{ .target = 14, .arguments = &.{ .{ .value = 38 }, .{ .value = 39 } } } } } },
    .{ .id = 7, .role = .terminal_handoff, .parameters = &.{}, .instructions = &.{
        .{ .kind = .constant, .result = 48, .operands = &.{}, .operation = .{ .constant = 10 } },
    }, .terminator = .{ .fail_value = 48 } },
    .{ .id = 8, .role = .segment, .parameters = &.{ 46, 47 }, .instructions = &.{
        .{ .kind = .pure, .result = 49, .operands = &.{47}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 52, .operands = &.{49}, .operation = .vector_length },
        .{ .kind = .constant, .result = 53, .operands = &.{}, .operation = .{ .constant = 8 } },
        .{ .kind = .pure, .result = 54, .operands = &.{ 52, 53 }, .operation = .integer_greater_equal },
    }, .terminator = .{ .branch = .{ .condition = 54, .then_edge = .{ .target = 10, .arguments = &.{} }, .else_edge = .{ .target = 9, .arguments = &.{ .{ .value = 46 }, .{ .value = 47 } } } } } },
    .{ .id = 9, .role = .segment, .parameters = &.{ 50, 51 }, .instructions = &.{}, .terminator = .{ .@"suspend" = .{ .kind = .effect, .site_id = 1, .request_values = &.{50}, .continuation = .{ .target = 11, .arguments = &.{ .@"resume", .{ .value = 51 } } }, .resume_type = .{ .scalar = .u32 } } } },
    .{ .id = 10, .role = .terminal_handoff, .parameters = &.{}, .instructions = &.{
        .{ .kind = .constant, .result = 55, .operands = &.{}, .operation = .{ .constant = 11 } },
    }, .terminator = .{ .fail_value = 55 } },
    .{ .id = 11, .role = .after_handler, .parameters = &.{ 56, 57 }, .instructions = &.{
        .{ .kind = .pure, .result = 58, .operands = &.{57}, .operation = .{ .product_extract = 0 } },
        .{ .kind = .pure, .result = 59, .operands = &.{57}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 60, .operands = &.{57}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 61, .operands = &.{56}, .operation = .{ .sum_construct = 0 } },
        .{ .kind = .constant, .result = 62, .operands = &.{}, .operation = .{ .constant = 3 } },
    }, .terminator = .{ .jump = .{ .target = 12, .arguments = &.{ .{ .value = 59 }, .{ .value = 61 }, .{ .value = 58 }, .{ .value = 60 } } } } },
    .{ .id = 12, .role = .segment, .parameters = &.{ 63, 64, 65, 66 }, .instructions = &.{
        .{ .kind = .pure, .result = 67, .operands = &.{ 63, 64 }, .operation = .vector_push },
        .{ .kind = .pure, .result = 68, .operands = &.{66}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 69, .operands = &.{ 68, 62 }, .operation = .integer_add },
        .{ .kind = .pure, .result = 70, .operands = &.{ 66, 69 }, .operation = .{ .product_replace = 2 } },
        .{ .kind = .pure, .result = 71, .operands = &.{ 65, 67, 70 }, .operation = .product_construct },
    }, .terminator = .{ .jump = .{ .target = 1, .arguments = &.{.{ .value = 71 }} } } },
    .{ .id = 13, .role = .segment, .parameters = &.{ 72, 73 }, .instructions = &.{
        .{ .kind = .pure, .result = 77, .operands = &.{72}, .operation = .{ .sum_extract = 1 } },
        .{ .kind = .pure, .result = 78, .operands = &.{73}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 79, .operands = &.{78}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .constant, .result = 80, .operands = &.{}, .operation = .{ .constant = 6 } },
        .{ .kind = .pure, .result = 81, .operands = &.{ 79, 80 }, .operation = .integer_greater_equal },
    }, .terminator = .{ .branch = .{ .condition = 81, .then_edge = .{ .target = 15, .arguments = &.{} }, .else_edge = .{ .target = 16, .arguments = &.{ .{ .value = 77 }, .{ .value = 73 } } } } } },
    .{ .id = 14, .role = .segment, .parameters = &.{ 74, 75 }, .instructions = &.{
        .{ .kind = .pure, .result = 112, .operands = &.{74}, .operation = .{ .sum_tag_is = 2 } },
    }, .terminator = .{ .branch = .{ .condition = 112, .then_edge = .{ .target = 21, .arguments = &.{ .{ .value = 74 }, .{ .value = 75 } } }, .else_edge = .{ .target = 22, .arguments = &.{ .{ .value = 74 }, .{ .value = 75 } } } } } },
    .{ .id = 15, .role = .terminal_handoff, .parameters = &.{}, .instructions = &.{
        .{ .kind = .constant, .result = 84, .operands = &.{}, .operation = .{ .constant = 10 } },
    }, .terminator = .{ .fail_value = 84 } },
    .{ .id = 16, .role = .segment, .parameters = &.{ 82, 83 }, .instructions = &.{
        .{ .kind = .pure, .result = 85, .operands = &.{83}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 88, .operands = &.{85}, .operation = .vector_length },
        .{ .kind = .constant, .result = 89, .operands = &.{}, .operation = .{ .constant = 8 } },
        .{ .kind = .pure, .result = 90, .operands = &.{ 88, 89 }, .operation = .integer_greater_equal },
    }, .terminator = .{ .branch = .{ .condition = 90, .then_edge = .{ .target = 18, .arguments = &.{} }, .else_edge = .{ .target = 17, .arguments = &.{ .{ .value = 82 }, .{ .value = 83 } } } } } },
    .{ .id = 17, .role = .segment, .parameters = &.{ 86, 87 }, .instructions = &.{}, .terminator = .{ .@"suspend" = .{ .kind = .effect, .site_id = 2, .request_values = &.{86}, .continuation = .{ .target = 19, .arguments = &.{ .@"resume", .{ .value = 87 } } }, .resume_type = .{ .scalar = .u32 } } } },
    .{ .id = 18, .role = .terminal_handoff, .parameters = &.{}, .instructions = &.{
        .{ .kind = .constant, .result = 91, .operands = &.{}, .operation = .{ .constant = 11 } },
    }, .terminator = .{ .fail_value = 91 } },
    .{ .id = 19, .role = .after_handler, .parameters = &.{ 92, 93 }, .instructions = &.{
        .{ .kind = .pure, .result = 94, .operands = &.{93}, .operation = .{ .product_extract = 0 } },
        .{ .kind = .pure, .result = 95, .operands = &.{93}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 96, .operands = &.{93}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 97, .operands = &.{92}, .operation = .{ .sum_construct = 1 } },
        .{ .kind = .constant, .result = 98, .operands = &.{}, .operation = .{ .constant = 3 } },
    }, .terminator = .{ .jump = .{ .target = 20, .arguments = &.{ .{ .value = 95 }, .{ .value = 97 }, .{ .value = 94 }, .{ .value = 96 } } } } },
    .{ .id = 20, .role = .segment, .parameters = &.{ 99, 100, 101, 102 }, .instructions = &.{
        .{ .kind = .pure, .result = 103, .operands = &.{ 99, 100 }, .operation = .vector_push },
        .{ .kind = .pure, .result = 104, .operands = &.{102}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 105, .operands = &.{ 104, 98 }, .operation = .integer_add },
        .{ .kind = .pure, .result = 106, .operands = &.{ 102, 105 }, .operation = .{ .product_replace = 2 } },
        .{ .kind = .pure, .result = 107, .operands = &.{ 101, 103, 106 }, .operation = .product_construct },
    }, .terminator = .{ .jump = .{ .target = 1, .arguments = &.{.{ .value = 107 }} } } },
    .{ .id = 21, .role = .segment, .parameters = &.{ 108, 109 }, .instructions = &.{
        .{ .kind = .pure, .result = 113, .operands = &.{108}, .operation = .{ .sum_extract = 2 } },
        .{ .kind = .pure, .result = 114, .operands = &.{109}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 115, .operands = &.{114}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .constant, .result = 116, .operands = &.{}, .operation = .{ .constant = 6 } },
        .{ .kind = .pure, .result = 117, .operands = &.{ 115, 116 }, .operation = .integer_greater_equal },
        .{ .kind = .pure, .result = 118, .operands = &.{114}, .operation = .{ .product_extract = 3 } },
        .{ .kind = .constant, .result = 119, .operands = &.{}, .operation = .{ .constant = 7 } },
        .{ .kind = .pure, .result = 120, .operands = &.{ 118, 119 }, .operation = .integer_greater_equal },
        .{ .kind = .pure, .result = 121, .operands = &.{ 117, 120 }, .operation = .boolean_or },
    }, .terminator = .{ .branch = .{ .condition = 121, .then_edge = .{ .target = 23, .arguments = &.{} }, .else_edge = .{ .target = 24, .arguments = &.{ .{ .value = 113 }, .{ .value = 109 } } } } } },
    .{ .id = 22, .role = .segment, .parameters = &.{ 110, 111 }, .instructions = &.{
        .{ .kind = .pure, .result = 155, .operands = &.{110}, .operation = .{ .sum_tag_is = 3 } },
    }, .terminator = .{ .branch = .{ .condition = 155, .then_edge = .{ .target = 29, .arguments = &.{ .{ .value = 110 }, .{ .value = 111 } } }, .else_edge = .{ .target = 30, .arguments = &.{ .{ .value = 110 }, .{ .value = 111 } } } } } },
    .{ .id = 23, .role = .terminal_handoff, .parameters = &.{}, .instructions = &.{
        .{ .kind = .constant, .result = 124, .operands = &.{}, .operation = .{ .constant = 10 } },
    }, .terminator = .{ .fail_value = 124 } },
    .{ .id = 24, .role = .segment, .parameters = &.{ 122, 123 }, .instructions = &.{
        .{ .kind = .pure, .result = 125, .operands = &.{123}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 128, .operands = &.{125}, .operation = .vector_length },
        .{ .kind = .constant, .result = 129, .operands = &.{}, .operation = .{ .constant = 8 } },
        .{ .kind = .pure, .result = 130, .operands = &.{ 128, 129 }, .operation = .integer_greater_equal },
    }, .terminator = .{ .branch = .{ .condition = 130, .then_edge = .{ .target = 26, .arguments = &.{} }, .else_edge = .{ .target = 25, .arguments = &.{ .{ .value = 122 }, .{ .value = 123 } } } } } },
    .{ .id = 25, .role = .segment, .parameters = &.{ 126, 127 }, .instructions = &.{}, .terminator = .{ .@"suspend" = .{ .kind = .effect, .site_id = 3, .request_values = &.{126}, .continuation = .{ .target = 27, .arguments = &.{ .@"resume", .{ .value = 127 } } }, .resume_type = .{ .scalar = .u32 } } } },
    .{ .id = 26, .role = .terminal_handoff, .parameters = &.{}, .instructions = &.{
        .{ .kind = .constant, .result = 131, .operands = &.{}, .operation = .{ .constant = 11 } },
    }, .terminator = .{ .fail_value = 131 } },
    .{ .id = 27, .role = .after_handler, .parameters = &.{ 132, 133 }, .instructions = &.{
        .{ .kind = .pure, .result = 134, .operands = &.{133}, .operation = .{ .product_extract = 0 } },
        .{ .kind = .pure, .result = 135, .operands = &.{133}, .operation = .{ .product_extract = 1 } },
        .{ .kind = .pure, .result = 136, .operands = &.{133}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 137, .operands = &.{132}, .operation = .{ .sum_construct = 2 } },
        .{ .kind = .constant, .result = 138, .operands = &.{}, .operation = .{ .constant = 3 } },
    }, .terminator = .{ .jump = .{ .target = 28, .arguments = &.{ .{ .value = 135 }, .{ .value = 137 }, .{ .value = 134 }, .{ .value = 136 } } } } },
    .{ .id = 28, .role = .segment, .parameters = &.{ 139, 140, 141, 142 }, .instructions = &.{
        .{ .kind = .pure, .result = 143, .operands = &.{ 139, 140 }, .operation = .vector_push },
        .{ .kind = .pure, .result = 144, .operands = &.{142}, .operation = .{ .product_extract = 2 } },
        .{ .kind = .pure, .result = 145, .operands = &.{ 144, 138 }, .operation = .integer_add },
        .{ .kind = .pure, .result = 146, .operands = &.{ 142, 145 }, .operation = .{ .product_replace = 2 } },
        .{ .kind = .pure, .result = 147, .operands = &.{146}, .operation = .{ .product_extract = 3 } },
        .{ .kind = .pure, .result = 148, .operands = &.{ 147, 138 }, .operation = .integer_add },
        .{ .kind = .pure, .result = 149, .operands = &.{ 146, 148 }, .operation = .{ .product_replace = 3 } },
        .{ .kind = .pure, .result = 150, .operands = &.{ 141, 143, 149 }, .operation = .product_construct },
    }, .terminator = .{ .jump = .{ .target = 1, .arguments = &.{.{ .value = 150 }} } } },
    .{ .id = 29, .role = .segment, .parameters = &.{ 151, 152 }, .instructions = &.{
        .{ .kind = .pure, .result = 156, .operands = &.{151}, .operation = .{ .sum_extract = 3 } },
    }, .terminator = .{ .return_value = 156 } },
    .{ .id = 30, .role = .segment, .parameters = &.{ 153, 154 }, .instructions = &.{
        .{ .kind = .pure, .result = 157, .operands = &.{153}, .operation = .{ .sum_extract = 4 } },
    }, .terminator = .{ .fail_value = 157 } },
};

const DecisionSite = boundary.effect.site(
    0,
    Definition.decision.interface,
    DecisionRequest,
    Definition.Action,
);
const SearchSite = boundary.effect.site(1, "research.search.v1", u32, u32);
const ReadSite = boundary.effect.site(2, "document.read.v1", u32, u32);
const DelegateSite = boundary.effect.site(3, "agent.invoke.v1", u32, u32);

const ReferenceBody = struct {
    pub const InitialArgs = Definition.Goal;
    pub const Result = Definition.Result;
    pub const Failure = Definition.Failure;
    pub const constants = .{
        agent.strategy.instructionsValue(Definition),
        agent.strategy.catalogValue(Definition),
        @as(u32, 0),
        @as(u32, 1),
        Definition.budget.maximum_turns,
        Definition.budget.maximum_decisions,
        Definition.budget.maximum_effect_actions,
        Definition.budget.maximum_child_actions,
        Definition.history.maximum_observations,
        agent.DecisionPhase.decide,
        Definition.Failure.budget_exhausted,
        Definition.Failure.history_overflow,
    };
    pub const effect_sites = .{
        DecisionSite,
        SearchSite,
        ReadSite,
        DelegateSite,
    };
    pub const schema_types = .{
        Definition.Goal,
        Definition.Action,
        Definition.Observation,
        Definition.Result,
        Definition.Failure,
        agent.Counters,
        History,
        State,
        DecisionRequest,
        boundary.Text(Definition.instructions.len),
        ActionCatalog,
        agent.DecisionPhase,
        ?Definition.Action,
        u32,
        u32,
        u32,
        Definition.Result,
        Definition.Failure,
        u32,
        u32,
        u32,
    };
    pub const control_ir: boundary.ir.Program = .{
        .label = "agent-react-v1-direct-reference",
        .value_types = &reference_value_types,
        .blocks = &reference_blocks,
        .entry = 0,
        .result_type = .{ .schema = 3 },
    };
    pub const compiler_limits: boundary.ir.CompilerLimits = .{
        .maximum_values = 256,
        .maximum_blocks = 64,
        .maximum_constructors = 256,
        .maximum_environment_fields = 128,
        .maximum_invariant_terms = 64,
        .maximum_generated_operations = 32_768,
    };
};

pub const ReferenceProgram = boundary.program(
    "research-agent:agent.strategy.react.v1",
    ReferenceBody,
);
pub const ReferenceMachine = ReferenceProgram.compile(machine_options);

const Hasher = std.crypto.hash.sha2.Sha256;

fn unsigned(hasher: *Hasher, value: anytype) void {
    var encoded: [8]u8 = undefined;
    std.mem.writeInt(u64, &encoded, @intCast(value), .big);
    hasher.update(&encoded);
}

fn boolean(hasher: *Hasher, value: bool) void {
    hasher.update(&.{@intFromBool(value)});
}

fn bytes(hasher: *Hasher, value: []const u8) void {
    unsigned(hasher, value.len);
    hasher.update(value);
}

fn hashValueType(hasher: *Hasher, value: boundary.ir.ValueType) void {
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

fn hashOperation(hasher: *Hasher, value: boundary.ir.InstructionOperation) void {
    unsigned(hasher, @intFromEnum(std.meta.activeTag(value)));
    switch (value) {
        inline else => |payload| {
            if (@TypeOf(payload) != void) unsigned(hasher, payload);
        },
    }
}

fn hashEdgeArgument(hasher: *Hasher, value: boundary.ir.EdgeArgument) void {
    switch (value) {
        .value => |id| {
            unsigned(hasher, 0);
            unsigned(hasher, id);
        },
        .@"resume" => unsigned(hasher, 1),
    }
}

fn hashEdge(hasher: *Hasher, value: boundary.ir.Edge) void {
    unsigned(hasher, value.target);
    unsigned(hasher, value.arguments.len);
    for (value.arguments) |argument| hashEdgeArgument(hasher, argument);
}

fn hashOptionalUnsigned(hasher: *Hasher, value: anytype) void {
    if (value) |present| {
        boolean(hasher, true);
        unsigned(hasher, present);
    } else boolean(hasher, false);
}

fn hashOptionalValueType(hasher: *Hasher, value: ?boundary.ir.ValueType) void {
    if (value) |present| {
        boolean(hasher, true);
        hashValueType(hasher, present);
    } else boolean(hasher, false);
}

fn hashTerminator(hasher: *Hasher, value: boundary.ir.Terminator) void {
    unsigned(hasher, @intFromEnum(std.meta.activeTag(value)));
    switch (value) {
        .jump => |jump| hashEdge(hasher, jump),
        .branch => |branch| {
            unsigned(hasher, branch.condition);
            hashEdge(hasher, branch.then_edge);
            hashEdge(hasher, branch.else_edge);
        },
        .@"suspend" => |suspension| {
            unsigned(hasher, @intFromEnum(suspension.kind));
            hashOptionalUnsigned(hasher, suspension.site_id);
            unsigned(hasher, suspension.request_values.len);
            for (suspension.request_values) |request| unsigned(hasher, request);
            hashOptionalUnsigned(hasher, suspension.callee_function);
            if (suspension.callee) |callee| {
                boolean(hasher, true);
                hashEdge(hasher, callee);
            } else boolean(hasher, false);
            hashEdge(hasher, suspension.continuation);
            hashOptionalValueType(hasher, suspension.resume_type);
        },
        .return_value => |result| hashOptionalUnsigned(hasher, result),
        .return_to_caller => |result| unsigned(hasher, result),
        .fail => |failure| unsigned(hasher, failure),
        .fail_value => |failure| unsigned(hasher, failure),
    }
}

fn controlDigest(comptime program: boundary.ir.Program) [32]u8 {
    @setEvalBranchQuota(10_000_000);
    var hasher = Hasher.init(.{});
    bytes(&hasher, "agent-control-ir/v1");
    unsigned(&hasher, program.value_types.len);
    for (program.value_types) |value| hashValueType(&hasher, value);
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
            hashOperation(&hasher, instruction.operation);
        }
        hashTerminator(&hasher, block.terminator);
    }
    unsigned(&hasher, program.entry);
    hashValueType(&hasher, program.result_type);
    unsigned(&hasher, program.functions.len);
    for (program.functions) |function| {
        unsigned(&hasher, function.id);
        unsigned(&hasher, function.entry);
        hashValueType(&hasher, function.result_type);
    }
    var digest: [32]u8 = undefined;
    hasher.final(&digest);
    return digest;
}

fn resumeRequest(
    comptime Machine: type,
    state: Machine.State,
    request: Machine.Request,
    value: anytype,
) !void {
    const prepared = try Machine.prepareResume(state, request);
    defer Machine.deinitPreparedResume(prepared);
    try Machine.@"resume"(prepared, value);
}

test "Agent ReAct equals the direct Boundary Control IR reference" {
    try std.testing.expectEqualSlices(
        u8,
        &Generated.StrategyManifest.control_ir_digest,
        &controlDigest(ReferenceProgram.control_ir),
    );
    try std.testing.expectEqualSlices(
        u8,
        &Generated.Machine.Manifest.machine_contract_digest,
        &ReferenceMachine.Manifest.machine_contract_digest,
    );
    try std.testing.expectEqual(
        Generated.Program.rnf.constructor_count,
        ReferenceProgram.rnf.constructor_count,
    );
    try std.testing.expectEqual(
        Generated.Program.rnf.entry_transition_count,
        ReferenceProgram.rnf.entry_transition_count,
    );
    try std.testing.expectEqual(
        Generated.Program.generated_reducer_operation_count,
        ReferenceProgram.generated_reducer_operation_count,
    );
    try std.testing.expectEqual(
        Generated.Program.maximum_segment_value_bytes,
        ReferenceProgram.maximum_segment_value_bytes,
    );
    try std.testing.expectEqual(
        Generated.Program.reachable_value_catalog_bytes,
        ReferenceProgram.reachable_value_catalog_bytes,
    );
    try std.testing.expectEqual(
        Generated.Machine.Manifest.effect_site_count,
        ReferenceMachine.Manifest.effect_site_count,
    );
    inline for (0..Generated.Machine.Manifest.effect_site_count) |index| {
        const generated_site = Generated.Machine.EffectRow.site(index);
        const reference_site = ReferenceMachine.EffectRow.site(index);
        try std.testing.expectEqualStrings(
            generated_site.semantic_identity,
            reference_site.semantic_identity,
        );
        try std.testing.expectEqualSlices(
            u8,
            &generated_site.semantic_contract_digest,
            &reference_site.semantic_contract_digest,
        );
    }

    const goal = Definition.Goal{ .subject = 7 };
    const generated_state = try Generated.Machine.initialState(
        std.testing.allocator,
        goal,
    );
    defer Generated.Machine.deinitState(generated_state);
    const reference_state = try ReferenceMachine.initialState(
        std.testing.allocator,
        goal,
    );
    defer ReferenceMachine.deinitState(reference_state);
    const generated_bytes = try Generated.Machine.encodeState(
        std.testing.allocator,
        generated_state,
    );
    defer std.testing.allocator.free(generated_bytes);
    const reference_bytes = try ReferenceMachine.encodeState(
        std.testing.allocator,
        reference_state,
    );
    defer std.testing.allocator.free(reference_bytes);
    try std.testing.expectEqualSlices(u8, generated_bytes, reference_bytes);
}

test "direct Boundary reference executes the Research ReAct fixture" {
    const state = try ReferenceMachine.initialState(
        std.testing.allocator,
        Definition.Goal{ .subject = 7 },
    );
    defer ReferenceMachine.deinitState(state);
    var fuel: u64 = machine_options.maximum_machine_fuel;

    const first_decision = switch (try ReferenceMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try std.testing.expectEqual(@as(u32, 0), first_decision.identity.site_ordinal);
    try resumeRequest(
        ReferenceMachine,
        state,
        first_decision,
        Definition.Action{ .search = 11 },
    );

    const search = switch (try ReferenceMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try std.testing.expectEqual(@as(u32, 1), search.identity.site_ordinal);
    try resumeRequest(ReferenceMachine, state, search, @as(u32, 101));

    const second_decision = switch (try ReferenceMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(
        ReferenceMachine,
        state,
        second_decision,
        Definition.Action{ .read = 12 },
    );

    const read = switch (try ReferenceMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try std.testing.expectEqual(@as(u32, 2), read.identity.site_ordinal);
    try resumeRequest(ReferenceMachine, state, read, @as(u32, 202));

    const final_decision = switch (try ReferenceMachine.step(state, &fuel)) {
        .request => |request| request,
        else => return error.UnexpectedMachineStep,
    };
    try resumeRequest(
        ReferenceMachine,
        state,
        final_decision,
        Definition.Action{ .final = .{ .answer = 303 } },
    );

    const done = switch (try ReferenceMachine.step(state, &fuel)) {
        .done => |result| result,
        else => return error.UnexpectedMachineStep,
    };
    defer done.deinit();
    try std.testing.expectEqual(@as(u32, 303), done.value().answer);
}
