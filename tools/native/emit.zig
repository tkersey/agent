//! One host-side compilation emits the canonical image and its ordinary assets.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const definition = @import("definition");
const types = @import("application_types");
const json_schema = agent.contracts.json;
const Schema = struct { schema_id: []const u8, wire_sha256: []const u8, wire_base64url: []const u8, json: std.json.Value };
const Capability = struct { identity: []const u8, resource_role: []const u8, payload_sha256: []const u8, resume_sha256: []const u8 };
const Resource = struct { id: []const u8, version: []const u8, media_type: []const u8, sha256: []const u8, bytes: usize, base64url: []const u8 };

fn digest(a: std.mem.Allocator, bytes: []const u8) ![]const u8 {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &hash, .{});
    return a.dupe(u8, &std.fmt.bytesToHex(hash, .lower));
}
fn base64(a: std.mem.Allocator, bytes: []const u8) ![]const u8 {
    const result = try a.alloc(u8, std.base64.url_safe_no_pad.Encoder.calcSize(bytes.len));
    return std.base64.url_safe_no_pad.Encoder.encode(result, bytes);
}
fn schema(comptime T: type, a: std.mem.Allocator, id: []const u8) !Schema {
    var b = boundary.source.Builder.init(a);
    defer b.deinit();
    const root = try agent.contracts.schema(T, &b);
    const wire = try boundary.data.schema.encodeOwned(a, b.schemas.items, root);
    return .{
        .schema_id = id,
        .wire_sha256 = try digest(a, wire),
        .wire_base64url = try base64(a, wire),
        .json = try std.json.parseFromSliceLeaky(std.json.Value, a, &json_schema.ClientSchema(T).value, .{ .parse_numbers = false }),
    };
}

pub fn main(init: std.process.Init) !void {
    comptime {
        if (definition.System.InitialArgs != types.Input or definition.System.Result != types.Output)
            @compileError("native mappings must name the actual authored system's input and output types");
    }
    var args = init.minimal.args.iterate();
    _ = args.next();
    const image_path = args.next() orelse return error.ExpectedImagePath;
    const application_path = args.next() orelse return error.ExpectedApplicationPath;
    if (args.next() != null) return error.UnexpectedArgument;
    var arena = std.heap.ArenaAllocator.init(init.gpa);
    defer arena.deinit();
    const a = arena.allocator();
    var compiled = try agent.compile(a, definition.System);
    defer compiled.deinit();
    const image = try a.alloc(u8, try boundary.data.program_image.encodedLength(compiled.program));
    _ = try compiled.encode(a, image);

    var capabilities: std.ArrayList(Capability) = .empty;
    for (compiled.program.effects) |effect| {
        if (!effect.external) continue;
        const role: []const u8 = blk: {
            inline for (definition.capabilities) |capability| {
                if (std.mem.eql(u8, capability.identity, effect.identity)) break :blk capability.resource_role;
            }
            return error.UndeclaredNativeCapability;
        };
        const payload = try boundary.data.schema.encodeOwned(a, compiled.program.schemas, effect.payload);
        const resume_value = try boundary.data.schema.encodeOwned(a, compiled.program.schemas, effect.result);
        try capabilities.append(a, .{ .identity = effect.identity, .resource_role = role, .payload_sha256 = try digest(a, payload), .resume_sha256 = try digest(a, resume_value) });
    }
    if (capabilities.items.len != definition.capabilities.len) return error.UnusedOrDuplicateCapability;
    var resources: std.ArrayList(Resource) = .empty;
    var resource_bytes: usize = 0;
    inline for (definition.resources) |resource| {
        resource_bytes = try std.math.add(usize, resource_bytes, resource.bytes.len);
        if (resource.bytes.len > 1024 * 1024 or resource_bytes > 8 * 1024 * 1024) return error.AssetCapacity;
        for (resources.items) |prior| if (std.mem.eql(u8, prior.id, resource.id)) return error.DuplicateResource;
        try resources.append(a, .{ .id = resource.id, .version = resource.version, .media_type = resource.media_type, .sha256 = try digest(a, resource.bytes), .bytes = resource.bytes.len, .base64url = try base64(a, resource.bytes) });
    }
    const metadata = .{
        .format = "agent-native-application/v1",
        .application_id = types.application_id,
        .application_version = types.application_version,
        .program_sha256 = try digest(a, image),
        .program_identity = try a.dupe(u8, &std.fmt.bytesToHex(try boundary.data.program_image.identity(a, compiled.program), .lower)),
        .client_mapping = "agent-client-values/1.0",
        .input = try schema(types.Input, a, types.input_schema_id),
        .output = try schema(types.Output, a, types.output_schema_id),
        .answer = try schema(types.Answer, a, types.answer_schema_id),
        .message = try schema(types.Message, a, types.message_schema_id),
        .capabilities = capabilities.items,
        .resources = resources.items,
    };
    var writer = std.Io.Writer.Allocating.init(a);
    try std.json.Stringify.value(metadata, .{}, &writer.writer);
    try std.Io.Dir.cwd().writeFile(init.io, .{ .sub_path = image_path, .data = image });
    try std.Io.Dir.cwd().writeFile(init.io, .{ .sub_path = application_path, .data = writer.written() });
}
