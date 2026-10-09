//! Deterministic input projection. Original captures remain immutable; epochs
//! explicitly replace replay with an admitted authored semantic handoff.
const std = @import("std");
const contracts = @import("agent_contracts");
const registry = @import("registry.zig");
const json = @import("json.zig");
const responses = @import("responses.zig");
const storage = @import("store.zig");

fn equal(left: []const u8, right: []const u8) bool {
    return std.mem.eql(u8, left, right);
}
fn same(left: anytype, right: anytype) bool {
    return std.meta.eql(left, right);
}
fn encodedEqual(a: std.mem.Allocator, comptime T: type, left: T, right: T) !bool {
    const lhs = try contracts.encodeOwned(T, a, left);
    defer a.free(lhs);
    const rhs = try contracts.encodeOwned(T, a, right);
    defer a.free(rhs);
    return equal(lhs, rhs);
}
fn field(item: json.Value, key: []const u8) !json.Value {
    return json.get(item, key) orelse error.InvalidContext;
}
fn kind(item: json.Value, expected: []const u8) bool {
    const value = json.get(item, "type") orelse return false;
    return value == .string and equal(value.string, expected);
}
fn list(a: std.mem.Allocator) json.Value {
    return .{ .array = .init(a) };
}
fn only(value: json.Value, keys: []const []const u8) !void {
    if (value != .object) return error.InvalidContext;
    for (value.object.keys()) |key| {
        var allowed = false;
        for (keys) |candidate| allowed = allowed or equal(key, candidate);
        if (!allowed) return error.InvalidContext;
    }
}
fn inputPart(part: json.Value) !void {
    try only(part, &.{ "type", "text", "prompt_cache_breakpoint" });
    if (!kind(part, "input_text")) return error.InvalidContext;
    _ = try json.text(try field(part, "text"));
    if (json.get(part, "prompt_cache_breakpoint")) |marker| {
        try only(marker, &.{"mode"});
        if (!equal(try json.text(try field(marker, "mode")), "explicit")) return error.InvalidContext;
    }
}
fn read(ctx: registry.ProjectionContext, reference: anytype, limit: usize) ![]u8 {
    if (reference.bytes == 0 or reference.bytes > limit) return error.Capacity;
    const bytes = try ctx.object(.{ .digest = reference.digest, .bytes = reference.bytes }, limit);
    errdefer ctx.allocator.free(bytes);
    if (bytes.len != reference.bytes or !equal(&storage.digest(bytes), &reference.digest)) return error.InvalidContext;
    return bytes;
}

