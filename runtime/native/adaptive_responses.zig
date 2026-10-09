//! Admission for adaptive Responses occurrences under an immutable task policy.
//! The authored program selects profiles and skills; this owner only verifies
//! that the exact request remains inside the frozen resource/feature universe.
const std = @import("std");
const contracts = @import("agent_contracts");
const registry = @import("registry.zig");
const values = @import("values.zig");
const json = @import("json.zig");
const responses = @import("responses.zig");
const https = @import("https.zig");
const storage = @import("store.zig");

fn equal(left: []const u8, right: []const u8) bool {
    return std.mem.eql(u8, left, right);
}
fn identifier(bytes: []const u8) bool {
    if (bytes.len == 0) return false;
    for (bytes) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_' and byte != '.') return false;
    return true;
}
fn sameReference(left: anytype, right: anytype) bool {
    return left.bytes == right.bytes and equal(&left.digest, &right.digest);
}
fn object(ctx: registry.ProjectionContext, ref: anytype, limit: usize) ![]u8 {
    if (ref.bytes == 0 or ref.bytes > limit) return error.Capacity;
    const bytes = try ctx.object(.{ .digest = ref.digest, .bytes = ref.bytes }, limit);
    errdefer ctx.allocator.free(bytes);
    if (bytes.len != ref.bytes or !equal(&storage.digest(bytes), &ref.digest)) return error.InvalidArtifact;
    return bytes;
}

