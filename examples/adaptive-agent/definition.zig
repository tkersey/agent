//! One authored investigation with model-callable adaptive control.
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
    .{ .identity = t.prepare_identity, .resource_role = "context" },
    .{ .identity = t.work_identity, .resource_role = "snapshot" },
    .{ .identity = t.inspect_identity, .resource_role = "invariant-review" },
    .{ .identity = t.question_identity, .resource_role = "user" },
    .{ .identity = agent.inbox.semantic_identity, .resource_role = "user" },
    .{ .identity = P.adaptive_identity, .resource_role = "inference" },
};
pub const resources = .{
    .{ .id = "adaptive-agent.instructions", .version = "1", .media_type = "text/plain", .bytes = @embedFile("instructions.txt") },
    .{ .id = "adaptive-agent.offline-responses", .version = "1", .media_type = "application/json", .bytes = @embedFile("offline-responses.json") },
    .{ .id = "repository-orientation", .version = "1", .media_type = "text/markdown", .bytes = @embedFile("skills/orientation.md") },
    .{ .id = "invariant-review", .version = "1", .media_type = "text/markdown", .bytes = @embedFile("skills/invariant-review.md") },
    .{ .id = "technical-reporting", .version = "1", .media_type = "text/markdown", .bytes = @embedFile("skills/technical-reporting.md") },
};
pub const System = agent.system(.{ .InitialArgs = t.Input, .Result = t.Output, .Failure = t.Failure, .application = Application });

const Emit = struct {
    context: agent.Context,
    author: *a.Context,
    fn schema(e: Emit, comptime T: type) anyerror!*const a.Schema {
        switch (@typeInfo(T)) {
            .optional => |info| return e.author.alternatives(&.{ .{ .name = "none", .schema = try e.schema(void) }, .{ .name = "some", .schema = try e.schema(info.child) } }),
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
    fn named(e: Emit, b: *a.Body, comptime T: type, value: V) !V {
        return a.interop.term(b, try e.context.builder.pure(try a.interop.valueId(b, value)), try e.schema(T));
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
            .{ .name = "control", .value = try b.field(state, "control") },
            .{ .name = "receipts", .value = try b.field(state, "receipts") },
            .{ .name = "model_calls", .value = try b.field(state, "model_calls") },
            .{ .name = "work_calls", .value = try b.field(state, "work_calls") },
        });
    }
    fn message(e: Emit, b: *a.Body, role: agent.model_invocation.MessageRole, text: V) !V {
        return b.product(try e.schema(P.Message), &.{ .{ .name = "role", .value = try e.literal(b, agent.model_invocation.MessageRole, role) }, .{ .name = "content", .value = text } });
    }
    fn append(e: Emit, b: *a.Body, comptime T: type, list: V, item: V) !V {
        const value = try e.context.builder.value(.{ .schema = try e.context.schema(T), .expression = .{ .primitive = .{
            .opcode = .sequence_append,
            .operands = &.{ try a.interop.valueId(b, list), try a.interop.valueId(b, item) },
            .failures = &.{.{ .kind = .capacity_exceeded, .value = try a.interop.failureLiteralId(e.author, try e.failure()) }},
        } } });
        return a.interop.adoptValue(b, value, try e.schema(T));
    }
    fn invoke(e: Emit, b: *a.Body, function: boundary.source.Id, arguments: []const V, comptime Result: type) !V {
        const ids = try e.context.builder.allocator().alloc(boundary.source.Id, arguments.len);
        for (ids, arguments) |*id, value| id.* = try a.interop.valueId(b, value);
        return a.interop.term(b, try e.context.builder.term(.{ .call = .{ .function = function, .arguments = ids } }), try e.schema(Result));
    }
};

