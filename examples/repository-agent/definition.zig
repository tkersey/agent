//! Investigation, budgets, questions and completion are authored World policy.
const std = @import("std");
const agent = @import("agent");
const boundary = @import("boundary");
const a = boundary.authoring;
const t = @import("application_types");
const P = t.P;
const V = *const a.Value;
const Inbox = agent.inbox.Profile(t.Message);
pub const capabilities = .{
    .{ .identity = t.bindings_identity, .resource_role = "snapshot" },
    .{ .identity = t.list_identity, .resource_role = "snapshot" },
    .{ .identity = t.read_identity, .resource_role = "snapshot" },
    .{ .identity = t.question_identity, .resource_role = "user" },
    .{ .identity = agent.inbox.semantic_identity, .resource_role = "user" },
    .{ .identity = P.reference_identity, .resource_role = "inference" },
};
pub const resources = .{.{ .id = "repository-agent.instructions", .version = "1", .media_type = "text/plain", .bytes = @embedFile("instructions.txt") }};
pub const System = agent.system(.{ .InitialArgs = t.Input, .Result = t.Output, .Failure = t.Failure, .application = Application });

const Emit = struct {
    context: agent.Context,
    author: *a.Context,
    fn schema(e: Emit, comptime T: type) anyerror!*const a.Schema {
        switch (@typeInfo(T)) {
            .@"struct" => |info| {
                if (@hasDecl(T, "agent_value_kind")) return a.interop.schema(e.author, try e.context.schema(T));
                var fields: [info.field_names.len]a.Field = undefined;
                inline for (info.field_names, info.field_types, 0..) |name, F, i| fields[i] = .{ .name = name, .schema = try e.schema(F) };
                return e.author.record(&fields);
            },
            .@"union" => |info| {
                var fields: [info.field_names.len]a.Field = undefined;
                inline for (info.field_names, info.field_types, 0..) |name, F, i| fields[i] = .{ .name = name, .schema = try e.schema(F) };
                return e.author.alternatives(&fields);
            },
            else => return a.interop.schema(e.author, try e.context.schema(T)),
        }
    }
    fn literal(e: Emit, b: *a.Body, comptime T: type, value: T) !V {
        return a.interop.adoptValue(b, try e.context.literal(T, value), try e.schema(T));
    }
    fn external(e: Emit, identity: []const u8, comptime Input: type, comptime Output: type) !*const a.Operation {
        const op = try e.author.external(identity, try e.schema(Input), try e.schema(Output));
        try e.context.registry.classify(try a.interop.operationId(e.author, op), .read);
        return op;
    }
    fn sequence(e: Emit, b: *a.Body, comptime T: type, values: []const V) !V {
        const ids = try e.context.builder.allocator().alloc(boundary.source.Id, values.len);
        for (values, ids) |value, *id| id.* = try a.interop.valueId(b, value);
        return a.interop.adoptValue(b, try e.context.builder.primitive(try e.context.schema(T), .sequence, ids, 0), try e.schema(T));
    }
    fn failure(e: Emit) !*const a.FailureLiteral {
        return a.interop.literalFailure(e.author, try e.context.literal(t.Failure, .capacity), try e.schema(t.Failure));
    }
    fn widen(e: Emit, b: *a.Body, comptime T: type, value: V) !V {
        const raw = try e.context.builder.value(.{ .schema = try e.context.schema(T), .expression = .{ .primitive = .{
            .opcode = .blob_concat,
            .operands = &.{ try e.context.literal(T, .{ .bytes = "" }), try a.interop.valueId(b, value) },
            .failures = &.{.{ .kind = .capacity_exceeded, .value = try a.interop.failureLiteralId(e.author, try e.failure()) }},
        } } });
        return a.interop.adoptValue(b, raw, try e.schema(T));
    }
    fn update(e: Emit, b: *a.Body, state: V, changes: anytype) !V {
        var fields: [@typeInfo(t.State).@"struct".field_names.len]a.Argument = undefined;
        inline for (@typeInfo(t.State).@"struct".field_names, 0..) |name, i| fields[i] = .{ .name = name, .value = if (@hasField(@TypeOf(changes), name)) @field(changes, name) else try b.field(state, name) };
        return b.product(try e.schema(t.State), &fields);
    }
    fn finish(e: Emit, b: *a.Body, state: V, disposition: @FieldType(t.Output, "disposition"), summary: V, evidence: V) !V {
        return b.product(try e.schema(t.Output), &.{
            .{ .name = "disposition", .value = try e.literal(b, @FieldType(t.Output, "disposition"), disposition) },
            .{ .name = "summary", .value = summary },
            .{ .name = "evidence", .value = evidence },
            .{ .name = "model_calls", .value = try b.field(state, "model_calls") },
            .{ .name = "work_calls", .value = try b.field(state, "work_calls") },
        });
    }
    fn message(e: Emit, b: *a.Body, role: agent.model_invocation.MessageRole, text: V) !V {
        return b.product(try e.schema(P.Message), &.{ .{ .name = "role", .value = try e.literal(b, agent.model_invocation.MessageRole, role) }, .{ .name = "content", .value = text } });
    }
};

