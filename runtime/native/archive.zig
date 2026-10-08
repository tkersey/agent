//! Bounded environmental archives. Canonical World objects and ordinary Agent
//! records travel as data; namespace locks, grants and subscriptions do not.
const std = @import("std");
const contracts = @import("agent_contracts");
const state = @import("state.zig");
const occurrence = @import("occurrence.zig");
const storage = @import("store.zig");
const values = @import("values.zig");
const json = @import("json.zig");
const namespace = @import("namespace.zig");
const c = @import("native_c");

pub const maximum_bytes = storage.state_bytes;
const maximum_object = 16 * 1024 * 1024;
const maximum_manifest = 1024 * 1024;
const maximum_schema = 64 * 1024;
const magic = "AGNX0001";
const temporary_prefix = ".agent-archive-";
const temporary_length = temporary_prefix.len + 32;
pub const Exported = struct { sha256: state.Digest, bytes: u64 };
const Blob = struct { reference: state.Reference, bytes: []const u8 };
const SchemaSet = struct { schemas: []const state.ArchiveSchema, blobs: []const Blob };

fn schemaSet(a: std.mem.Allocator) !SchemaSet {
    var schemas: std.ArrayList(state.ArchiveSchema) = .empty;
    var blobs: std.ArrayList(Blob) = .empty;
    inline for (.{ .{ "task", state.Task }, .{ "event", state.Event }, .{ "receipt", state.Receipt } }) |entry| {
        const bytes = try values.schemaBytes(entry[1], a);
        const reference: state.Reference = .{ .digest = storage.digest(bytes), .bytes = bytes.len };
        try schemas.append(a, .{ .name = .{ .bytes = entry[0] }, .definition = reference });
        try blobs.append(a, .{ .reference = reference, .bytes = bytes });
    }
    inline for (@typeInfo(state.RecordKind).@"enum".field_names) |name| {
        const bytes = try values.schemaBytes(storage.Record(name), a);
        const reference: state.Reference = .{ .digest = storage.digest(bytes), .bytes = bytes.len };
        try schemas.append(a, .{ .name = .{ .bytes = name }, .definition = reference });
        try blobs.append(a, .{ .reference = reference, .bytes = bytes });
    }
    return .{ .schemas = try schemas.toOwnedSlice(a), .blobs = try blobs.toOwnedSlice(a) };
}

fn same(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}
fn readAt(fd: c_int, offset: u64, bytes: []u8) !void {
    var position: usize = 0;
    while (position < bytes.len) {
        const count = c.pread(fd, bytes[position..].ptr, bytes.len - position, @intCast(offset + position));
        if (count < 0 and std.c.errno(count) == .INTR) continue;
        if (count <= 0) return error.InvalidArchive;
        position += @intCast(count);
    }
}
fn privateFile(fd: c_int) !u64 {
    var stat: c.struct_agent_native_stat = undefined;
    if (c.agent_native_fstat(fd, &stat) != 0) return error.StorageUnavailable;
    if (stat.st_mode & c.S_IFMT != c.S_IFREG or stat.st_mode & 0o077 != 0 or stat.st_uid != c.geteuid() or stat.st_size < 0) return error.UnsafeStatePath;
    return @intCast(stat.st_size);
}
fn parent(a: std.mem.Allocator, path: []const u8) !struct { fd: c_int, name: [:0]u8 } {
    if (path.len == 0 or path.len > 4096 or path[path.len - 1] == '/' or std.mem.indexOfScalar(u8, path, 0) != null) return error.InvalidParams;
    const name = std.fs.path.basename(path);
    if (same(name, ".") or same(name, "..")) return error.InvalidParams;
    const directory = try namespace.openDirectory(a, std.fs.path.dirname(path) orelse ".", false, false);
    errdefer _ = c.close(directory);
    return .{ .fd = directory, .name = try a.dupeSentinel(u8, name, 0) };
}

