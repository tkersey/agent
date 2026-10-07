//! Native read-only projections over the task's already admitted frozen snapshot.
//! No filesystem handles, process execution, or investigation policy live here.
const std = @import("std");
const native = @import("agent_native");
const t = @import("application_types");

pub fn list(a: std.mem.Allocator, snapshot: native.repository.Snapshot, request: t.ListRequest) !t.ListObservation {
    if (request.prefix.bytes.len != 0 and !native.repository.pathAllowed(request.prefix.bytes)) return error.InvalidPath;
    if (request.after.bytes.len != 0 and !native.repository.pathAllowed(request.after.bytes)) return error.InvalidPath;
    var entries: std.ArrayList(t.ListEntry) = .empty;
    var truncated = false;
    for (snapshot.files()) |file| {
        if (!std.mem.startsWith(u8, file.path.bytes, request.prefix.bytes) or
            !std.mem.lessThan(u8, request.after.bytes, file.path.bytes)) continue;
        if (entries.items.len == 32) {
            truncated = true;
            break;
        }
        try entries.append(a, .{ .path = file.path, .bytes = file.contents.bytes.len });
    }
    const value: t.Listing = .{
        .entries = .{ .items = entries.items },
        .truncated = truncated,
        .next = .{ .bytes = if (truncated) entries.items[entries.items.len - 1].path.bytes else "" },
    };
    return .{ .value = value, .model_text = try text(t.Listing, a, value) };
}

pub fn read(a: std.mem.Allocator, snapshot: native.repository.Snapshot, request: t.ReadRequest) !t.ReadObservation {
    const value: t.ReadResult = value: {
        if (!native.repository.pathAllowed(request.path.bytes)) break :value .{ .invalid = .{ .bytes = "Invalid logical snapshot path." } };
        const file = snapshot.get(request.path.bytes) orelse break :value .{ .missing = request.path };
        if (request.maximum == 0 or request.maximum > 4096 or request.start > file.contents.bytes.len)
            break :value .{ .invalid = .{ .bytes = "Read requires maximum 1..4096 and an offset within the file." } };
        const start: usize = @intCast(request.start);
        const end = start + @min(@as(usize, request.maximum), file.contents.bytes.len - start);
        const content = file.contents.bytes[start..end];
        if (!std.unicode.utf8ValidateSlice(content)) break :value .{ .invalid = .{ .bytes = "Selected byte window is not complete UTF-8; adjust its boundaries." } };
        const hex = std.fmt.bytesToHex(file.sha256, .lower);
        break :value .{ .found = .{
            .snapshot = snapshot.identity,
            .path = file.path,
            .sha256 = .{ .bytes = try a.dupe(u8, &hex) },
            .start = start,
            .end = end,
            .file_bytes = file.contents.bytes.len,
            .content = .{ .bytes = content },
        } };
    };
    return .{ .value = value, .model_text = try text(t.ReadResult, a, value) };
}

fn text(comptime T: type, a: std.mem.Allocator, value: T) !t.P.ResultText {
    const bytes = try native.json.canonical(a, try native.values.toJson(T, a, value));
    if (bytes.len > t.P.ResultText.max_length.?) return error.Capacity;
    return .{ .bytes = bytes };
}