const Application = struct {
    pub fn emit(context: agent.Context) !boundary.source.Module {
        const c = try a.Context.init(context.builder);
        const e: Emit = .{ .context = context, .author = c };
        const bindings_op = try e.external(t.bindings_identity, void, t.Bindings);
        const list_op = try e.external(t.list_identity, t.ListRequest, t.ListObservation);
        const read_op = try e.external(t.read_identity, t.ReadRequest, t.ReadObservation);
        const ask_op = try e.external(t.question_identity, t.Question, t.Answer);
        const inbox_op = try a.interop.operation(c, try Inbox.declare(context));
        const model_op = try a.interop.operation(c, try P.declareReference(context.builder));
        const responder = try agent.responders.defineReferenceModelObserved(P, context, try context.literal(t.Failure, .invalid_response), false);
        const effects = &.{ list_op, read_op, ask_op, inbox_op, model_op };
        const loop = try c.function("repository investigation", &.{ .{ .name = "bindings", .schema = try e.schema(t.Bindings) }, .{ .name = "state", .schema = try e.schema(t.State) } }, try e.schema(t.Output), effects);
        const b = try c.body(loop);
        const bindings = try b.parameter("bindings");
        const state = try b.parameter("state");
        const active = try b.branch();
        const spent = try b.branch();
        const counted = try e.update(active, state, .{ .model_calls = try active.checkedAdd(try active.field(state, "model_calls"), try active.constant(u16, 1), try e.failure()) });
        const work_room = try active.less(try active.field(state, "work_calls"), try active.constant(u16, 12));
        const evidence_room = try active.less(try active.sequenceLength(try active.field(state, "evidence")), try active.constant(u64, 8));
        const readable = try active.select(work_room, evidence_room, try active.constant(bool, false));
        const reportable = try active.less(try active.constant(u64, 0), try active.sequenceLength(try active.field(state, "evidence")));
        const offered = try e.sequence(active, [P.declaration_count]bool, &.{ work_room, readable, work_room, reportable, try active.constant(bool, true) });
        const Model = agent.model(.{ .name = "repository-agent", .model = "admitted-profile", .protocol = struct {
            pub const semantic_identity = agent.model_invocation.protocol_identity;
        } });
        const template = try P.templateValue(Model, .{ .items = &.{} }, .{ .minimum_calls = 1, .maximum_calls = 1, .parallel_calls = false });
        var request_fields: [@typeInfo(P.Request).@"struct".field_names.len]a.Argument = undefined;
        inline for (@typeInfo(P.Request).@"struct".field_names, @typeInfo(P.Request).@"struct".field_types, 0..) |name, T, i| request_fields[i] = .{ .name = name, .value = if (comptime std.mem.eql(u8, name, "model") or std.mem.eql(u8, name, "parameters") or std.mem.eql(u8, name, "maximum_provider_response_bytes")) try active.field(bindings, name) else if (comptime std.mem.eql(u8, name, "messages")) try active.field(state, "messages") else try e.literal(active, T, @field(template, name)) };
        const request = try active.product(try e.schema(P.ReferenceRequest), &.{
            .{ .name = "profile", .value = try active.field(bindings, "profile") }, .{ .name = "replay", .value = try active.field(state, "replay") },
            .{ .name = "results", .value = try active.field(state, "results") },    .{ .name = "invocation", .value = try active.product(try e.schema(P.Request), &request_fields) },
        });
        const observed = try a.interop.term(active, try context.builder.term(.{ .call = .{ .function = responder, .arguments = &.{ try a.interop.valueId(active, request), try a.interop.valueId(active, offered) } } }), try e.schema(agent.responders.ReferenceModelObservation(P, false)));
        const normalized = try active.field(observed, "normalized");
        const interpretation = try active.field(observed, "interpretation");
        const accepted = try active.caseOf(interpretation, "accepted");
        const rejected = try active.caseOf(interpretation, "rejected");
        const chosen = accepted.body();
        const next = try e.update(chosen, counted, .{ .replay = try chosen.field(normalized, "replay"), .messages = try e.literal(chosen, P.Messages, .{ .items = &.{} }), .results = try e.literal(chosen, @FieldType(t.State, "results"), .{ .items = &.{} }) });
        const output = try chosen.variantPayload(try chosen.field(normalized, "result"), "output", try e.failure());
        const call_id = try callId(e, chosen, try chosen.field(output, "items"));
        const action = accepted.payload();
        var cases: [P.declaration_count]*const a.FinishedCase = undefined;
        inline for (@typeInfo(t.Action).@"union".field_names, 0..) |name, i| {
            const branch = try chosen.caseOf(action, name);
            const body = branch.body();
            const value = branch.payload();
            var successor = next;
            var result_text: ?V = null;
            switch (i) {
                0 => result_text = try body.field(try body.perform(list_op, value), "model_text"),
                1 => {
                    const observation = try body.perform(read_op, value);
                    result_text = try body.field(observation, "model_text");
                    const read = try body.field(observation, "value");
                    var reads: [3]*const a.FinishedCase = undefined;
                    inline for (.{ "found", "missing", "invalid" }, 0..) |kind, n| {
                        const read_case = try body.caseOf(read, kind);
                        const nested = read_case.body();
                        var evidence = try nested.field(next, "evidence");
                        if (n == 0) {
                            const id = try context.builder.value(.{ .schema = try context.schema(t.EvidenceList), .expression = .{ .primitive = .{ .opcode = .sequence_append, .operands = &.{ try a.interop.valueId(nested, evidence), try a.interop.valueId(nested, read_case.payload()) }, .failures = &.{.{ .kind = .capacity_exceeded, .value = try a.interop.failureLiteralId(c, try e.failure()) }} } } });
                            evidence = try a.interop.adoptValue(nested, id, try e.schema(t.EvidenceList));
                        }
                        reads[n] = try read_case.ret(evidence);
                    }
                    successor = try e.update(body, next, .{ .evidence = try body.match(read, &reads) });
                },
                2 => {
                    const answer = try body.perform(ask_op, try body.product(try e.schema(t.Question), &.{.{ .name = "prompt", .value = try body.field(value, "question") }}));
                    result_text = try e.widen(body, P.ResultText, try body.field(answer, "message"));
                },
                3 => {
                    const selected = try body.sequenceGet(try body.field(next, "evidence"), try body.field(value, "evidence_index"));
                    const some = try body.caseOf(selected, "some");
                    const none = try body.caseOf(selected, "none");
                    const found = some.body();
                    const missing = none.body();
                    const report = try e.finish(found, next, .report, try found.field(value, "summary"), try e.sequence(found, t.EvidenceList, &.{some.payload()}));
                    const no_result = try e.finish(missing, next, .no_result, try e.literal(missing, t.Summary, .{ .bytes = "The proposed report referenced evidence that was not acquired." }), try e.literal(missing, t.EvidenceList, .{ .items = &.{} }));
                    cases[i] = try branch.ret(try body.match(selected, &.{ try some.ret(report), try none.ret(no_result) }));
                },
                4 => cases[i] = try branch.ret(try e.finish(body, next, .no_result, try e.widen(body, t.Summary, try body.field(value, "reason")), try body.field(next, "evidence"))),
                else => unreachable,
            }
            if (result_text) |text| {
                const result = try body.product(try e.schema(P.ToolResult), &.{ .{ .name = "call_id", .value = call_id }, .{ .name = "output", .value = text } });
                successor = try e.update(body, successor, .{ .results = try e.sequence(body, @FieldType(t.State, "results"), &.{result}), .work_calls = try body.checkedAdd(try body.field(next, "work_calls"), try body.constant(u16, 1), try e.failure()) });
                // The tool result is retained before polling; queued client text
                // can only become a new user message on the following request.
                const inbox = try body.perform(inbox_op, try body.constant(void, {}));
                const empty = try body.caseOf(inbox, "empty");
                const message = try body.caseOf(inbox, "message");
                const arrived = message.body();
                const messages = try e.sequence(arrived, P.Messages, &.{try e.message(arrived, .user, try e.widen(arrived, P.MessageText, try arrived.field(try arrived.field(message.payload(), "value"), "message")))});
                const resumed = try body.match(inbox, &.{ try empty.ret(successor), try message.ret(try e.update(arrived, successor, .{ .messages = messages })) });
                cases[i] = try branch.ret(try body.call(loop, &.{ .{ .name = "bindings", .value = bindings }, .{ .name = "state", .value = resumed } }));
            }
        }
        const rejection = rejected.body();
        const unavailable = try e.finish(rejection, counted, .no_result, try e.literal(rejection, t.Summary, .{ .bytes = "No admissible action was returned by the fixed-profile model." }), try rejection.field(state, "evidence"));
        const result = try active.match(interpretation, &.{ try accepted.ret(try chosen.match(action, &cases)), try rejected.ret(unavailable) });
        const exhausted = try e.finish(spent, state, .capacity, try e.literal(spent, t.Summary, .{ .bytes = "The admitted model-call allowance is exhausted." }), try spent.field(state, "evidence"));
        try c.define(loop, try b.ret(try b.conditional(try b.less(try b.field(state, "model_calls"), try b.constant(u16, 16)), try active.ret(result), try spent.ret(exhausted))));
        const entry = try c.function("repository-agent", &.{.{ .name = "input", .schema = try e.schema(t.Input) }}, try e.schema(t.Output), &.{ bindings_op, list_op, read_op, ask_op, inbox_op, model_op });
        const root = try c.body(entry);
        const frozen = try root.perform(bindings_op, try root.constant(void, {}));
        const initial = try e.literal(root, t.State, .{ .replay = null, .results = .{ .items = &.{} }, .messages = .{ .items = &.{} }, .evidence = .{ .items = &.{} }, .model_calls = 0, .work_calls = 0 });
        const messages = try e.sequence(root, P.Messages, &.{ try e.message(root, .developer, try root.field(frozen, "instructions")), try e.message(root, .user, try e.widen(root, P.MessageText, try root.field(try root.parameter("input"), "task"))) });
        try c.define(entry, try root.ret(try root.call(loop, &.{ .{ .name = "bindings", .value = frozen }, .{ .name = "state", .value = try e.update(root, initial, .{ .messages = messages }) } })));
        return c.module(entry, try e.schema(t.Failure));
    }
};

