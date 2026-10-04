from pathlib import Path
import re
r = Path('.')
p = r / 'build_agent4.zig'
s = p.read_text()
helper = '''// A fixture selection changes execution, not its compiler/module graph.
const Executable = struct {
    artifact: *std.Build.Step.Compile,
    fixture: ?[]const u8 = null,

    fn select(executable: Executable, name: []const u8) Executable {
        std.debug.assert(executable.fixture == null);
        return .{ .artifact = executable.artifact, .fixture = name };
    }
    fn addArgument(executable: Executable, run: *std.Build.Step.Run) void {
        run.addArtifactArg2(executable.artifact, .{});
        if (executable.fixture) |name| run.setEnvironmentVariable("AGENT4_FIXTURE", name);
    }
    fn getEmittedBin(executable: Executable) std.Build.LazyPath {
        // Callers that invoke the raw path must not lose a fixture selection.
        std.debug.assert(executable.fixture == null);
        return executable.artifact.getEmittedBin();
    }
};

'''
s = s.replace('const Graph = struct {', helper + 'const Graph = struct {', 1)
s = s.replace('fn emitter(g: Graph, name: []const u8, module_value: *std.Build.Module) *std.Build.Step.Compile {', 'fn emitter(g: Graph, name: []const u8, module_value: *std.Build.Module) Executable {', 1)
s = s.replace('''        return executable;
    }
    fn emit(g: Graph, step: *std.Build.Step, executable: *std.Build.Step.Compile, args: []const []const u8, name: []const u8) void {
        const run = g.b.addRunArtifact(executable);''', '''        return .{ .artifact = executable };
    }
    fn runArtifact(g: Graph, executable: Executable) *std.Build.Step.Run {
        const run = g.b.addRunArtifact(executable.artifact);
        if (executable.fixture) |name| {
            run.setEnvironmentVariable("AGENT4_FIXTURE", name);
            run.step.name = g.b.fmt("run fixture {s}", .{name});
        }
        return run;
    }
    fn emit(g: Graph, step: *std.Build.Step, executable: Executable, args: []const []const u8, name: []const u8) void {
        const run = g.runArtifact(executable);''', 1)
core = {
    'composed_emitter': ('composed-owners', 'agent4/composed_owners.zig'),
    'selection_emitter': ('recursive-selection', 'agent4/recursive_selection.zig'),
    'delivery_emitter': ('parser-delivery', 'agent4/parser_delivery.zig'),
    'proposal_emitter': ('parser-proposals', 'agent4/parser_proposals.zig'),
    'parser_schema': ('parser-schema', 'agent4/parser_tools.zig'),
    'participant_exe': ('agent-participant', 'agent4/participant.zig'),
    'recursive_exe': ('agent-recursive-participant', 'agent4/recursive_participant.zig'),
    'text_object': ('agent-text-object', 'agent4/text_object.zig'),
    'mobility_consumer': ('agent-mobility-consumer', 'consumers/mobility/main.zig'),
    'mobility_approval_consumer': ('agent-mobility-approval', 'consumers/mobility/approval.zig'),
    'mobility_ensure': ('agent-mobility-ensure', 'agent4/mobility_ensure.zig'),
    'text_link': ('agent-text-link', 'agent4/text_link.zig'),
    'inquiry_exe': ('agent4-inquiry-probe', 'agent4/inquiry_probe.zig'),
    'inquiry_broker_exe': ('agent4-inquiry-broker', 'agent4/inquiry_broker_probe.zig'),
    'approval_exe': ('agent4-approval', 'agent4/approval_probe.zig'),
}
applications = {
    'parser_app': ('parser-construction', 'consumers/incremental-parser/main.zig'),
    'repository_app': ('repository-application', 'consumers/repository/main.zig'),
    'inquiry_app_exe': ('agent4-inquiry-application', 'consumers/inquiry/main.zig'),
    'review_exe': ('agent4-review', 'consumers/review/main.zig'),
    'document_exe': ('agent4-document', 'consumers/document/main.zig'),
    'clarification_economy': ('clarification-scaling', 'agent4/clarification.zig'),
}
variables = re.findall(r'const (\w+) = g.emitter\(', s)
for group, items in [('fixture_driver', core), ('application_driver', applications)]:
    for variable, (name, path) in items.items():
        s, count = re.subn(rf'const {variable} = g\.emitter\([^\n]+\);', f'const {variable} = {group}.select("{name}");', s)
        assert count == 1, (variable, count)
