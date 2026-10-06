//! Transactional environmental state. World bytes are opaque objects; every
//! acknowledged mutation publishes its receipt, records and events together.
const std = @import("std");
const contracts = @import("agent_contracts");
const sqlite = @import("sqlite.zig");
const state = @import("state.zig");
const Digest = state.Digest;

pub fn digest(bytes: []const u8) Digest {
    var result: Digest = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &result, .{});
    return result;
}

pub const Head = struct { generation: u64, parent: Digest, digest: Digest };
pub const Store = struct {
    allocator: std.mem.Allocator,
    database: *sqlite.Database,
    head: Head,
    transaction: bool = false,
    fenced: bool = false,

    /// The namespace owner has already authenticated the directory, acquired
    /// its OS lock and decided whether this is a new or existing database.
    pub fn init(a: std.mem.Allocator, database: *sqlite.Database, create: bool, namespace: Digest) !Store {
        try database.exec("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE;");
        if (create) {
            try database.exec("BEGIN IMMEDIATE;");
            errdefer database.exec("ROLLBACK;") catch {};
            try database.exec(
                \\CREATE TABLE meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), format INTEGER NOT NULL CHECK(format=1), namespace BLOB NOT NULL, generation INTEGER NOT NULL, parent BLOB NOT NULL, head BLOB NOT NULL);
                \\CREATE TABLE objects(digest BLOB PRIMARY KEY CHECK(length(digest)=32), body BLOB NOT NULL) WITHOUT ROWID;
                \\CREATE TABLE tasks(id BLOB PRIMARY KEY CHECK(length(id)=16), revision INTEGER NOT NULL, terminal INTEGER NOT NULL CHECK(terminal IN(0,1)), body BLOB NOT NULL) WITHOUT ROWID;
                \\CREATE TABLE operations(id TEXT PRIMARY KEY, request BLOB NOT NULL CHECK(length(request)=32), receipt BLOB NOT NULL) WITHOUT ROWID;
                \\CREATE TABLE records(kind TEXT NOT NULL, id BLOB NOT NULL, task BLOB NOT NULL REFERENCES tasks(id), body BLOB NOT NULL, PRIMARY KEY(kind,id)) WITHOUT ROWID;
                \\CREATE TABLE events(task BLOB NOT NULL REFERENCES tasks(id), seq INTEGER NOT NULL, revision INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(task,seq)) WITHOUT ROWID;
            );
            try database.run("INSERT INTO meta VALUES(1,1,?,0,?,?)", &.{ .{ .blob = &namespace }, .{ .blob = &@as(Digest, @splat(0)) }, .{ .blob = &namespace } });
            try database.exec("COMMIT;");
        }
        var query = try database.prepare("SELECT format,namespace,generation,parent,head FROM meta WHERE singleton=1", &.{});
        defer query.deinit();
        if (try query.step() != .row or try query.integer(0) != 1 or !std.mem.eql(u8, try query.bytes(1), &namespace)) return error.CorruptState;
        const generation = try query.integer(2);
        if (generation < 0) return error.CorruptState;
        const parent = try query.bytes(3);
        const head = try query.bytes(4);
        if (parent.len != 32 or head.len != 32) return error.CorruptState;
        return .{ .allocator = a, .database = database, .head = .{ .generation = @intCast(generation), .parent = parent[0..32].*, .digest = head[0..32].* } };
    }

    pub fn begin(self: *Store) !void {
        if (self.fenced) return error.StorageUnavailable;
        if (self.transaction) return error.Busy;
        try self.database.exec("BEGIN IMMEDIATE;");
        self.transaction = true;
    }
    pub fn rollback(self: *Store) void {
        if (!self.transaction) return;
        self.database.exec("ROLLBACK;") catch {
            self.fenced = true;
        };
        self.transaction = false;
    }
    fn writing(self: *Store) !void {
        if (self.fenced or !self.transaction) return error.InvalidState;
    }

    /// The namespace must publish this returned head to its independently
    /// checked seal before acknowledging anything or dispatching an effect.
    pub fn commit(self: *Store, transition: []const u8) !Head {
        try self.writing();
        errdefer self.fenced = true;
        if (self.head.generation == std.math.maxInt(i64)) return error.Capacity;
        var hash = std.crypto.hash.sha2.Sha256.init(.{});
        hash.update("agent.native.store.v1\x00");
        hash.update(&self.head.digest);
        var generation: [8]u8 = undefined;
        std.mem.writeInt(u64, &generation, self.head.generation + 1, .little);
        hash.update(&generation);
        hash.update(transition);
        var next: Head = .{ .generation = self.head.generation + 1, .parent = self.head.digest, .digest = undefined };
        hash.final(&next.digest);
        try self.database.run("UPDATE meta SET generation=?,parent=?,head=? WHERE singleton=1 AND generation=? AND head=?", &.{ .{ .integer = @intCast(next.generation) }, .{ .blob = &next.parent }, .{ .blob = &next.digest }, .{ .integer = @intCast(self.head.generation) }, .{ .blob = &self.head.digest } });
        if (try self.database.changes() != 1) return error.CorruptState;
        try self.database.exec("COMMIT;");
        self.transaction = false;
        self.head = next;
        return next;
    }

    pub fn putObject(self: *Store, bytes: []const u8) !state.Reference {
        try self.writing();
        const ref: state.Reference = .{ .digest = digest(bytes), .bytes = bytes.len };
        try self.database.run("INSERT OR IGNORE INTO objects VALUES(?,?)", &.{ .{ .blob = &ref.digest }, .{ .blob = bytes } });
        // A preexisting hash never authorizes accepting conflicting/corrupt bytes.
        var query = try self.database.prepare("SELECT body FROM objects WHERE digest=?", &.{.{ .blob = &ref.digest }});
        defer query.deinit();
        if (try query.step() != .row or !std.mem.eql(u8, try query.bytes(0), bytes)) return error.CorruptState;
        return ref;
    }
    pub fn object(self: *Store, a: std.mem.Allocator, ref: state.Reference, limit: usize) ![]u8 {
        if (ref.bytes > limit) return error.Capacity;
        var query = try self.database.prepare("SELECT body FROM objects WHERE digest=?", &.{.{ .blob = &ref.digest }});
        defer query.deinit();
        if (try query.step() != .row) return error.MissingArtifact;
        const bytes = try query.bytes(0);
        if (bytes.len != ref.bytes or !std.mem.eql(u8, &digest(bytes), &ref.digest)) return error.CorruptState;
        return a.dupe(u8, bytes);
    }
    /// Private occurrence lookup. Public artifact reads require a separate
    /// task/audience-bound artifact record, never a bare content digest.
    pub fn acquiredObject(self: *Store, a: std.mem.Allocator, id: Digest, limit: usize) ![]u8 {
        var query = try self.database.prepare("SELECT body FROM objects WHERE digest=?", &.{.{ .blob = &id }});
        defer query.deinit();
        if (try query.step() != .row) return error.MissingArtifact;
        const bytes = try query.bytes(0);
        if (bytes.len > limit) return error.Capacity;
        if (!std.mem.eql(u8, &digest(bytes), &id)) return error.CorruptState;
        return a.dupe(u8, bytes);
    }

    /// Idempotency precedes mutable task/question checks. The caller hashes the
    /// admitted typed operation (including method), excluding JSON-RPC id.
    pub fn receipt(self: *Store, a: std.mem.Allocator, id: []const u8, request: Digest) !?[]u8 {
        var query = try self.database.prepare("SELECT request,receipt FROM operations WHERE id=?", &.{.{ .text = id }});
        defer query.deinit();
        if (try query.step() == .done) return null;
        if (!std.mem.eql(u8, try query.bytes(0), &request)) return error.OperationConflict;
        return try a.dupe(u8, try query.bytes(1));
    }
    pub fn savedReceipt(self: *Store, a: std.mem.Allocator, id: []const u8) !?[]u8 {
        var query = try self.database.prepare("SELECT receipt FROM operations WHERE id=?", &.{.{ .text = id }});
        defer query.deinit();
        if (try query.step() == .done) return null;
        return try a.dupe(u8, try query.bytes(0));
    }
    pub fn putReceipt(self: *Store, id: []const u8, request: Digest, bytes: []const u8) !void {
        try self.writing();
        if (id.len == 0 or id.len > 128 or bytes.len > 64 * 1024) return error.Capacity;
        try self.database.run("INSERT INTO operations VALUES(?,?,?)", &.{ .{ .text = id }, .{ .blob = &request }, .{ .blob = bytes } });
    }

    pub fn putTask(self: *Store, task: state.Task, previous: ?u64) !void {
        try self.writing();
        if (task.revision > std.math.maxInt(i64)) return error.Capacity;
        const body = try contracts.encodeOwned(state.Task, self.allocator, task);
        defer self.allocator.free(body);
        if (previous) |revision| {
            if (revision >= std.math.maxInt(i64) or task.revision != revision + 1) return error.StaleRevision;
            try self.database.run("UPDATE tasks SET revision=?,terminal=?,body=? WHERE id=? AND revision=?", &.{ .{ .integer = @intCast(task.revision) }, .{ .integer = @intFromBool(task.terminal()) }, .{ .blob = body }, .{ .blob = &task.id }, .{ .integer = @intCast(revision) } });
            if (try self.database.changes() != 1) return error.StaleRevision;
        } else {
            if (task.revision != 1) return error.StaleRevision;
            try self.database.run("INSERT INTO tasks VALUES(?,?,?,?)", &.{ .{ .blob = &task.id }, .{ .integer = 1 }, .{ .integer = @intFromBool(task.terminal()) }, .{ .blob = body } });
        }
    }
    pub fn taskBytes(self: *Store, a: std.mem.Allocator, id: state.TaskId) ![]u8 {
        var query = try self.database.prepare("SELECT body FROM tasks WHERE id=?", &.{.{ .blob = &id }});
        defer query.deinit();
        if (try query.step() != .row) return error.UnknownTask;
        return a.dupe(u8, try query.bytes(0));
    }
    pub fn putRecord(self: *Store, comptime T: type, comptime kind: []const u8, id: Digest, task: state.TaskId, value: T) !void {
        try self.writing();
        const body = try contracts.encodeOwned(T, self.allocator, value);
        defer self.allocator.free(body);
        try self.database.run("INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body WHERE records.task=excluded.task", &.{ .{ .text = kind }, .{ .blob = &id }, .{ .blob = &task }, .{ .blob = body } });
        if (try self.database.changes() != 1) return error.CorruptState;
    }
    pub fn recordBytes(self: *Store, a: std.mem.Allocator, comptime kind: []const u8, id: Digest, task: state.TaskId) !?[]u8 {
        var query = try self.database.prepare("SELECT body FROM records WHERE kind=? AND id=? AND task=?", &.{ .{ .text = kind }, .{ .blob = &id }, .{ .blob = &task } });
        defer query.deinit();
        if (try query.step() != .row) return null;
        return try a.dupe(u8, try query.bytes(0));
    }
    pub fn taskIds(self: *Store, a: std.mem.Allocator, nonterminal: bool) ![]state.TaskId {
        var query = try self.database.prepare("SELECT id FROM tasks WHERE (?=0 OR terminal=0) ORDER BY id LIMIT 1025", &.{.{ .integer = @intFromBool(nonterminal) }});
        defer query.deinit();
        var ids: std.ArrayList(state.TaskId) = .empty;
        errdefer ids.deinit(a);
        while (try query.step() == .row) {
            const bytes = try query.bytes(0);
            if (bytes.len != 16) return error.CorruptState;
            if (ids.items.len == 1024) return error.Capacity;
            try ids.append(a, bytes[0..16].*);
        }
        return ids.toOwnedSlice(a);
    }
    pub fn putEvent(self: *Store, event: state.Event) !void {
        try self.writing();
        if (event.seq == 0 or event.seq > std.math.maxInt(i64) or event.revision > std.math.maxInt(i64)) return error.Capacity;
        const body = try contracts.encodeOwned(state.Event, self.allocator, event);
        defer self.allocator.free(body);
        try self.database.run("INSERT INTO events VALUES(?,?,?,?)", &.{ .{ .blob = &event.task }, .{ .integer = @intCast(event.seq) }, .{ .integer = @intCast(event.revision) }, .{ .blob = body } });
    }
    pub fn eventsAfter(self: *Store, a: std.mem.Allocator, task: state.TaskId, after: u64, limit: u32) ![][]u8 {
        if (after > std.math.maxInt(i64) or limit == 0 or limit > 128) return error.InvalidParams;
        var query = try self.database.prepare("SELECT body FROM events WHERE task=? AND seq>? ORDER BY seq LIMIT ?", &.{ .{ .blob = &task }, .{ .integer = @intCast(after) }, .{ .integer = limit } });
        defer query.deinit();
        var records: std.ArrayList([]u8) = .empty;
        errdefer {
            for (records.items) |bytes| a.free(bytes);
            records.deinit(a);
        }
        var total: usize = 0;
        while (try query.step() == .row) {
            const bytes = try query.bytes(0);
            if (total + bytes.len > 384 * 1024) break;
            const copied = try a.dupe(u8, bytes);
            errdefer a.free(copied);
            try records.append(a, copied);
            total += bytes.len;
        }
        return records.toOwnedSlice(a);
    }
};