const Ops = struct { bindings: *const a.Operation, prepare: *const a.Operation, work: *const a.Operation, ask: *const a.Operation, inspect: *const a.Operation, inbox: *const a.Operation, model: *const a.Operation };
const Application = struct {
    pub fn emit(context: agent.Context) !boundary.source.Module {
        const c = try a.Context.init(context.builder);
        errdefer {
            const diagnostic = c.lastDiagnostic();
            std.log.err("adaptive authoring: {s}", .{diagnostic.renderAlloc(context.builder.allocator()) catch "diagnostic unavailable"});
        }
        const e: Emit = .{ .context = context, .author = c };
        const ops: Ops = .{
            .bindings = try e.external(t.bindings_identity, void, t.Bindings),
            .prepare = try e.external(t.prepare_identity, t.Preparation, t.PreparationResult),
            .work = try e.external(t.work_identity, t.WorkRequest, t.WorkReply),
            .ask = try e.external(t.question_identity, t.Question, t.Answer),
            .inspect = try e.external(t.inspect_identity, t.WorkRequest, t.WorkReply),
            .inbox = try a.interop.operation(c, try Inbox.declare(context)),
            .model = try a.interop.operation(c, try P.declareAdaptive(context.builder)),
        };
        const loop = try c.function("adaptive repository investigation", &.{ .{ .name = "bindings", .schema = try e.schema(t.PolicyView) }, .{ .name = "state", .schema = try e.schema(t.State) } }, try e.schema(t.Output), &.{ ops.prepare, ops.work, ops.ask, ops.inspect, ops.inbox, ops.model });
        const program: Program = .{
            .e = e,
            .ops = ops,
            .loop = loop,
            .responder = try agent.responders.defineAdaptiveModelObserved(P, context, try context.literal(t.Failure, .invalid_response), false),
            .inference = try t.controls.defineInference(context, try context.literal(t.Failure, .capacity)),
            .skill = try t.controls.defineSkill(P, context, try context.literal(t.Failure, .capacity)),
        };
        try program.defineLoop();
        const entry = try c.function("adaptive-agent", &.{.{ .name = "input", .schema = try e.schema(t.Input) }}, try e.schema(t.Output), &.{ ops.bindings, ops.prepare, ops.work, ops.ask, ops.inspect, ops.inbox, ops.model });
        const root = try c.body(entry);
        const frozen = try root.perform(ops.bindings, try root.constant(void, {}));
        const task = try root.field(try root.parameter("input"), "task");
        const empty = try e.literal(root, t.State, .{
            .task = .{ .bytes = "" },
            .followups = .{ .items = &.{} },
            .control = .{ .selection = .{ .profile_id = .{ .bytes = "" }, .profile_digest = @splat(0), .effective_effort = .medium, .control_revision = 0 }, .top_effort = .medium, .epoch = 0, .epoch_reason = .initial, .eviction_generation = 0, .skills = .{ .items = &.{} } },
            .replay = null,
            .results = .{ .items = &.{} },
            .messages = .{ .items = &.{} },
            .evidence = .{ .items = &.{} },
            .receipts = .{ .items = &.{} },
            .model_calls = 0,
            .work_calls = 0,
        });
        const messages = try e.sequence(root, P.Messages, &.{
            try e.message(root, .developer, try root.field(frozen, "instructions")),
            try e.message(root, .user, try e.widen(root, P.MessageText, task)),
            try e.message(root, .developer, try root.field(frozen, "status")),
        });
        const initial = try e.update(root, empty, .{ .task = task, .control = try root.field(frozen, "initial"), .messages = messages });
        const policy = try root.product(try e.schema(t.PolicyView), &.{
            .{ .name = "profiles", .value = try root.field(frozen, "profiles") },                       .{ .name = "catalog", .value = try root.field(frozen, "catalog") },
            .{ .name = "maximum_model_calls", .value = try root.field(frozen, "maximum_model_calls") }, .{ .name = "maximum_revision", .value = try root.field(frozen, "maximum_revision") },
        });
        try c.define(entry, try root.ret(try root.call(loop, &.{ .{ .name = "bindings", .value = policy }, .{ .name = "state", .value = initial } })));
        return c.module(entry, try e.schema(t.Failure));
    }
};

