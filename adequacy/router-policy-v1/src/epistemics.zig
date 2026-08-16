pub fn WorkingSet(comptime agent: type, comptime T: type) type {
    return struct {
        pub const semantic_identity = "agent.epistemics.router-policy-working-set.lowering.v1";
        pub const lowering_complexity: usize = 12;

        pub fn constantValues(comptime Definition: type, comptime config: anytype) @TypeOf(.{
            @as(u32, 4),
            @as(u32, 9),
            T.Failure.capacity_exceeded,
        }) {
            _ = Definition;
            _ = config;
            return .{
                @as(u32, 4),
                @as(u32, 9),
                T.Failure.capacity_exceeded,
            };
        }

        pub fn constantContext(comptime Definition: type, comptime config: anytype, comptime base: u16) type {
            _ = Definition;
            _ = config;
            return struct {
                pub const zero_index: u16 = 0;
                pub const one_index: u16 = 1;
                pub const invalid_variant_index: u16 = 8;
                pub const initial_memory_index: u16 = 10;
                pub const true_index: u16 = 11;
                pub const false_index: u16 = 12;
                pub const four_u32_index: u16 = base;
                pub const nine_u32_index: u16 = base + 1;
                pub const capacity_failure_index: u16 = base + 2;
            };
        }

        pub fn validate(comptime Definition: type, comptime config: anytype) void {
            _ = config;
            if (Definition.Observation != T.Observation) {
                @compileError("router-policy working set requires the router-policy Observation");
            }
            if (T.Memory == T.DecisionView) {
                @compileError("Memory and DecisionView must remain distinct nominal products");
            }
        }

        pub fn Memory(comptime Definition: type, comptime config: anytype) type {
            _ = Definition;
            _ = config;
            return T.Memory;
        }

        pub fn DecisionView(comptime Definition: type, comptime config: anytype) type {
            _ = Definition;
            _ = config;
            return T.DecisionView;
        }

        pub fn StateSchemaTypes(comptime Definition: type, comptime config: anytype) @TypeOf(.{
            T.Memory,
            T.DecisionView,
            T.DecisionEvidence,
            T.Documents,
            T.Mutations,
            T.DocumentSnapshot,
            T.MutationSummary,
            T.ListResult,
            ?T.ListResult,
            T.TreeEntry,
            T.SearchResult,
            ?T.SearchResult,
            T.SearchHit,
            T.TestResult,
            ?T.TestResult,
            T.ReplaceOutcome,
            ?T.ReplaceOutcome,
            T.ReplaceApplied,
            T.ReplaceDenied,
            T.ReplaceConflict,
            T.Path,
            T.DigestHex,
            T.FileText,
            T.TestOutput,
            T.ExcerptText,
            T.DocumentSlot,
            T.EntryKind,
            T.ChangedFiles,
        }) {
            _ = Definition;
            _ = config;
            return .{
                T.Memory,
                T.DecisionView,
                T.DecisionEvidence,
                T.Documents,
                T.Mutations,
                T.DocumentSnapshot,
                T.MutationSummary,
                T.ListResult,
                ?T.ListResult,
                T.TreeEntry,
                T.SearchResult,
                ?T.SearchResult,
                T.SearchHit,
                T.TestResult,
                ?T.TestResult,
                T.ReplaceOutcome,
                ?T.ReplaceOutcome,
                T.ReplaceApplied,
                T.ReplaceDenied,
                T.ReplaceConflict,
                T.Path,
                T.DigestHex,
                T.FileText,
                T.TestOutput,
                T.ExcerptText,
                T.DocumentSlot,
                T.EntryKind,
                T.ChangedFiles,
            };
        }

        pub fn initialMemory(comptime Definition: type, comptime config: anytype) T.Memory {
            _ = Definition;
            _ = config;
            return .{
                .listing = null,
                .documents = T.Documents.empty(),
                .latest_search = null,
                .latest_test = null,
                .latest_replace = null,
                .mutations = T.Mutations.empty(),
                .baseline_failure_observed = false,
                .latest_test_passed = false,
                .mutation_count = 0,
                .last_test_mutation_count = 0,
                .test_count = 0,
            };
        }

        fn replaceMemoryField(flow: anytype, memory: anytype, comptime index: usize, value: anytype) agent.Value(T.Memory) {
            return flow.productReplace(index, memory, value);
        }

        fn slotCodeValid(flow: anytype, slot: anytype, code: anytype, comptime context: anytype) agent.Value(bool) {
            _ = context;
            return flow.integerEqual(
                flow.enumToU32(slot),
                flow.integerConvert(u32, code),
            );
        }

        fn requireValidSlotCode(flow: anytype, slot: anytype, code: anytype, comptime context: anytype) void {
            const valid = flow.block(.segment, .{});
            const invalid = flow.block(.terminal_handoff, .{});
            flow.branch(slotCodeValid(flow, slot, code, context), valid, .{}, invalid, .{});
            _ = flow.enter(invalid);
            flow.failValue(flow.constant(T.Failure, context.invalid_variant_index));
            _ = flow.enter(valid);
        }

        fn validatedSnapshot(flow: anytype, snapshot: anytype, comptime context: anytype) agent.Value(T.DocumentSnapshot) {
            const valid = flow.block(.segment, .{T.DocumentSnapshot});
            const invalid = flow.block(.terminal_handoff, .{});
            flow.branch(
                slotCodeValid(flow, flow.productExtract(0, snapshot), flow.productExtract(1, snapshot), context),
                valid,
                .{snapshot},
                invalid,
                .{},
            );
            _ = flow.enter(invalid);
            flow.failValue(flow.constant(T.Failure, context.invalid_variant_index));
            return flow.enter(valid)[0];
        }

        fn upsertDocument(flow: anytype, documents: anytype, untrusted: anytype, comptime context: anytype) agent.Value(T.Documents) {
            const snapshot = validatedSnapshot(flow, untrusted, context);
            const header = flow.block(.loop_header, .{ T.Documents, u32, T.DocumentSnapshot });
            const inspect = flow.block(.segment, .{ T.Documents, u32, T.DocumentSnapshot });
            const missing = flow.block(.segment, .{ T.Documents, T.DocumentSnapshot });
            const capacity = flow.block(.terminal_handoff, .{});
            const joined = flow.block(.segment, .{T.Documents});

            flow.jump(header, .{ documents, flow.constant(u32, context.zero_index), snapshot });
            const values = flow.enter(header);
            flow.branch(
                flow.integerGreaterEqual(values[1], flow.vectorLength(values[0])),
                missing,
                .{ values[0], values[2] },
                inspect,
                values,
            );

            const current = flow.enter(inspect);
            const entry = flow.vectorGet(current[0], current[1]);
            flow.branch(
                flow.integerEqual(flow.productExtract(1, entry), flow.productExtract(1, current[2])),
                joined,
                .{flow.vectorSet(current[0], current[1], current[2])},
                header,
                .{
                    current[0],
                    flow.integerAdd(current[1], flow.constant(u32, context.one_index)),
                    current[2],
                },
            );

            const absent = flow.enter(missing);
            flow.branch(
                flow.integerGreaterEqual(flow.vectorLength(absent[0]), flow.constant(u32, context.nine_u32_index)),
                capacity,
                .{},
                joined,
                .{flow.vectorPush(absent[0], absent[1])},
            );
            _ = flow.enter(capacity);
            flow.failValue(flow.constant(T.Failure, context.capacity_failure_index));
            return flow.enter(joined)[0];
        }

        fn removeDocument(flow: anytype, documents: anytype, slot: anytype, code: anytype, comptime context: anytype) agent.Value(T.Documents) {
            requireValidSlotCode(flow, slot, code, context);
            const header = flow.block(.loop_header, .{ T.Documents, T.Documents, u32, u8 });
            const inspect = flow.block(.segment, .{ T.Documents, T.Documents, u32, u8 });
            const done = flow.block(.segment, .{T.Documents});

            flow.jump(header, .{
                documents,
                flow.vectorEmpty(T.Documents),
                flow.constant(u32, context.zero_index),
                code,
            });
            const values = flow.enter(header);
            flow.branch(
                flow.integerGreaterEqual(values[2], flow.vectorLength(values[0])),
                done,
                .{values[1]},
                inspect,
                values,
            );

            const inspecting = flow.enter(inspect);
            const entry = flow.vectorGet(inspecting[0], inspecting[2]);
            flow.jump(header, .{
                inspecting[0],
                flow.select(
                    flow.integerEqual(flow.productExtract(1, entry), inspecting[3]),
                    inspecting[1],
                    flow.vectorPush(inspecting[1], entry),
                ),
                flow.integerAdd(inspecting[2], flow.constant(u32, context.one_index)),
                inspecting[3],
            });
            return flow.enter(done)[0];
        }

        fn observeTest(flow: anytype, memory: anytype, result: anytype, comptime context: anytype) agent.Value(T.Memory) {
            const passed = flow.productExtract(1, result);
            const mutation_count = flow.productExtract(8, memory);
            const baseline_failure = flow.booleanAnd(
                flow.integerEqual(mutation_count, flow.constant(u32, context.zero_index)),
                flow.booleanNot(passed),
            );
            return flow.productConstruct(T.Memory, .{
                flow.productExtract(0, memory),
                flow.productExtract(1, memory),
                flow.productExtract(2, memory),
                flow.optionalSome(?T.TestResult, result),
                flow.productExtract(4, memory),
                flow.productExtract(5, memory),
                flow.booleanOr(flow.productExtract(6, memory), baseline_failure),
                passed,
                mutation_count,
                mutation_count,
                flow.integerAdd(flow.productExtract(10, memory), flow.constant(u32, context.one_index)),
            });
        }

        fn observeApplied(flow: anytype, memory: anytype, outcome: anytype, applied: anytype, comptime context: anytype) agent.Value(T.Memory) {
            requireValidSlotCode(flow, flow.productExtract(0, applied), flow.productExtract(1, applied), context);
            const current = validatedSnapshot(flow, flow.productExtract(6, applied), context);
            const matching = flow.booleanAnd(
                flow.integerEqual(
                    flow.enumToU32(flow.productExtract(0, applied)),
                    flow.enumToU32(flow.productExtract(0, current)),
                ),
                flow.integerEqual(flow.productExtract(1, applied), flow.productExtract(1, current)),
            );
            const coherent = flow.block(.segment, .{T.DocumentSnapshot});
            const invalid = flow.block(.terminal_handoff, .{});
            flow.branch(matching, coherent, .{current}, invalid, .{});
            _ = flow.enter(invalid);
            flow.failValue(flow.constant(T.Failure, context.invalid_variant_index));
            const admitted = flow.enter(coherent)[0];

            const mutations = flow.productExtract(5, memory);
            const append = flow.block(.segment, .{T.Mutations});
            const capacity = flow.block(.terminal_handoff, .{});
            flow.branch(
                flow.integerGreaterEqual(flow.vectorLength(mutations), flow.constant(u32, context.four_u32_index)),
                capacity,
                .{},
                append,
                .{mutations},
            );
            _ = flow.enter(capacity);
            flow.failValue(flow.constant(T.Failure, context.capacity_failure_index));
            const append_values = flow.enter(append);
            const summary = flow.productConstruct(T.MutationSummary, .{
                flow.productExtract(0, applied),
                flow.productExtract(1, applied),
                flow.productExtract(2, applied),
                flow.productExtract(3, applied),
                flow.productExtract(4, applied),
                flow.productExtract(5, applied),
            });

            return flow.productConstruct(T.Memory, .{
                flow.productExtract(0, memory),
                upsertDocument(flow, flow.productExtract(1, memory), admitted, context),
                flow.optionalNone(?T.SearchResult),
                flow.productExtract(3, memory),
                flow.optionalSome(?T.ReplaceOutcome, outcome),
                flow.vectorPush(append_values[0], summary),
                flow.productExtract(6, memory),
                flow.constant(bool, context.false_index),
                flow.integerAdd(flow.productExtract(8, memory), flow.constant(u32, context.one_index)),
                flow.productExtract(9, memory),
                flow.productExtract(10, memory),
            });
        }

        fn observeReplacement(flow: anytype, memory: anytype, outcome: anytype, comptime context: anytype) agent.Value(T.Memory) {
            const applied_block = flow.block(.segment, .{ T.Memory, T.ReplaceOutcome });
            const classify_conflict = flow.block(.segment, .{ T.Memory, T.ReplaceOutcome });
            const denied_block = flow.block(.segment, .{ T.Memory, T.ReplaceOutcome });
            const conflict_block = flow.block(.segment, .{ T.Memory, T.ReplaceOutcome });
            const joined = flow.block(.segment, .{T.Memory});

            flow.branch(flow.sumTagIs(0, outcome), applied_block, .{ memory, outcome }, classify_conflict, .{ memory, outcome });
            const applied_values = flow.enter(applied_block);
            flow.jump(joined, .{observeApplied(
                flow,
                applied_values[0],
                applied_values[1],
                flow.sumExtract(0, applied_values[1]),
                context,
            )});

            const classify_values = flow.enter(classify_conflict);
            flow.branch(
                flow.sumTagIs(2, classify_values[1]),
                conflict_block,
                classify_values,
                denied_block,
                classify_values,
            );

            const denied_values = flow.enter(denied_block);
            flow.jump(joined, .{replaceMemoryField(
                flow,
                denied_values[0],
                4,
                flow.optionalSome(?T.ReplaceOutcome, denied_values[1]),
            )});

            const conflict_values = flow.enter(conflict_block);
            const conflict = flow.sumExtract(2, conflict_values[1]);
            var next = replaceMemoryField(
                flow,
                conflict_values[0],
                1,
                removeDocument(
                    flow,
                    flow.productExtract(1, conflict_values[0]),
                    flow.productExtract(0, conflict),
                    flow.productExtract(1, conflict),
                    context,
                ),
            );
            next = replaceMemoryField(flow, next, 2, flow.optionalNone(?T.SearchResult));
            next = replaceMemoryField(flow, next, 4, flow.optionalSome(?T.ReplaceOutcome, conflict_values[1]));
            next = replaceMemoryField(flow, next, 7, flow.constant(bool, context.false_index));
            flow.jump(joined, .{next});
            return flow.enter(joined)[0];
        }

        pub fn emitObserveKnown(
            comptime Definition: type,
            comptime config: anytype,
            flow: anytype,
            memory: anytype,
            comptime observation_index: u16,
            observation: anytype,
            comptime context: anytype,
        ) agent.Value(T.Memory) {
            return emitObservePayload(
                Definition,
                config,
                flow,
                memory,
                observation_index,
                flow.sumExtract(observation_index, observation),
                context,
            );
        }

        pub fn emitObservePayload(
            comptime Definition: type,
            comptime config: anytype,
            flow: anytype,
            memory: anytype,
            comptime observation_index: u16,
            payload: anytype,
            comptime context: anytype,
        ) agent.Value(T.Memory) {
            _ = Definition;
            _ = config;
            return switch (observation_index) {
                0 => replaceMemoryField(flow, memory, 0, flow.optionalSome(?T.ListResult, payload)),
                1 => replaceMemoryField(
                    flow,
                    memory,
                    1,
                    upsertDocument(flow, flow.productExtract(1, memory), payload, context),
                ),
                2 => replaceMemoryField(flow, memory, 2, flow.optionalSome(?T.SearchResult, payload)),
                3 => observeTest(flow, memory, payload, context),
                4 => observeReplacement(flow, memory, payload, context),
                else => unreachable,
            };
        }

        pub fn emitObserve(
            comptime Definition: type,
            comptime config: anytype,
            flow: anytype,
            memory: anytype,
            observation: anytype,
            comptime context: anytype,
        ) agent.Value(T.Memory) {
            _ = Definition;
            _ = config;
            const joined = flow.block(.segment, .{T.Memory});
            var current_memory = memory;
            var current_observation = observation;
            inline for (0..5) |index| {
                if (index < 4) {
                    const selected = flow.block(.segment, .{ T.Memory, T.Observation });
                    const next = flow.block(.segment, .{ T.Memory, T.Observation });
                    flow.branch(
                        flow.sumTagIs(index, current_observation),
                        selected,
                        .{ current_memory, current_observation },
                        next,
                        .{ current_memory, current_observation },
                    );
                    const values = flow.enter(selected);
                    const payload = flow.sumExtract(index, values[1]);
                    const next_memory = switch (index) {
                        0 => replaceMemoryField(flow, values[0], 0, flow.optionalSome(?T.ListResult, payload)),
                        1 => replaceMemoryField(
                            flow,
                            values[0],
                            1,
                            upsertDocument(flow, flow.productExtract(1, values[0]), payload, context),
                        ),
                        2 => replaceMemoryField(flow, values[0], 2, flow.optionalSome(?T.SearchResult, payload)),
                        3 => observeTest(flow, values[0], payload, context),
                        else => unreachable,
                    };
                    flow.jump(joined, .{next_memory});
                    const next_values = flow.enter(next);
                    current_memory = next_values[0];
                    current_observation = next_values[1];
                } else {
                    flow.jump(joined, .{observeReplacement(
                        flow,
                        current_memory,
                        flow.sumExtract(4, current_observation),
                        context,
                    )});
                }
            }
            return flow.enter(joined)[0];
        }

        pub fn emitProject(
            comptime Definition: type,
            comptime config: anytype,
            flow: anytype,
            memory: anytype,
        ) agent.Value(T.DecisionView) {
            _ = Definition;
            _ = config;
            const evidence = flow.productConstruct(T.DecisionEvidence, .{
                flow.productExtract(6, memory),
                flow.productExtract(7, memory),
                flow.productExtract(8, memory),
                flow.productExtract(9, memory),
                flow.productExtract(10, memory),
            });
            return flow.productConstruct(T.DecisionView, .{
                flow.productExtract(0, memory),
                flow.productExtract(1, memory),
                flow.productExtract(2, memory),
                flow.productExtract(3, memory),
                flow.productExtract(4, memory),
                flow.productExtract(5, memory),
                evidence,
            });
        }

        pub fn emitFinalAllowed(
            comptime Definition: type,
            comptime config: anytype,
            flow: anytype,
            memory: anytype,
            result: anytype,
            comptime context: anytype,
        ) agent.Value(bool) {
            _ = Definition;
            _ = config;
            const four = flow.constant(u32, context.four_u32_index);
            const mutation_count = flow.productExtract(8, memory);
            var allowed = flow.productExtract(6, memory);
            allowed = flow.booleanAnd(allowed, flow.integerEqual(mutation_count, four));
            allowed = flow.booleanAnd(allowed, flow.integerEqual(flow.vectorLength(flow.productExtract(5, memory)), four));
            allowed = flow.booleanAnd(allowed, flow.productExtract(7, memory));
            allowed = flow.booleanAnd(allowed, flow.integerEqual(flow.productExtract(9, memory), mutation_count));
            allowed = flow.booleanAnd(allowed, flow.productExtract(2, result));
            allowed = flow.booleanAnd(allowed, flow.integerEqual(flow.productExtract(3, result), mutation_count));
            allowed = flow.booleanAnd(allowed, flow.integerEqual(flow.vectorLength(flow.productExtract(1, result)), four));
            return allowed;
        }
    };
}