pub fn Admission(comptime P: type) type {
    return struct {
        pub const Policy = P.AdaptivePolicy;
        pub const Profile = @FieldType(Policy, "profiles").Child;
        pub const Selected = struct { profile: Profile, transport: responses.Settings };

        pub fn policy(a: std.mem.Allocator, bytes: []const u8) !Policy {
            const parsed = try json.parse(a, bytes, .{ .bytes = 256 * 1024 });
            const value = try values.fromJson(Policy, a, json.get(parsed.value, "adaptive") orelse return error.InvalidConfiguration);
            if (!equal(value.schema.bytes, P.adaptive_policy_identity) or value.audience.bytes.len == 0 or
                value.profiles.items.len == 0 or value.model_attempts == 0 or value.model_attempts > 64 or value.control_transitions > 32 or
                value.catalog.bytes == 0 or value.catalog.bytes > 64 * 1024) return error.InvalidConfiguration;
            for (value.core_tools, value.permitted_tools) |core, permitted| if (core and !permitted) return error.InvalidConfiguration;
            for (value.profiles.items, 0..) |entry, index| {
                if (!identifier(entry.id.bytes) or entry.model.bytes.len == 0 or entry.model.bytes.len > P.representation.model_id_bytes or
                    !identifier(entry.opaque_family.bytes) or entry.efforts.items.len == 0 or
                    entry.max_output_tokens == 0 or entry.max_output_tokens > 32768 or
                    entry.request_bytes > 256 * 1024 or entry.response_bytes > 512 * 1024 or entry.response_bytes > P.representation.provider_response_bytes or
                    (entry.effort_update and entry.reasoning_mode != .standard)) return error.InvalidConfiguration;
                for (value.profiles.items[0..index]) |earlier| if (equal(earlier.id.bytes, entry.id.bytes)) return error.InvalidConfiguration;
                for (entry.efforts.items, 0..) |effort, n| for (entry.efforts.items[0..n]) |earlier| if (effort == earlier) return error.InvalidConfiguration;
                _ = try (https.Config{ .endpoint = value.endpoint.bytes, .token = "validation", .request_limit = entry.request_bytes, .response_limit = entry.response_bytes, .timeout_ms = entry.timeout_ms }).validate();
            }
            return value;
        }

        pub fn profileDigest(a: std.mem.Allocator, profile: Profile) ![32]u8 {
            const encoded = try contracts.encodeOwned(Profile, a, profile);
            defer a.free(encoded);
            return storage.digest(encoded);
        }

        pub fn select(a: std.mem.Allocator, frozen: Policy, request: P.AdaptiveRequest) !Selected {
            var selected: ?Profile = null;
            for (frozen.profiles.items) |entry| if (equal(entry.id.bytes, request.selection.profile_id.bytes)) {
                selected = entry;
            };
            const entry = selected orelse return error.UnknownInferenceProfile;
            const selected_digest = try profileDigest(a, entry);
            if (!equal(&request.selection.profile_digest, &selected_digest)) return error.IncompatibleProfile;
            var supported = false;
            for (entry.efforts.items) |effort| supported = supported or effort == request.selection.effective_effort;
            if (!supported) return error.UnsupportedEffort;
            const invocation = request.invocation;
            const reasoning = invocation.parameters.reasoning orelse return error.IncompatibleProfile;
            const top_effort = reasoning.effort orelse return error.IncompatibleProfile;
            supported = false;
            for (entry.efforts.items) |effort| supported = supported or effort == top_effort;
            if (!supported or (!entry.effort_update and top_effort != request.selection.effective_effort) or reasoning.summary != null or
                !equal(invocation.model.bytes, entry.model.bytes) or invocation.parameters.max_output_tokens != entry.max_output_tokens or invocation.parameters.temperature != null or
                !equal(invocation.protocol.bytes, "agent.model.protocol.openai-responses-v2") or
                invocation.response_policy.store or invocation.response_policy.stream or invocation.response_policy.background or
                invocation.selection.parallel_calls or invocation.selection.maximum_calls > 1 or invocation.selection.minimum_calls > invocation.selection.maximum_calls or
                invocation.maximum_provider_response_bytes != entry.response_bytes or !std.meta.eql(invocation.normalization_limits, P.normalizationLimits())) return error.IncompatibleProfile;
            return .{ .profile = entry, .transport = .{
                .endpoint = frozen.endpoint,
                .audience = frozen.audience,
                .model = entry.model,
                .effort = .{ .bytes = @tagName(top_effort) },
                .max_output_tokens = entry.max_output_tokens,
                .request_bytes = entry.request_bytes,
                .response_bytes = entry.response_bytes,
                .timeout_ms = entry.timeout_ms,
            } };
        }

        pub fn catalog(ctx: registry.ProjectionContext, frozen: Policy) !contracts.Decoded(P.AdaptiveCatalog) {
            const bytes = try object(ctx, frozen.catalog, 64 * 1024);
            defer ctx.allocator.free(bytes);
            var decoded = try contracts.decodeOwned(P.AdaptiveCatalog, ctx.allocator, bytes);
            errdefer decoded.deinit();
            const entries = decoded.value.skills.items;
            for (entries, 0..) |entry, index| {
                if (!identifier(entry.id.bytes) or !identifier(entry.version.bytes) or entry.instructions.bytes == 0 or entry.instructions.bytes > 32 * 1024) return error.InvalidSkill;
                for (entries[0..index]) |earlier| if (equal(entry.id.bytes, earlier.id.bytes)) return error.InvalidSkill;
                for (entry.tools, frozen.permitted_tools) |enabled, permitted| if (enabled and !permitted) return error.InvalidSkill;
            }
            return decoded;
        }

        pub fn bind(ctx: registry.ProjectionContext, frozen: Policy, request: P.AdaptiveRequest, skills: P.AdaptiveCatalog) !Selected {
            if (!equal(&request.policy, &storage.digest(ctx.profile)) or !sameReference(request.plan.catalog, frozen.catalog) or
                request.selection.control_revision > frozen.control_transitions) return error.IncompatibleProfile;
            const selected = try select(ctx.allocator, frozen, request);
            var materialized = frozen.core_tools;
            var permitted = frozen.core_tools;
            var active: usize = 0;
            var body_bytes: u64 = 0;
            for (request.plan.skills.items, 0..) |loaded, index| {
                var found: ?P.AdaptiveSkill = null;
                for (skills.skills.items) |entry| if (equal(entry.id.bytes, loaded.skill_id.bytes) and equal(entry.version.bytes, loaded.version.bytes)) {
                    found = entry;
                };
                const entry = found orelse return error.UnknownSkill;
                if (!sameReference(entry.instructions, loaded.resource) or loaded.introduced_at > request.plan.watermark) return error.InvalidSkill;
                for (request.plan.skills.items[0..index]) |earlier| if (equal(earlier.skill_id.bytes, loaded.skill_id.bytes)) return error.InvalidSkill;
                active += @intFromBool(loaded.active);
                body_bytes += entry.instructions.bytes;
                if (active > 4 or body_bytes > 128 * 1024) return error.Capacity;
                const body = try object(ctx, entry.instructions, 32 * 1024);
                defer ctx.allocator.free(body);
                if (!std.unicode.utf8ValidateSlice(body)) return error.InvalidSkill;
                for (entry.tools, 0..) |enabled, ordinal| {
                    materialized[ordinal] = materialized[ordinal] or enabled;
                    permitted[ordinal] = permitted[ordinal] or (enabled and loaded.active);
                }
            }
            var tool_index: usize = 0;
            const declarations = P.allDeclarations().items;
            for (materialized, permitted, request.materialized, request.offered, 0..) |defined, allowed, claimed, offered, ordinal| {
                if (defined != claimed or (offered and !allowed)) return error.InvalidDeclaration;
                if (defined) {
                    if (tool_index == request.invocation.tools.items.len) return error.InvalidDeclaration;
                    const expected = try contracts.encodeOwned(P.ToolDeclaration, ctx.allocator, declarations[ordinal]);
                    defer ctx.allocator.free(expected);
                    const actual = try contracts.encodeOwned(P.ToolDeclaration, ctx.allocator, request.invocation.tools.items[tool_index]);
                    defer ctx.allocator.free(actual);
                    if (!equal(expected, actual)) return error.InvalidDeclaration;
                    tool_index += 1;
                }
            }
            if (tool_index != request.invocation.tools.items.len) return error.InvalidDeclaration;
            return selected;
        }
    };
}
