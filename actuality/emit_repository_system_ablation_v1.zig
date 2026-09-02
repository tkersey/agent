const agent = @import("agent");
const boundary = @import("boundary");
const repository = @import("repository_system")
    .RepositoryRepairSystemMode(agent, boundary, true);
const std = @import("std");
const artifacts = @import("emit_repository_system_v1.zig");

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.InvalidArguments;
    const allocator = init.arena.allocator();
    const image = try allocator.alloc(
        u8,
        repository.System.Source.representation.image_bytes,
    );
    const encoding_workspace = try allocator.create(
        repository.System.Program.ImageEncodingWorkspace,
    );
    const length = try repository.System.Program.encodeImage(
        image,
        encoding_workspace,
    );
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
        try artifacts.writeSourceMap(repository, image[0..length], &output.interface);
    } else return error.InvalidArguments;
    try output.interface.flush();
}
