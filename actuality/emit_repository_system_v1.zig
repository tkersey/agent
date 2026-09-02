const agent = @import("agent");
const boundary = @import("boundary");
const repository = @import("repository_system")
    .RepositoryRepairSystem(agent, boundary);
const std = @import("std");

const initial_goal =
    "Repair the normalizeRange implementation in the admitted repository. " ++
    "Inspect the package, source, and tests; observe the failing baseline; " ++
    "apply one digest-bound source correction; rerun the complete tests; and " ++
    "finish with the actual changed path and final source digest.";
const final_digest = "8bf50f62e3a4294ef359a6b9096d66e5597ce37824b3483ddad541ee21438453";

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 2) return error.InvalidArguments;
    var buffer: [4096]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &buffer);
    if (std.mem.eql(u8, args[1], "bpi1")) {
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
        const workspace = try allocator.create(boundary.image.ValidationWorkspace);
        workspace.* = .{};
        _ = try boundary.image.validateImageView(image[0..length], workspace);
        try output.interface.writeAll(image[0..length]);
    } else if (std.mem.eql(u8, args[1], "initial")) {
        try writeValue(
            repository.Goal,
            repository.Goal.fromSlice(initial_goal) catch unreachable,
            &output.interface,
        );
    } else if (std.mem.eql(u8, args[1], "expected-final")) {
        try writeValue(
            repository.Result,
            .{
                .summary = repository.Summary.fromSlice(
                    "Corrected normalizeRange and verified the complete suite.",
                ) catch unreachable,
                .changed_path = repository.Path.fromSlice(
                    "src/range.mjs",
                ) catch unreachable,
                .final_source_sha256 = repository.Digest.fromSlice(
                    final_digest,
                ) catch unreachable,
            },
            &output.interface,
        );
    } else return error.InvalidArguments;
    try output.interface.flush();
}

fn writeValue(comptime T: type, value: T, output: *std.Io.Writer) !void {
    var bytes: [boundary.schema.maximumEncodedSize(T)]u8 = undefined;
    const length = try boundary.schema.encode(T, value, &bytes);
    try output.writeAll(bytes[0..length]);
}