const Output = struct {
    allocator: std.mem.Allocator,
    directory: c_int,
    fd: c_int,
    name: [:0]u8,
    temporary: [temporary_length:0]u8,
    hash: std.crypto.hash.sha2.Sha256 = .init(.{}),
    bytes: u64 = 0,

    fn open(a: std.mem.Allocator, io: std.Io, path: []const u8, state_directory: c_int) !Output {
        const location = try parent(a, path);
        errdefer {
            _ = c.close(location.fd);
            a.free(location.name);
        }
        var source: c.struct_agent_native_stat = undefined;
        var destination: c.struct_agent_native_stat = undefined;
        if (c.agent_native_fstat(state_directory, &source) != 0 or c.agent_native_fstat(location.fd, &destination) != 0) return error.StorageUnavailable;
        if (source.st_dev == destination.st_dev and source.st_ino == destination.st_ino) return error.UnsafeStatePath;
        var random: [16]u8 = undefined;
        try io.randomSecure(&random);
        var temporary: [temporary_length:0]u8 = undefined;
        @memcpy(temporary[0..temporary_prefix.len], temporary_prefix);
        @memcpy(temporary[temporary_prefix.len..temporary_length], &std.fmt.bytesToHex(random, .lower));
        temporary[temporary_length] = 0;
        const fd = c.openat(location.fd, &temporary, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW | c.O_CLOEXEC, @as(c_uint, 0o600));
        if (fd < 0) return error.StorageUnavailable;
        return .{ .allocator = a, .directory = location.fd, .fd = fd, .name = location.name, .temporary = temporary };
    }
    fn deinit(self: *Output) void {
        _ = c.close(self.fd);
        _ = c.unlinkat(self.directory, &self.temporary, 0);
        _ = c.close(self.directory);
        self.allocator.free(self.name);
    }
    fn write(self: *Output, bytes: []const u8) !void {
        if (self.bytes + bytes.len > maximum_bytes) return error.Capacity;
        var offset: usize = 0;
        while (offset < bytes.len) {
            const count = c.write(self.fd, bytes[offset..].ptr, bytes.len - offset);
            if (count < 0 and std.c.errno(count) == .INTR) continue;
            if (count <= 0) return error.StorageUnavailable;
            offset += @intCast(count);
        }
        self.hash.update(bytes);
        self.bytes += bytes.len;
    }
    fn finish(self: *Output) !Exported {
        if (c.fsync(self.fd) != 0) return error.StorageUnavailable;
        // Atomic, no-replace publication on the same filesystem. A crash may
        // retain the private temporary hard link, not a partial final archive.
        if (c.linkat(self.directory, &self.temporary, self.directory, self.name.ptr, 0) != 0)
            return if (std.c.errno(-1) == .EXIST) error.AlreadyExists else error.StorageUnavailable;
        if (c.fsync(self.directory) != 0) return error.StorageUnavailable;
        if (c.unlinkat(self.directory, &self.temporary, 0) != 0 or c.fsync(self.directory) != 0) return error.StorageUnavailable;
        var digest: state.Digest = undefined;
        self.hash.final(&digest);
        return .{ .sha256 = digest, .bytes = self.bytes };
    }
};

