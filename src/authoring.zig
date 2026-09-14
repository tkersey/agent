//! Agent admission over an application-owned Boundary source module.
const std = @import("std");
const boundary = @import("boundary");
const contracts = @import("agent_contracts");
const admission = @import("admission.zig");
pub const catalogs = @import("catalogs.zig");
const source = boundary.computation;
const p = boundary.data_v2.program;

/// Optional native authoring observations. These callbacks never enter a Module,
/// BPI2, or PST2, and borrow their context only for the compilation call.
pub const CompileStage = enum {
    descriptors,
    application_source,
    agent_admission,
    boundary_compile,
    complete,
};
pub const CompileObserver = struct {
    context: *anyopaque,
    enter: *const fn (*anyopaque, CompileStage) void,
};
pub const CompileOptions = struct {
    observer: ?CompileObserver = null,
    boundary_options: boundary.program.CompileOptions = .{},

    fn stage(self: CompileOptions, next: CompileStage) void {
        if (self.observer) |observer| observer.enter(observer.context, next);
    }
};

pub const Context = struct {
    builder: *source.Builder,
    registry: *admission.Registry,
    catalogs: catalogs.Catalogs = .{},

    pub fn schema(self: Context, comptime T: type) !p.Id {
        return contracts.schema(T, self.builder);
    }

    /// Declare environmental I/O; protected roles still need their checked owner.
    pub fn external(
        self: Context,
        identity: []const u8,
        payload: p.Id,
        result: p.Id,
        role: admission.Role,
    ) !p.Id {
        const effect = try self.builder.effect(.{
            .identity = identity,
            .payload = payload,
            .result = result,
        });
        try self.registry.classify(effect, role);
        return effect;
    }

    pub fn literal(self: Context, comptime T: type, value: T) !p.Id {
        const encoded = try contracts.encodeOwned(T, self.builder.allocator(), value);
        return self.builder.literal(.{ .schema = try self.schema(T), .bytes = encoded });
    }
};

/// The native emitter runs once while authoring. All resulting control is source data.
pub fn system(comptime spec: anytype) type {
    comptime {
        if (catalogs.sourceIssue(spec)) |issue| @compileError("agent.system: " ++ @tagName(issue));
        for (.{ "InitialArgs", "Result", "Failure", "application" }) |name| {
            if (!@hasField(@TypeOf(spec), name))
                @compileError("agent.system requires " ++ name);
        }
        if (!@hasDecl(spec.application, "emit"))
            @compileError("agent.system application must declare emit(context)");
    }
    return struct {
        pub const Source = spec;
        pub const InitialArgs = spec.InitialArgs;
        pub const Result = spec.Result;
        pub const Failure = spec.Failure;
        pub const Application = spec.application;
    };
}

/// Returned output owns its storage and remains valid after the builder is released.
pub fn compile(allocator: std.mem.Allocator, comptime System: type) !source.Compiled {
    return compileObserved(allocator, System, .{});
}

pub fn compileObserved(
    allocator: std.mem.Allocator,
    comptime System: type,
    options: CompileOptions,
) !source.Compiled {
    options.stage(.descriptors);
    var builder = source.Builder.init(allocator);
    defer builder.deinit();
    var registry = admission.Registry.init(builder.allocator());
    defer registry.deinit();
    var context: Context = .{ .builder = &builder, .registry = &registry };
    const initial = try context.schema(System.InitialArgs);
    const result = try context.schema(System.Result);
    const failure = try context.schema(System.Failure);
    context.catalogs = try catalogs.install(context, System.Source);
    options.stage(.application_source);
    const module = try System.Application.emit(context);
    options.stage(.agent_admission);
    if (module.entry >= module.functions.len) return error.InvalidEntry;
    const entry = module.functions[@intCast(module.entry)];
    if (entry.parameters.len != 1 or
        entry.parameters[0] >= module.variables.len or
        module.variables[@intCast(entry.parameters[0])] != initial or
        entry.result != result or module.failure != failure)
        return error.TypeMismatch;
    try admission.verify(allocator, module, &registry);
    options.stage(.boundary_compile);
    const compiled = try boundary.program.compileObserved(allocator, module, options.boundary_options);
    options.stage(.complete);
    return compiled;
}