pub fn Projection(comptime P: type) type {
    return struct {
        const Admission = @import("adaptive_responses.zig").Admission(P);
        const Ref = @typeInfo(@FieldType(P.AdaptiveResult, "replay")).optional.child;
        pub const Rendered = struct {
            /// Committed events, without the transient material of this call.
            history: json.Value,
            /// Exact chronological provider input, including transient suffix.
            input: json.Value,
            core_tools: json.Value,
            prior_response_id: ?[]const u8,
            prior_request: ?@FieldType(P.AdaptiveContext, "source_request"),
        };

        pub fn open(ctx: registry.ProjectionContext, reference: Ref, audience: []const u8) !contracts.Decoded(P.AdaptiveContext) {
            if (!equal(reference.schema.bytes, P.adaptive_context_identity) or !equal(&reference.policy, &storage.digest(ctx.profile)) or
                !equal(&reference.task, &ctx.task) or !equal(reference.tenant.bytes, ctx.tenant) or !equal(reference.audience.bytes, audience)) return error.InvalidContext;
            const bytes = try read(ctx, reference.object, 2 * 1024 * 1024);
            defer ctx.allocator.free(bytes);
            var decoded = try contracts.decodeOwned(P.AdaptiveContext, ctx.allocator, bytes);
            errdefer decoded.deinit();
            const value = decoded.value;
            if (!equal(value.schema.bytes, reference.schema.bytes) or !equal(&value.policy, &reference.policy) or
                !equal(&value.task, &reference.task) or !equal(value.tenant.bytes, reference.tenant.bytes) or !equal(value.audience.bytes, reference.audience.bytes) or
                !equal(&value.selection.profile_digest, &reference.selection) or value.plan.epoch != reference.epoch or value.watermark != reference.watermark or
                value.plan.eviction_generation != reference.eviction_generation or value.plan.watermark == std.math.maxInt(u64) or value.watermark != value.plan.watermark + 1) return error.InvalidContext;
            // These reads make loss of audit dependencies an error even when
            // an epoch deliberately does not replay their prompt material.
            const raw = try read(ctx, value.source_capture, 4 * 1024 * 1024);
            ctx.allocator.free(raw);
            const prepared = try read(ctx, value.source_request, 2 * 1024 * 1024);
            ctx.allocator.free(prepared);
            if (value.plan.handoff) |ref| {
                const seed = try read(ctx, ref, 128 * 1024);
                ctx.allocator.free(seed);
            }
            return decoded;
        }

        fn tool(a: std.mem.Allocator, declaration: P.ToolDeclaration) !json.Value {
            var item = json.object();
            try json.put(a, &item, "type", json.string("function"));
            try json.put(a, &item, "name", json.string(declaration.name.bytes));
            try json.put(a, &item, "description", json.string(declaration.description.bytes));
            try json.put(a, &item, "parameters", (try json.parse(a, declaration.input_schema_json.bytes, .{})).value);
            try json.put(a, &item, "strict", .{ .bool = true });
            return item;
        }

        fn message(a: std.mem.Allocator, role: []const u8, text: []const u8, marked: bool) !json.Value {
            var part = json.object();
            try json.put(a, &part, "type", json.string("input_text"));
            try json.put(a, &part, "text", json.string(text));
            if (marked) {
                var marker = json.object();
                try json.put(a, &marker, "mode", json.string("explicit"));
                try json.put(a, &part, "prompt_cache_breakpoint", marker);
            }
            var content = list(a);
            try content.array.append(part);
            var item = json.object();
            try json.put(a, &item, "role", json.string(role));
            try json.put(a, &item, "content", content);
            return item;
        }

        fn sameSkill(left: anytype, right: anytype) bool {
            return equal(left.skill_id.bytes, right.skill_id.bytes) and equal(left.version.bytes, right.version.bytes) and
                same(left.resource, right.resource) and left.residency == right.residency and left.introduced_at == right.introduced_at;
        }

        fn excluded(prior: P.AdaptiveContext, request: P.AdaptiveRequest) bool {
            for (prior.plan.skills.items) |old| {
                var retained = false;
                for (request.plan.skills.items) |current| if (sameSkill(old, current)) {
                    retained = !(old.residency == .transient and old.active and !current.active);
                };
                if (!retained) return true;
            }
            return false;
        }

        /// Check call/result pairing independently of normalization. Call IDs
        /// scope an unsettled exchange; an ID reused after settlement is not an
        /// idempotency key for a later acquired response.
        pub fn pending(a: std.mem.Allocator, items: json.Value) !std.StringHashMap(void) {
            if (items != .array or items.array.items.len > 8192) return error.Capacity;
            var calls = std.StringHashMap(void).init(a);
            errdefer calls.deinit();
            var previous_update = false;
            for (items.array.items) |item| {
                if (item != .object) return error.InvalidContext;
                if (kind(item, "function_call")) {
                    _ = try responses.replayItem(a, item);
                    const id = try json.text(try field(item, "call_id"));
                    if ((try calls.getOrPut(id)).found_existing) return error.InvalidContext;
                } else if (kind(item, "function_call_output")) {
                    try only(item, &.{ "type", "call_id", "output" });
                    const output = try field(item, "output");
                    if (output == .array) {
                        if (output.array.items.len != 1) return error.InvalidContext;
                        try inputPart(output.array.items[0]);
                    } else _ = try json.text(output);
                    if (!calls.remove(try json.text(try field(item, "call_id")))) return error.CallPairMismatch;
                } else if (kind(item, "additional_tools") or kind(item, "configuration_update") or json.get(item, "type") == null) {
                    if (calls.count() != 0) return error.MissingCallResult;
                    if (kind(item, "additional_tools")) {
                        try only(item, &.{ "type", "role", "tools" });
                        if (!equal(try json.text(try field(item, "role")), "developer")) return error.InvalidContext;
                        const tools = try field(item, "tools");
                        if (tools != .array or tools.array.items.len == 0 or tools.array.items.len > P.declaration_count) return error.InvalidContext;
                        for (tools.array.items) |declaration| {
                            try only(declaration, &.{ "type", "name", "description", "parameters", "strict" });
                            if (!kind(declaration, "function") or (try field(declaration, "parameters")) != .object or
                                (try field(declaration, "strict")) != .bool or !(try field(declaration, "strict")).bool) return error.InvalidContext;
                            _ = try json.text(try field(declaration, "name"));
                            _ = try json.text(try field(declaration, "description"));
                        }
                    } else if (kind(item, "configuration_update")) {
                        if (previous_update) return error.InvalidContext;
                        try only(item, &.{ "type", "reasoning" });
                        const reasoning = try field(item, "reasoning");
                        try only(reasoning, &.{"effort"});
                        _ = std.meta.stringToEnum(@FieldType(@FieldType(P.AdaptiveRequest, "selection"), "effective_effort"), try json.text(try field(reasoning, "effort"))) orelse return error.InvalidContext;
                    } else {
                        try only(item, &.{ "role", "content" });
                        const role = try json.text(try field(item, "role"));
                        if (!equal(role, "system") and !equal(role, "developer") and !equal(role, "user") and !equal(role, "assistant")) return error.InvalidContext;
                        const content = try field(item, "content");
                        if (content != .array or content.array.items.len != 1) return error.InvalidContext;
                        try inputPart(content.array.items[0]);
                    }
                } else {
                    _ = try responses.replayItem(a, item);
                }
                previous_update = kind(item, "configuration_update");
            }
            return calls;
        }

        pub fn render(ctx: registry.ProjectionContext, request: P.AdaptiveRequest, frozen: P.AdaptivePolicy, selected: Admission.Selected, catalog: P.AdaptiveCatalog) !Rendered {
            const a = ctx.allocator;
            var history = list(a);
            var previous: ?contracts.Decoded(P.AdaptiveContext) = null;
            defer if (previous) |*saved| saved.deinit();
            var same_epoch = false;
            var new_start: usize = 0;
            if (request.plan.prior) |ref| {
                previous = try open(ctx, ref, frozen.audience.bytes);
                // Audit parents remain required even across an eviction. Free
                // each decoded predecessor before opening the next one.
                var parent = previous.?.value.plan.prior;
                var watermark = previous.?.value.plan.watermark;
                var depth: usize = 1;
                while (parent) |ancestor| {
                    if (depth == 64) return error.Capacity;
                    if (ancestor.watermark != watermark) return error.InvalidContext;
                    var saved = try open(ctx, ancestor, frozen.audience.bytes);
                    defer saved.deinit();
                    parent = saved.value.plan.prior;
                    if (parent) |*next| {
                        next.schema.bytes = try a.dupe(u8, next.schema.bytes);
                        next.tenant.bytes = try a.dupe(u8, next.tenant.bytes);
                        next.audience.bytes = try a.dupe(u8, next.audience.bytes);
                    }
                    watermark = saved.value.plan.watermark;
                    depth += 1;
                }
                const old = previous.?.value;
                if (request.plan.watermark != old.watermark or request.selection.control_revision < old.selection.control_revision) return error.InvalidContext;
                same_epoch = request.plan.epoch == old.plan.epoch;
                const removing = excluded(old, request);
                if (same_epoch) {
                    if (removing or request.plan.eviction_generation != old.plan.eviction_generation or
                        !equal(&request.selection.profile_digest, &old.selection.profile_digest) or
                        request.invocation.parameters.reasoning.?.effort.? != old.top_effort or
                        !same(request.plan.handoff, old.plan.handoff) or request.plan.reason != old.plan.reason) return error.InvalidContext;
                    history = (try json.parse(a, old.items.bytes, .{ .bytes = 2 * 1024 * 1024 })).value;
                    new_start = history.array.items.len;
                } else {
                    if (request.plan.epoch != try std.math.add(u64, old.plan.epoch, 1) or
                        request.plan.eviction_generation != try std.math.add(u64, old.plan.eviction_generation, @intFromBool(removing))) return error.InvalidContext;
                    const seed_ref = request.plan.handoff orelse return error.MissingHandoff;
                    const bytes = try read(ctx, seed_ref, 128 * 1024);
                    defer a.free(bytes);
                    var seed = try contracts.decodeOwned(P.AdaptiveSeed, a, bytes);
                    defer seed.deinit();
                    const value = seed.value;
                    if (!equal(value.schema.bytes, P.adaptive_seed_identity) or !equal(&value.policy, &request.policy) or !equal(&value.task, &ctx.task) or
                        !equal(value.tenant.bytes, ctx.tenant) or !equal(value.audience.bytes, frozen.audience.bytes) or
                        !try encodedEqual(a, @FieldType(P.AdaptiveSeed, "selection"), value.selection, request.selection) or value.epoch != request.plan.epoch or value.watermark != request.plan.watermark or
                        value.eviction_generation != request.plan.eviction_generation or !try encodedEqual(a, Ref, value.source, ref) or value.messages.items.len == 0) return error.InvalidContext;
                    // The old exchange must be settled even when represented by
                    // a handoff; a reset cannot discard an outstanding call.
                    var old_history = (try json.parse(a, old.items.bytes, .{ .bytes = 2 * 1024 * 1024 })).value;
                    try settle(a, &old_history, request, selected.profile.explicit_cache);
                    for (value.messages.items, 0..) |item, index| try history.array.append(try message(a, @tagName(item.role), try a.dupe(u8, item.content.bytes), selected.profile.explicit_cache and index == 0));
                }
            } else if (request.plan.epoch != 0 or request.plan.watermark != 0 or request.plan.eviction_generation != 0 or request.plan.handoff != null or request.plan.reason != .initial) return error.InvalidContext;
            if (same_epoch or previous == null) try settle(a, &history, request, selected.profile.explicit_cache);
            if (same_epoch and request.selection.effective_effort != previous.?.value.selection.effective_effort) {
                if (!selected.profile.effort_update) return error.IncompatibleProfile;
                if (history.array.items.len != 0 and kind(history.array.items[history.array.items.len - 1], "configuration_update")) return error.InvalidContext;
                var update = json.object();
                var reasoning = json.object();
                try json.put(a, &reasoning, "effort", json.string(@tagName(request.selection.effective_effort)));
                try json.put(a, &update, "type", json.string("configuration_update"));
                try json.put(a, &update, "reasoning", reasoning);
                try history.array.append(update);
            } else if (!same_epoch and request.invocation.parameters.reasoning.?.effort.? != request.selection.effective_effort) return error.IncompatibleProfile;
            for (request.invocation.messages.items, 0..) |item, index| try history.array.append(try message(a, @tagName(item.role), item.content.bytes, selected.profile.explicit_cache and previous == null and index == 0));
            var defined = frozen.core_tools;
            var core = list(a);
            for (frozen.core_tools, P.allDeclarations().items) |enabled, declaration| if (enabled) try core.array.append(try tool(a, declaration));
            if (same_epoch) for (previous.?.value.plan.skills.items) |loaded| for (catalog.skills.items) |entry| {
                if (equal(loaded.skill_id.bytes, entry.id.bytes)) for (entry.tools, 0..) |enabled, index| {
                    defined[index] = defined[index] or enabled;
                };
            };
            for (request.plan.skills.items) |loaded| {
                var retained = false;
                if (same_epoch) for (previous.?.value.plan.skills.items) |old| {
                    retained = retained or sameSkill(old, loaded);
                };
                if (retained) continue;
                var additions = list(a);
                for (catalog.skills.items) |entry| if (equal(entry.id.bytes, loaded.skill_id.bytes)) {
                    for (entry.tools, 0..) |enabled, index| {
                        if (enabled and !defined[index]) try additions.array.append(try tool(a, P.allDeclarations().items[index]));
                        defined[index] = defined[index] or enabled;
                    }
                };
                if (additions.array.items.len != 0) {
                    if (!selected.profile.additional_tools) return error.IncompatibleProfile;
                    var addition = json.object();
                    try json.put(a, &addition, "type", json.string("additional_tools"));
                    try json.put(a, &addition, "role", json.string("developer"));
                    try json.put(a, &addition, "tools", additions);
                    try history.array.append(addition);
                }
                if (loaded.residency == .resident) {
                    const body = try read(ctx, loaded.resource, 32 * 1024);
                    try history.array.append(try message(a, "developer", body, false));
                }
            }
            // At most two newly selected writes: the immutable epoch core and
            // the latest newly appended eligible content. Old markers remain
            // at their original positions; transient suffixes are added later.
            if (selected.profile.explicit_cache) try markLatest(a, &history, new_start);
            // Copy only the item vector: elements are immutable region values.
            var input = list(a);
            try input.array.appendSlice(history.array.items);
            for (request.plan.skills.items) |loaded| if (loaded.residency == .transient and loaded.active) {
                const body = try read(ctx, loaded.resource, 32 * 1024);
                try input.array.append(try message(a, "developer", body, false));
            };
            if (input.array.items.len > 8192) return error.Capacity;
            return .{ .history = history, .input = input, .core_tools = core, .prior_response_id = if (same_epoch) if (previous.?.value.response_id) |id| try a.dupe(u8, id.bytes) else null else null, .prior_request = if (previous) |saved| saved.value.source_request else null };
        }

        fn markLatest(a: std.mem.Allocator, history: *json.Value, start: usize) !void {
            var index = history.array.items.len;
            while (index > start) {
                index -= 1;
                const item = &history.array.items[index];
                if (item.* != .object) return error.InvalidContext;
                const key: []const u8 = if (kind(item.*, "function_call_output")) "output" else if (json.get(item.*, "type") == null) "content" else continue;
                const parts = item.object.getPtr(key) orelse continue;
                if (parts.* != .array or parts.array.items.len == 0) continue;
                const part = &parts.array.items[parts.array.items.len - 1];
                if (!kind(part.*, "input_text")) continue;
                var marker = json.object();
                try json.put(a, &marker, "mode", json.string("explicit"));
                try json.put(a, part, "prompt_cache_breakpoint", marker);
                return;
            }
        }

        fn settle(a: std.mem.Allocator, history: *json.Value, request: P.AdaptiveRequest, explicit_cache: bool) !void {
            var calls = try pending(a, history.*);
            defer calls.deinit();
            for (request.results.items) |result| {
                if (!calls.remove(result.call_id.bytes)) return error.CallPairMismatch;
                var item = json.object();
                try json.put(a, &item, "type", json.string("function_call_output"));
                try json.put(a, &item, "call_id", json.string(result.call_id.bytes));
                const output = if (explicit_cache) blk: {
                    var part = json.object();
                    try json.put(a, &part, "type", json.string("input_text"));
                    try json.put(a, &part, "text", json.string(result.output.bytes));
                    var parts = list(a);
                    try parts.array.append(part);
                    break :blk parts;
                } else json.string(result.output.bytes);
                try json.put(a, &item, "output", output);
                try history.array.append(item);
            }
            if (calls.count() != 0) return error.MissingCallResult;
        }
    };
}
