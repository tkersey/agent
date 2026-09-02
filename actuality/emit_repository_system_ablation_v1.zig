const agent = @import("agent");
const boundary = @import("boundary");
const repository = @import("repository_system")
    .RepositoryRepairEconomySource(agent, boundary);
const std = @import("std");
const artifacts = @import("emit_repository_system_v1.zig");

const AblatedBody = agent.ReactBodyActionDecodeAblation(
    repository.Source,
);
const AblatedProgram = boundary.program(
    "repository-repair-system-v1:action-decode-ablation",
    AblatedBody,
);
const ablated_repository = struct {
    pub const System = struct {
        pub const Source = repository.Source;
        pub const Program = AblatedProgram;
        pub const source_phase_map = AblatedBody.source_phase_map;
    };
};

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.InvalidArguments;
    const allocator = init.arena.allocator();
    const image = if (comptime @hasDecl(
        AblatedProgram,
        "ImageEncodingWorkspace",
    )) try allocator.alloc(
        u8,
        repository.Source.representation.image_bytes,
    ) else @constCast(&AblatedProgram.image().bytes);
    const length = if (comptime @hasDecl(
        AblatedProgram,
        "ImageEncodingWorkspace",
    )) blk: {
        const encoding_workspace = try allocator.create(
            AblatedProgram.ImageEncodingWorkspace,
        );
        break :blk try AblatedProgram.encodeImage(
            image,
            encoding_workspace,
        );
    } else image.len;
    const validation_workspace = try allocator.create(
        boundary.image.ValidationWorkspace,
    );
    validation_workspace.* = .{};
    _ = try boundary.image.validateImageView(
        image[0..length],
        validation_workspace,
    );
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    if (std.mem.eql(u8, args[1], "bpi1")) {
        try output.interface.writeAll(image[0..length]);
    } else if (std.mem.eql(u8, args[1], "source-map")) {
        try artifacts.writeSourceMap(
            ablated_repository,
            image[0..length],
            &output.interface,
        );
    } else return error.InvalidArguments;
    try output.interface.flush();
}