pub const Reader = struct {
    allocator: std.mem.Allocator,
    fd: c_int,
    prefix: []u8,
    manifest: contracts.Decoded(state.Archive),
    identity: state.Digest,
    bytes: u64,

    pub fn open(a: std.mem.Allocator, path: []const u8) !Reader {
        const location = try parent(a, path);
        defer {
            _ = c.close(location.fd);
            a.free(location.name);
        }
        const fd = c.openat(location.fd, location.name.ptr, c.O_RDONLY | c.O_NONBLOCK | c.O_NOFOLLOW | c.O_CLOEXEC);
        if (fd < 0) return error.NotFound;
        errdefer _ = c.close(fd);
        const length = try privateFile(fd);
        if (length < 32 or length > maximum_bytes) return error.InvalidArchive;
        var header: [32]u8 = undefined;
        try readAt(fd, 0, &header);
        if (!same(header[0..8], magic) or std.mem.readInt(u32, header[20..24], .little) != 0) return error.InvalidArchive;
        const schema_len = std.mem.readInt(u32, header[8..12], .little);
        const manifest_len = std.mem.readInt(u32, header[12..16], .little);
        const count = std.mem.readInt(u32, header[16..20], .little);
        const body_len = std.mem.readInt(u64, header[24..32], .little);
        if (schema_len > maximum_schema or manifest_len > maximum_manifest or body_len > maximum_bytes or @as(u64, 32) + schema_len + manifest_len + body_len != length) return error.InvalidArchive;
        const prefix = try a.alloc(u8, 32 + schema_len + manifest_len);
        errdefer a.free(prefix);
        try readAt(fd, 0, prefix);
        if (!same(prefix[0..32], &header)) return error.InvalidArchive;
        const expected_schema = try values.schemaBytes(state.Archive, a);
        defer a.free(expected_schema);
        if (!same(prefix[32 .. 32 + schema_len], expected_schema)) return error.NonPortable;
        var manifest = contracts.decodeOwned(state.Archive, a, prefix[32 + schema_len ..]) catch |err| return if (err == error.OutOfMemory) err else error.InvalidArchive;
        errdefer manifest.deinit();
        const value = manifest.value;
        if (value.version != 1 or count != value.objects.items.len) return error.NonPortable;
        var total: u64 = 0;
        for (value.objects.items, 0..) |ref, i| {
            if (ref.bytes > maximum_object or (i != 0 and std.mem.order(u8, &value.objects.items[i - 1].digest, &ref.digest) != .lt)) return error.InvalidArchive;
            total = try std.math.add(u64, total, ref.bytes);
        }
        if (total != body_len) return error.InvalidArchive;
        var hash = std.crypto.hash.sha2.Sha256.init(.{});
        hash.update(prefix);
        var buffer: [64 * 1024]u8 = undefined;
        var offset: u64 = prefix.len;
        while (offset < length) {
            const size: usize = @intCast(@min(buffer.len, length - offset));
            try readAt(fd, offset, buffer[0..size]);
            hash.update(buffer[0..size]);
            offset += size;
        }
        var identity: state.Digest = undefined;
        hash.final(&identity);
        return .{ .allocator = a, .fd = fd, .prefix = prefix, .manifest = manifest, .identity = identity, .bytes = length };
    }
    pub fn deinit(self: *Reader) void {
        self.manifest.deinit();
        self.allocator.free(self.prefix);
        _ = c.close(self.fd);
    }
    /// Preview only declared, digest-checked immutable data. Import still
    /// reacquires and authenticates the complete archive before publication.
    pub fn object(self: *Reader, a: std.mem.Allocator, wanted: state.Reference, limit: usize) ![]u8 {
        if (wanted.bytes > limit) return error.Capacity;
        var offset: u64 = self.prefix.len;
        for (self.manifest.value.objects.items) |reference| {
            if (same(&reference.digest, &wanted.digest)) {
                if (reference.bytes != wanted.bytes) return error.InvalidArchive;
                const bytes = try a.alloc(u8, @intCast(reference.bytes));
                errdefer a.free(bytes);
                try readAt(self.fd, offset, bytes);
                if (!same(&storage.digest(bytes), &reference.digest)) return error.InvalidArchive;
                return bytes;
            }
            offset += reference.bytes;
        }
        return error.MissingArtifact;
    }
    pub fn acquire(self: *Reader, store: *storage.Store) !void {
        if (!store.transaction or store.fenced) return error.InvalidState;
        const prefix = try self.allocator.alloc(u8, self.prefix.len);
        defer self.allocator.free(prefix);
        try readAt(self.fd, 0, prefix);
        if (!same(prefix, self.prefix)) return error.InvalidArchive;
        var hash = std.crypto.hash.sha2.Sha256.init(.{});
        hash.update(prefix);
        var offset: u64 = prefix.len;
        for (self.manifest.value.objects.items) |ref| {
            const bytes = try self.allocator.alloc(u8, @intCast(ref.bytes));
            defer self.allocator.free(bytes);
            try readAt(self.fd, offset, bytes);
            if (!same(&storage.digest(bytes), &ref.digest)) return error.InvalidArchive;
            _ = try store.putObject(bytes);
            hash.update(bytes);
            offset += bytes.len;
        }
        var identity: state.Digest = undefined;
        hash.final(&identity);
        if (!same(&identity, &self.identity) or try privateFile(self.fd) != self.bytes) return error.InvalidArchive;
    }
};