test "objects and immutable admission receipts commit together or disappear together" {
    const a = std.testing.allocator;
    const db = try sqlite.Database.open(a, ":memory:", true);
    defer db.destroy() catch unreachable;
    defer db.close() catch unreachable;
    var store = try Store.init(a, db, true, @splat(7));
    try store.begin();
    const ref = try store.putObject("acquired reply");
    try store.putReceipt("request-1", digest("submit/input"), "accepted/task-1");
    store.rollback();
    try std.testing.expect((try store.receipt(a, "request-1", digest("submit/input"))) == null);
    try std.testing.expectError(error.MissingArtifact, store.object(a, ref, 1024));
    try store.begin();
    _ = try store.putObject("acquired reply");
    try store.putReceipt("request-1", digest("submit/input"), "accepted/task-1");
    const head = try store.commit("admit/task-1");
    try std.testing.expectEqual(1, head.generation);
    const saved = (try store.receipt(a, "request-1", digest("submit/input"))).?;
    defer a.free(saved);
    try std.testing.expectEqualStrings("accepted/task-1", saved);
    try std.testing.expectError(error.OperationConflict, store.receipt(a, "request-1", digest("submit/other-input")));
    const bytes = try store.object(a, ref, 1024);
    defer a.free(bytes);
    try std.testing.expectEqualStrings("acquired reply", bytes);
    const reopened = try Store.init(a, db, false, @splat(7));
    try std.testing.expectEqualDeep(head, reopened.head);
    try std.testing.expectError(error.CorruptState, Store.init(a, db, false, @splat(8)));
}
