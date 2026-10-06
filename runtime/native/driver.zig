//! Stable-address evaluator storage, reachable only by the native task owner.
//! Environmental callbacks receive values/authority, never this handle.
const std = @import("std");
const world = @import("world");
const data = @import("boundary_data");

const Storage = struct {
    parent: std.mem.Allocator,
    budget: world.AllocationBudget,
    prepared: world.Prepared,
    resident: world.Resident,
    live: bool,
};

pub const Driver = opaque {
    fn storage(self: *Driver) *Storage {
        return @ptrCast(@alignCast(self));
    }

    pub fn open(a: std.mem.Allocator, image: []const u8, instance: data.invocation.Instance, working_bytes: usize) !*Driver {
        if (working_bytes == 0) return error.Capacity;
        const owner = try a.create(Storage);
        errdefer a.destroy(owner);
        owner.parent = a;
        owner.budget = .{ .parent = a, .limit = working_bytes };
        owner.prepared = try world.Prepared.init(owner.budget.allocator(), image);
        errdefer owner.prepared.deinit();
        owner.resident = switch (instance) {
            .initial_args => |args| try world.Resident.start(owner.budget.allocator(), &owner.prepared, args),
            .state => |state| try world.Resident.restore(owner.budget.allocator(), &owner.prepared, state),
        };
        owner.live = true;
        return @ptrCast(owner);
    }

    pub fn drive(self: *Driver, output: std.mem.Allocator, control: data.invocation.Control, quantum: u64) ![]u8 {
        const owner = self.storage();
        if (!owner.live) return error.InvalidState;
        return owner.resident.driveEncoded(output, control, .{ .quantum = quantum });
    }
    pub fn checkpoint(self: *Driver, output: std.mem.Allocator) ![]u8 {
        const owner = self.storage();
        if (!owner.live) return error.InvalidState;
        return owner.resident.checkpoint(output);
    }
    pub fn close(self: *Driver) !void {
        const owner = self.storage();
        if (!owner.live) return error.InvalidState;
        try owner.resident.close();
        owner.live = false;
        owner.prepared.deinit();
    }
    /// The task owner may call this only after publishing a checkpoint, or for
    /// an explicitly nondurable demo. A failure leaves the resident owned/live.
    pub fn retire(self: *Driver, output: std.mem.Allocator) ![]u8 {
        const owner = self.storage();
        if (!owner.live) return error.InvalidState;
        const state = try owner.resident.takeCheckpoint(output);
        owner.live = false;
        owner.prepared.deinit();
        return state;
    }
    /// Retired handles remain allocated until the enclosing owner drops them,
    /// allowing all ordinary operations after close to reject before access.
    pub fn destroy(self: *Driver) !void {
        const owner = self.storage();
        if (owner.live) return error.UnfinishedSession;
        owner.parent.destroy(owner);
    }
};