for variable in variables:
    s = s.replace(f'b.addRunArtifact({variable})', f'g.runArtifact({variable})')
    s = s.replace(f'b.addInstallArtifact({variable},', f'b.addInstallArtifact({variable}.artifact,')
s = s.replace('selection_negative.addArtifactArg2(selection_emitter, .{});', 'selection_emitter.addArgument(selection_negative);')
s = s.replace('disposition_negative.addArtifactArg2(parser_app, .{});', 'parser_app.addArgument(disposition_negative);')
start = '    const check = b.step("agent4-authoring-tests", "Authoring test implementation");'
s = s.replace(start, '''    const fixture_driver = g.emitter("agent4-fixtures", g.module("test/fixture_driver.zig"));
    const application_driver = g.emitter("agent4-applications", g.module("test/application_driver.zig"));
''' + start)
s = s.replace('g.testModule(check, g.module("test/agent4/authoring_tests.zig"));', 'g.testModule(check, g.module("test/authoring_tests.zig"));')
for line in ['    check.dependOn(mobility);\n', '    check.dependOn(participants);\n', '    check.dependOn(selection_check);\n', '    g.testModule(check, inquiry);\n', '    g.testModule(check, inquiry_broker);\n', '    g.testModule(check, inquiry_app);\n', '    const review = g.module("test/consumers/review/main.zig");\n']:
    assert line in s, line
    s = s.replace(line, '')
s = s.replace('    check.dependOn(zig17);\n', '    check.dependOn(&zig17_node.step);\n')
s = s.replace('"test/agent4", "test/consumers" });', '"test/agent4", "test/consumers", "test/fixture_driver.zig", "test/application_driver.zig", "test/authoring_tests.zig" });')
p.write_text(s)
for filename, items in [('fixture_driver.zig', core), ('application_driver.zig', applications)]:
    text = '''//! Compile compatible fixture constructors once; each call still gets a fresh process.
//! AGENT4_FIXTURE is an explicit build-run input. It does not alter the fixture CLI.
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const selected = init.environ_map.get("AGENT4_FIXTURE") orelse return error.ExpectedFixture;
'''
    for name, path in items.values():
        text += f'    if (std.mem.eql(u8, selected, "{name}")) return @import("{path}").main(init);\n'
    text += '    return error.UnknownFixture;\n}\n'
    (r / 'test' / filename).write_text(text)
(r / 'test/authoring_tests.zig').write_text('''//! Compatible public authoring contracts. Private and alternate-module roots stay separate.
test {
    _ = @import("agent4/authoring_tests.zig");
    _ = @import("agent4/catalogs.zig");
    _ = @import("agent4/participant.zig");
    _ = @import("agent4/composed_owners.zig");
    _ = @import("agent4/recursive_participant.zig");
    _ = @import("agent4/selection.zig");
    _ = @import("agent4/mobility_ensure.zig");
    _ = @import("agent4/inquiry_probe.zig");
    _ = @import("agent4/inquiry_broker_probe.zig");
    _ = @import("consumers/inquiry/main.zig");
}
''')
paths = r / 'repo_zig_paths.txt'
values = set(paths.read_text().splitlines())
values.update(['test/application_driver.zig', 'test/fixture_driver.zig', 'test/authoring_tests.zig'])
paths.write_text('\n'.join(sorted(values)) + '\n')
p = r / 'build.zig.zon'
p.write_text(p.read_text().replace('        "test/agent4",', '        "test/fixture_driver.zig",\n        "test/application_driver.zig",\n        "test/authoring_tests.zig",\n        "test/agent4",'))