pub fn record(archive: state.Archive, kind: state.RecordKind, id: state.Digest) ?state.Reference {
    for (archive.records.items) |row| if (row.kind == kind and same(&row.id, &id)) return row.body;
    return null;
}

const Collector = struct {
    allocator: std.mem.Allocator,
    store: *storage.Store,
    supplied: []const Blob,
    objects: std.AutoArrayHashMapUnmanaged(state.Digest, state.Reference) = .empty,
    bytes: u64 = 0,

    fn add(self: *Collector, ref: state.Reference) !void {
        if (ref.bytes > maximum_object) return error.Capacity;
        if (self.objects.get(ref.digest)) |prior| {
            if (prior.bytes != ref.bytes) return error.CorruptState;
            return;
        }
        if (self.objects.count() == 4096 or self.bytes + ref.bytes > maximum_bytes) return error.Capacity;
        var supplied = false;
        for (self.supplied) |blob| if (same(&blob.reference.digest, &ref.digest)) {
            if (blob.bytes.len != ref.bytes) return error.CorruptState;
            supplied = true;
            break;
        };
        if (!supplied) {
            const actual = try self.store.objectReference(ref.digest, maximum_object);
            if (actual.bytes != ref.bytes) return error.CorruptState;
        }
        try self.objects.put(self.allocator, ref.digest, ref);
        self.bytes += ref.bytes;
    }
    fn visit(self: *Collector, comptime T: type, value: T) !void {
        if (T == state.Reference) return self.add(value);
        switch (@typeInfo(T)) {
            .@"struct" => |info| inline for (info.field_names, info.field_types) |name, Field| try self.visit(Field, @field(value, name)),
            .optional => |info| if (value) |child| try self.visit(info.child, child),
            .@"union" => |info| inline for (info.field_names, info.field_types) |name, Field| {
                if (same(@tagName(value), name)) try self.visit(Field, @field(value, name));
            },
            .pointer => |info| if (info.size == .slice and info.child != u8) {
                for (value) |child| try self.visit(info.child, child);
            },
            .array => |info| if (info.child != u8) {
                for (value) |child| try self.visit(info.child, child);
            },
            else => {},
        }
    }
    fn reply(self: *Collector, value: occurrence.Acquired) !void {
        try self.add(try self.store.objectReference(value.reply, 4 * 1024 * 1024));
    }
};

pub const Inspected = struct { task: contracts.Decoded(state.Task), objects: []state.Reference, current: ?occurrence.Occurrence };