const Program = struct {
    e: Emit,
    ops: Ops,
    loop: *const a.Function,
    responder: boundary.source.Id,
    inference: boundary.source.Id,
    skill: boundary.source.Id,

    fn offers(p: Program, b: *a.Body, bindings: V, state: V) !V {
        const work = try b.less(try b.field(state, "work_calls"), try b.constant(u16, 12));
        const evidence = try b.field(state, "evidence");
        const readable = try b.select(work, try b.less(try b.sequenceLength(evidence), try b.constant(u64, 8)), try b.constant(bool, false));
        const reportable = try b.less(try b.constant(u64, 0), try b.sequenceLength(evidence));
        const askable = try b.select(work, try b.less(try b.sequenceLength(try b.field(state, "followups")), try b.constant(u64, 4)), try b.constant(bool, false));
        const controls = try b.select(try b.less(try b.field(try b.field(try b.field(state, "control"), "selection"), "control_revision"), try b.field(bindings, "maximum_revision")), try b.less(try b.sequenceLength(try b.field(state, "receipts")), try b.constant(u64, 16)), try b.constant(bool, false));
        return p.e.sequence(b, [P.declaration_count]bool, &.{ work, readable, askable, reportable, try b.constant(bool, true), controls, controls, try b.select(work, reportable, try b.constant(bool, false)) });
    }
    fn stopped(p: Program, b: *a.Body, state: V, reason: []const u8) !V {
        return p.e.finish(b, state, .capacity, try p.e.literal(b, t.Summary, .{ .bytes = reason }), try b.field(state, "evidence"));
    }
    fn defineLoop(p: Program) !void {
        const e = p.e;
        const b = try e.author.body(p.loop);
        const bindings = try b.parameter("bindings");
        const state = try b.parameter("state");
        const active = try b.branch();
        const spent = try b.branch();
        const preparation = try active.perform(p.ops.prepare, try active.product(try e.schema(t.Preparation), &.{
            .{ .name = "state", .value = state }, .{ .name = "offered", .value = try p.offers(active, bindings, state) }, .{ .name = "control", .value = try e.literal(active, ?t.ControlSubject, null) },
        }));
        const ready = try active.caseOf(preparation, "ready");
        const rejected = try active.caseOf(preparation, "rejected");
        const work = ready.body();
        const request = try work.field(ready.payload(), "request");
        const counted = try e.update(work, state, .{ .model_calls = try work.checkedAdd(try work.field(state, "model_calls"), try work.constant(u16, 1), try e.failure()), .messages = try e.literal(work, P.Messages, .{ .items = &.{} }), .results = try e.literal(work, t.PendingResults, .{ .items = &.{} }) });
        const observation = try e.invoke(work, p.responder, &.{ request, try work.field(request, "offered") }, agent.responders.AdaptiveModelObservation(P, false));
        const normalized = try work.field(observation, "normalized");
        const interpretation = try work.field(observation, "interpretation");
        const accepted = try work.caseOf(interpretation, "accepted");
        const refused = try work.caseOf(interpretation, "rejected");
        const chosen = accepted.body();
        const next = try e.update(chosen, counted, .{
            .replay = try chosen.field(normalized, "replay"),
            .results = try e.literal(chosen, @FieldType(t.State, "results"), .{ .items = &.{} }),
            .messages = try e.literal(chosen, P.Messages, .{ .items = &.{} }),
        });
        const output = try chosen.variantPayload(try chosen.field(normalized, "result"), "output", try e.failure());
        const call_id = try callId(e, chosen, try chosen.field(output, "items"));
        const action = accepted.payload();
        var cases: [P.declaration_count]*const a.FinishedCase = undefined;
        inline for (@typeInfo(t.Action).@"union".field_names, 0..) |name, index| {
            const selected = try chosen.caseOf(action, name);
            cases[index] = try selected.ret(try p.dispatchAction(selected.body(), bindings, next, call_id, selected.payload(), index));
        }
        const refusal = refused.body();
        const unavailable = try e.finish(refusal, counted, .no_result, try e.literal(refusal, t.Summary, .{ .bytes = "The response did not contain one admissible action with complete replay." }), try refusal.field(state, "evidence"));
        const result = try work.match(interpretation, &.{ try accepted.ret(try chosen.match(action, &cases)), try refused.ret(unavailable) });
        const prepared = try active.match(preparation, &.{ try ready.ret(result), try rejected.ret(try p.stopped(rejected.body(), state, "The next context cannot be prepared within the admitted policy and capacity.")) });
        try e.author.define(p.loop, try b.ret(try b.conditional(try b.less(try b.field(state, "model_calls"), try b.field(bindings, "maximum_model_calls")), try active.ret(prepared), try spent.ret(try p.stopped(spent, state, "The admitted model-call allowance is exhausted.")))));
    }
    fn resumeTask(p: Program, b: *a.Body, bindings: V, state: V) !V {
        const e = p.e;
        const poll = try b.branch();
        const full = try b.branch();
        const raw = try poll.perform(p.ops.inbox, try poll.constant(void, {}));
        const inbox = try a.interop.term(poll, try e.context.builder.pure(try a.interop.valueId(poll, raw)), try e.schema(Inbox.Reply));
        const empty = try poll.caseOf(inbox, "empty");
        const message = try poll.caseOf(inbox, "message");
        const arrived = message.body();
        const text = try arrived.field(try arrived.field(message.payload(), "value"), "message");
        const updated = try e.update(arrived, state, .{
            .followups = try e.append(arrived, t.Followups, try arrived.field(state, "followups"), text),
            .messages = try e.sequence(arrived, P.Messages, &.{try e.message(arrived, .user, try e.widen(arrived, P.MessageText, text))}),
        });
        const successor = try poll.match(inbox, &.{ try empty.ret(state), try message.ret(updated) });
        return b.conditional(try b.less(try b.sequenceLength(try b.field(state, "followups")), try b.constant(u64, 4)), try poll.ret(try poll.call(p.loop, &.{ .{ .name = "bindings", .value = bindings }, .{ .name = "state", .value = successor } })), try full.ret(try full.call(p.loop, &.{ .{ .name = "bindings", .value = bindings }, .{ .name = "state", .value = state } })));
    }
    fn toolResult(p: Program, b: *a.Body, bindings: V, state: V, call_id: V, text: V) !V {
        const e = p.e;
        const result = try b.product(try e.schema(t.PendingResult), &.{ .{ .name = "call_id", .value = call_id }, .{ .name = "output", .value = text } });
        const successor = try e.update(b, state, .{
            .results = try e.sequence(b, @FieldType(t.State, "results"), &.{result}),
            .work_calls = try b.checkedAdd(try b.field(state, "work_calls"), try b.constant(u16, 1), try e.failure()),
        });
        return p.resumeTask(b, bindings, successor);
    }
    fn dispatchAction(p: Program, b: *a.Body, bindings: V, state: V, call_id: V, value: V, comptime index: usize) !V {
        const e = p.e;
        switch (index) {
            0, 1, 7 => {
                const context = try b.variantPayload(try b.field(state, "replay"), "some", try e.failure());
                const WorkAction = @FieldType(t.WorkRequest, "action");
                const payload = if (index == 7) try b.product(try e.schema(@FieldType(WorkAction, "inspect")), &.{
                    .{ .name = "evidence_index", .value = try b.field(value, "evidence_index") },
                    .{ .name = "evidence", .value = try e.named(b, t.EvidenceReference, try b.variantPayload(try b.sequenceGet(try b.field(state, "evidence"), try b.field(value, "evidence_index")), "some", try e.failure())) },
                }) else value;
                const request = try b.product(try e.schema(t.WorkRequest), &.{
                    .{ .name = "context", .value = context },                                                                                                            .{ .name = "call_id", .value = call_id },
                    .{ .name = "action", .value = try b.variant(try e.schema(WorkAction), if (index == 0) "list" else if (index == 1) "read" else "inspect", payload) },
                });
                const reply = try b.perform(if (index == 7) p.ops.inspect else p.ops.work, request);
                const reference = try b.field(reply, "artifact");
                const evidence = try b.field(reply, "evidence");
                const some = try b.caseOf(evidence, "some");
                const none = try b.caseOf(evidence, "none");
                const updated = try b.match(evidence, &.{
                    try some.ret(try e.update(some.body(), state, .{ .evidence = try e.append(some.body(), t.EvidenceList, try some.body().field(state, "evidence"), some.payload()) })),
                    try none.ret(state),
                });
                return p.toolResult(b, bindings, updated, call_id, try b.variant(try e.schema(t.ResultValue), "work", reference));
            },
            2 => {
                const question = try b.product(try e.schema(t.Question), &.{.{ .name = "prompt", .value = try b.field(value, "question") }});
                const answer = try b.perform(p.ops.ask, question);
                const successor = try e.update(b, state, .{ .followups = try e.append(b, t.Followups, try b.field(state, "followups"), try b.field(answer, "message")) });
                return p.toolResult(b, bindings, successor, call_id, try b.variant(try e.schema(t.ResultValue), "inline_text", try b.field(answer, "message")));
            },
            3 => {
                const selected = try b.sequenceGet(try b.field(state, "evidence"), try b.field(value, "evidence_index"));
                const some = try b.caseOf(selected, "some");
                const none = try b.caseOf(selected, "none");
                return b.match(selected, &.{
                    try some.ret(try e.finish(some.body(), state, .report, try some.body().field(value, "summary"), try e.sequence(some.body(), t.EvidenceList, &.{some.payload()}))),
                    try none.ret(try e.finish(none.body(), state, .no_result, try e.literal(none.body(), t.Summary, .{ .bytes = "The proposed report referenced evidence that was not acquired." }), try none.body().field(state, "evidence"))),
                });
            },
            4 => return e.finish(b, state, .no_result, try e.widen(b, t.Summary, try b.field(value, "reason")), try b.field(state, "evidence")),
            5, 6 => return p.control(b, bindings, state, call_id, value, index == 5),
            else => unreachable,
        }
    }
    fn control(p: Program, b: *a.Body, bindings: V, state: V, call_id: V, command: V, comptime inference: bool) !V {
        const e = p.e;
        const Input = if (inference) t.controls.InferenceInput else t.controls.SkillInput(P);
        var fields: [if (inference) 4 else 5]a.Argument = undefined;
        fields[0] = .{ .name = "state", .value = try b.field(state, "control") };
        fields[1] = .{ .name = if (inference) "profiles" else "catalog", .value = try b.field(bindings, if (inference) "profiles" else "catalog") };
        fields[2] = .{ .name = "command", .value = command };
        if (!inference) fields[3] = .{ .name = "watermark", .value = try b.field(try b.variantPayload(try b.field(state, "replay"), "some", try e.failure()), "watermark") };
        fields[fields.len - 1] = .{ .name = "maximum_revision", .value = try b.field(bindings, "maximum_revision") };
        const proposal = try e.invoke(b, if (inference) p.inference else p.skill, &.{try b.product(try e.schema(Input), &fields)}, t.controls.Proposal);
        const subject = try b.product(try e.schema(t.ControlSubject), &.{ .{ .name = "call_id", .value = call_id }, .{ .name = "reason", .value = try b.field(command, "reason") }, .{ .name = "proposal", .value = proposal } });
        const preparation = try b.perform(p.ops.prepare, try b.product(try e.schema(t.Preparation), &.{
            .{ .name = "state", .value = state }, .{ .name = "offered", .value = try p.offers(b, bindings, state) }, .{ .name = "control", .value = try b.variant(try e.schema(?t.ControlSubject), "some", subject) },
        }));
        const ready = try b.caseOf(preparation, "ready");
        const rejected = try b.caseOf(preparation, "rejected");
        const accepted = ready.body();
        const receipt = try accepted.variantPayload(try accepted.field(ready.payload(), "receipt"), "some", try e.failure());
        const committed = try e.update(accepted, state, .{
            .control = try accepted.field(proposal, "state"),
            .results = try accepted.field(ready.payload(), "results"),
            .receipts = try e.append(accepted, t.Receipts, try accepted.field(state, "receipts"), receipt),
        });
        const failed = rejected.body();
        var reason = try e.literal(failed, t.Summary, .{ .bytes = "Control preparation rejected. Configuration and control revision are unchanged; no inference was performed by the control." });
        inline for ([_]t.controls.Rejection{ .capacity, .unknown_profile, .unknown_skill, .unsupported_effort, .invalid_operation }) |kind| {
            const text = "{\"disposition\":\"rejected\",\"reason\":\"" ++ @tagName(kind) ++ "\",\"configuration_changed\":false,\"inference_performed\":false}";
            reason = try failed.select(try failed.equal(try failed.enumTag(rejected.payload()), try failed.enumTag(try e.literal(failed, t.controls.Rejection, kind))), try e.literal(failed, t.Summary, .{ .bytes = text }), reason);
        }
        const reply = try failed.product(try e.schema(t.PendingResult), &.{ .{ .name = "call_id", .value = call_id }, .{ .name = "output", .value = try failed.variant(try e.schema(t.ResultValue), "inline_text", reason) } });
        const unchanged = try e.update(failed, state, .{ .results = try e.sequence(failed, @FieldType(t.State, "results"), &.{reply}) });
        return b.match(preparation, &.{ try ready.ret(try p.resumeTask(accepted, bindings, committed)), try rejected.ret(try p.resumeTask(failed, bindings, unchanged)) });
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