fn callId(e: Emit, parent: *a.Body, items: V) !V {
    const c = e.author;
    const scan = try c.function("accepted model call identity", &.{ .{ .name = "items", .schema = try e.schema(P.OutputItems) }, .{ .name = "index", .schema = try c.scalar(u64) } }, try e.schema(P.CallId), &.{});
    const b = try c.body(scan);
    const list = try b.parameter("items");
    const index = try b.parameter("index");
    const raw = try b.variantPayload(try b.sequenceGet(list, index), "some", try e.failure());
    const item = try a.interop.term(b, try e.context.builder.pure(try a.interop.valueId(b, raw)), try e.schema(P.OutputItem));
    var cases: [3]*const a.FinishedCase = undefined;
    inline for (.{ "function_call", "message", "reasoning" }, 0..) |name, i| {
        const branch = try b.caseOf(item, name);
        const body = branch.body();
        cases[i] = try branch.ret(if (i == 0) try body.field(branch.payload(), "call_id") else try body.call(scan, &.{ .{ .name = "items", .value = list }, .{ .name = "index", .value = try body.checkedAdd(index, try body.constant(u64, 1), try e.failure()) } }));
    }
    try c.define(scan, try b.ret(try b.match(item, &cases)));
    return parent.call(scan, &.{ .{ .name = "items", .value = items }, .{ .name = "index", .value = try parent.constant(u64, 0) } });
}