/// Events are retained projections, not an independently authoritative history.
/// Check facts whose owners survive in the archive; an old question need not be
/// pending, and an old queued message may since have been consumed or retired.
fn validateEventFacts(store: *storage.Store, archive: state.Archive, task: state.Task, event: state.Event) !void {
    var arena = std.heap.ArenaAllocator.init(store.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const data = (try json.parse(a, event.data.bytes, .{})).value;
    const expected: json.Value = switch (event.kind) {
        .completed, .failed, .cancelled => {
            if (!same(@tagName(event.kind), @tagName(task.outcome_kind))) return error.InvalidArchive;
            return;
        },
        .input_required => blk: {
            var id: state.Digest = undefined;
            _ = std.fmt.hexToBytes(&id, data.object.get("question_id").?.string) catch return error.InvalidArchive;
            const reference = record(archive, .question, id) orelse return error.InvalidArchive;
            const bytes = try store.object(a, reference, 256 * 1024);
            const question = (try contracts.decodeOwned(state.Question, a, bytes)).value;
            const prompt = try store.object(a, question.prompt, 32 * 1024);
            break :blk try state.questionData(a, question, prompt);
        },
        .message_queued, .message_consumed, .message_not_consumed => blk: {
            var id: state.Digest = undefined;
            _ = std.fmt.hexToBytes(&id, data.object.get("message_id").?.string) catch return error.InvalidArchive;
            const reference = record(archive, .message, id) orelse return error.InvalidArchive;
            const bytes = try store.object(a, reference, 256 * 1024);
            const message = (try contracts.decodeOwned(state.Message, a, bytes)).value;
            const disposition: state.MessageDisposition = switch (event.kind) {
                .message_queued => .queued,
                .message_consumed => .consumed,
                .message_not_consumed => .not_consumed,
                else => unreachable,
            };
            if (disposition != .queued and disposition != message.disposition) return error.InvalidArchive;
            break :blk try state.messageData(a, message, disposition);
        },
        else => return,
    };
    if (!same(try json.canonical(a, data), try json.canonical(a, expected))) return error.InvalidArchive;
}

/// Every ordinary Reference is traversed structurally. The occurrence owner
/// additionally identifies its private acquired-reply digest. Unknown record
/// kinds cannot disappear through an open-ended serialization fallback.
pub fn inspect(a: std.mem.Allocator, store: *storage.Store, archive: state.Archive, supplied_build: ?[]const u8) !Inspected {
    const expected = try schemaSet(a);
    var supplied: std.ArrayList(Blob) = .empty;
    if (supplied_build) |bytes| {
        try supplied.append(a, .{ .reference = archive.build, .bytes = bytes });
        try supplied.appendSlice(a, expected.blobs);
    }
    var collector: Collector = .{ .allocator = a, .store = store, .supplied = supplied.items };
    defer collector.objects.deinit(a);
    try collector.add(archive.task);
    try collector.add(archive.build);
    if (archive.schemas.items.len != expected.schemas.len) return error.NonPortable;
    for (archive.schemas.items, expected.schemas) |declared, wanted| {
        if (!same(declared.name.bytes, wanted.name.bytes) or declared.definition.bytes != wanted.definition.bytes or !same(&declared.definition.digest, &wanted.definition.digest)) return error.NonPortable;
        try collector.add(declared.definition);
    }
    const task_bytes = try store.object(store.allocator, archive.task, 256 * 1024);
    defer store.allocator.free(task_bytes);
    var task = try contracts.decodeOwned(state.Task, store.allocator, task_bytes);
    errdefer task.deinit();
    const value = task.value;
    try collector.visit(state.Task, value);
    if (value.revision == 0 or value.revision > std.math.maxInt(i64) or value.execution_revision >= value.revision or value.event_floor == 0 or value.event_high < value.event_floor or value.event_high > std.math.maxInt(i64)) return error.CorruptState;
    var current: ?occurrence.Occurrence = null;
    var inference_attempts: u32 = 0;
    var inference_bytes: u64 = 0;
    for (archive.records.items, 0..) |row, index| {
        for (archive.records.items[0..index]) |prior| if (prior.kind == row.kind and same(&prior.id, &row.id)) return error.InvalidArchive;
        try collector.add(row.body);
        const bytes = try store.object(store.allocator, row.body, 256 * 1024);
        defer store.allocator.free(bytes);
        inline for (@typeInfo(state.RecordKind).@"enum".field_names) |kind| {
            if (row.kind == @field(state.RecordKind, kind)) {
                const T = storage.Record(kind);
                var decoded = try contracts.decodeOwned(T, store.allocator, bytes);
                defer decoded.deinit();
                const item = decoded.value;
                if (comptime @hasField(T, "id")) if (!same(&item.id, &row.id)) return error.CorruptState;
                if (comptime same(kind, "artifact")) {
                    if (item.task == null or !same(&item.task.?, &value.id)) return error.CorruptState;
                } else if (!same(&item.task, &value.id)) return error.CorruptState;
                try collector.visit(T, item);
                if (comptime same(kind, "occurrence")) {
                    switch (item.state) {
                        .dispatching, .unknown, .captured => return error.UnsettledOccurrence,
                        .settled_reply => |acquired| try collector.reply(acquired),
                        .admitted => |admitted| if (admitted == .reply) try collector.reply(admitted.reply),
                        else => {},
                    }
                    if (value.current_occurrence) |id| if (same(&id, &item.id)) {
                        if (item.state == .admitted) return error.CorruptState;
                        current = item;
                    };
                } else if (comptime same(kind, "attempt")) {
                    if (item.inference) {
                        inference_attempts = try std.math.add(u32, inference_attempts, 1);
                        inference_bytes = try std.math.add(u64, inference_bytes, if (item.prepared) |body| body.bytes else item.request.bytes);
                    }
                } else if (comptime same(kind, "capture")) {
                    if (item.disposition != .complete or item.response == null or item.projection == null) return error.UnsettledOccurrence;
                    if (!same(&item.attempt, &row.id) or record(archive, .attempt, item.attempt) == null) return error.CorruptState;
                } else if (comptime same(kind, "message")) {
                    // Pending membership is an equality, not just validation
                    // of whichever queue entries the archive retained.
                    var queued = false;
                    for (value.messages.items) |id| if (same(&id, &item.id)) {
                        queued = true;
                        break;
                    };
                    if (queued != (item.disposition == .queued or item.disposition == .acquired)) return error.InvalidArchive;
                } else if (comptime same(kind, "origin")) {
                    if (item.source_revision == 0 or item.source_revision >= value.revision) return error.CorruptState;
                }
            }
        }
    }
    if (inference_attempts != value.inference_attempts or inference_bytes != value.inference_request_bytes or (value.current_occurrence != null) != (current != null) or (value.outcome_kind == .requested) != (current != null)) return error.CorruptState;
    if (current) |pending| if (pending.state == .awaiting and record(archive, .question, pending.state.awaiting.question) == null) return error.CorruptState;
    for (value.messages.items, 0..) |id, i| {
        if (record(archive, .message, id) == null) return error.CorruptState;
        for (value.messages.items[0..i]) |prior| if (same(&id, &prior)) return error.CorruptState;
    }
    var next = value.event_floor;
    var revision: u64 = 0;
    for (archive.events.items) |row| {
        if (row.seq != next or row.revision == 0 or row.revision < revision or row.revision > value.revision) return error.CorruptState;
        try collector.add(row.body);
        const bytes = try store.object(store.allocator, row.body, 256 * 1024);
        defer store.allocator.free(bytes);
        var decoded = try contracts.decodeOwned(state.Event, store.allocator, bytes);
        defer decoded.deinit();
        if (!same(&decoded.value.task, &value.id) or decoded.value.seq != row.seq or decoded.value.revision != row.revision) return error.CorruptState;
        try @import("schemas.zig").validateEventData(store.allocator, decoded.value.kind, decoded.value.data.bytes);
        try validateEventFacts(store, archive, value, decoded.value);
        next += 1;
        revision = row.revision;
    }
    if (next - 1 != value.event_high) return error.CorruptState;
    for (archive.operations.items, 0..) |row, i| {
        for (archive.operations.items[0..i]) |prior| if (same(row.key.bytes, prior.key.bytes)) return error.InvalidArchive;
        try collector.add(row.body);
        const bytes = try store.object(store.allocator, row.body, 256 * 1024);
        defer store.allocator.free(bytes);
        var decoded = try contracts.decodeOwned(state.Receipt, store.allocator, bytes);
        defer decoded.deinit();
        if (!same(&decoded.value.task, &value.id) or !same(&decoded.value.request_digest, &row.request) or decoded.value.revision == 0 or decoded.value.revision > value.revision) return error.CorruptState;
        // An acknowledged follow-up cannot disappear by deleting both its row
        // and its queue entry while retaining the immutable admission receipt.
        if (decoded.value.method == .message and decoded.value.message == null) return error.InvalidArchive;
        if (decoded.value.message) |id| if (record(archive, .message, id) == null) return error.InvalidArchive;
        if (decoded.value.method == .respond and decoded.value.question == null) return error.InvalidArchive;
        if (decoded.value.question) |id| if (record(archive, .question, id) == null) return error.InvalidArchive;
    }
    const reserved: ?state.Digest = if (current) |pending| if (pending.state == .settled_reply and record(archive, .attempt, pending.state.settled_reply.attempt) != null) pending.state.settled_reply.attempt else null else null;
    if (archive.reservations.items.len != @intFromBool(reserved != null)) return error.CorruptState;
    if (reserved) |attempt| if (!same(&archive.reservations.items[0].attempt, &attempt) or archive.reservations.items[0].bytes != storage.acquired_reserve) return error.CorruptState;
    const objects = try a.dupe(state.Reference, collector.objects.values());
    std.mem.sort(state.Reference, objects, {}, struct {
        fn less(_: void, left: state.Reference, right: state.Reference) bool {
            return std.mem.order(u8, &left.digest, &right.digest) == .lt;
        }
    }.less);
    if (supplied_build == null) {
        if (objects.len != archive.objects.items.len) return error.InvalidArchive;
        for (objects, archive.objects.items) |actual, declared| if (actual.bytes != declared.bytes or !same(&actual.digest, &declared.digest)) return error.InvalidArchive;
    }
    return .{ .task = task, .objects = objects, .current = current };
}

pub fn write(a: std.mem.Allocator, io: std.Io, store: *storage.Store, task: state.TaskId, build: []const u8, path: []const u8, state_directory: c_int) !Exported {
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const temporary = arena.allocator();
    var manifest = try store.archiveIndex(temporary, task, .{ .digest = storage.digest(build), .bytes = build.len });
    const definitions = try schemaSet(temporary);
    manifest.schemas.items = definitions.schemas;
    var inspected = try inspect(temporary, store, manifest, build);
    defer inspected.task.deinit();
    manifest.objects.items = inspected.objects;
    const schema = try values.schemaBytes(state.Archive, temporary);
    const encoded = try contracts.encodeOwned(state.Archive, temporary, manifest);
    if (schema.len > maximum_schema or encoded.len > maximum_manifest) return error.Capacity;
    var total: u64 = 0;
    for (manifest.objects.items) |ref| total = try std.math.add(u64, total, ref.bytes);
    if (32 + schema.len + encoded.len + total > maximum_bytes) return error.Capacity;
    var header: [32]u8 = @splat(0);
    @memcpy(header[0..8], magic);
    std.mem.writeInt(u32, header[8..12], @intCast(schema.len), .little);
    std.mem.writeInt(u32, header[12..16], @intCast(encoded.len), .little);
    std.mem.writeInt(u32, header[16..20], @intCast(manifest.objects.items.len), .little);
    std.mem.writeInt(u64, header[24..32], total, .little);
    var output = try Output.open(a, io, path, state_directory);
    defer output.deinit();
    try output.write(&header);
    try output.write(schema);
    try output.write(encoded);
    for (manifest.objects.items) |ref| {
        var supplied: ?[]const u8 = if (same(&ref.digest, &manifest.build.digest)) build else null;
        for (definitions.blobs) |blob| if (same(&ref.digest, &blob.reference.digest)) {
            supplied = blob.bytes;
            break;
        };
        if (supplied) |content| {
            // A supplied immutable schema/build asset is not a license to mask
            // corruption of a previously imported copy in the same store.
            const prior = store.object(a, ref, maximum_object) catch |err| switch (err) {
                error.MissingArtifact => null,
                else => return err,
            };
            if (prior) |bytes| {
                defer a.free(bytes);
                if (!same(bytes, content)) return error.CorruptState;
            }
            try output.write(content);
        } else {
            const bytes = try store.object(a, ref, maximum_object);
            defer a.free(bytes);
            try output.write(bytes);
        }
    }
    return output.finish();
}
