pub fn WorkingSet(comptime agent: type, comptime T: type) type {
    return struct {
        pub const semantic_identity = "agent.epistemics.repository-working-set.lowering.v1";
        pub const lowering_complexity: usize = 8;
        const CompactEntries = @typeInfo(T.CompactListing).@"struct".fields[0].type;
        const SourceEntries = @typeInfo(T.ListResult).@"struct".fields[0].type;
        const CompactHits = @typeInfo(T.CompactSearch).@"struct".fields[0].type;
        const SourceHits = @typeInfo(T.SearchResult).@"struct".fields[0].type;

        pub fn constantValues(comptime Definition: type, comptime config: anytype) @TypeOf(.{
            T.DocumentRole.package,
            T.DocumentRole.source,
            T.DocumentRole.@"test",
        }) {
            _ = Definition;
            _ = config;
            return .{
                T.DocumentRole.package,
                T.DocumentRole.source,
                T.DocumentRole.@"test",
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
                pub const package_role_index: u16 = base;
                pub const source_role_index: u16 = base + 1;
                pub const test_role_index: u16 = base + 2;
                pub const zero_u8_index: u16 = base + 4;
                pub const one_u8_index: u16 = base + 5;
                pub const two_u8_index: u16 = base + 6;
            };
        }

        pub fn validate(comptime Definition: type, comptime config: anytype) void {
            _ = config;
            if (Definition.Observation != T.Observation) {
                @compileError("repository working-set epistemics requires the repository-repair Observation");
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
            T.CompactListing,
            ?T.CompactListing,
            T.CompactTreeEntry,
            T.ListResult,
            T.TreeEntry,
            CompactEntries,
            SourceEntries,
            T.ReadResult,
            ?T.ReadResult,
            T.CompactSearch,
            ?T.CompactSearch,
            T.CompactSearchHit,
            T.SearchResult,
            T.SearchHit,
            CompactHits,
            SourceHits,
            T.TestResult,
            ?T.TestResult,
            T.CompactTestResult,
            ?T.CompactTestResult,
            T.ReplacementSummary,
            T.ReplaceOutcome,
            T.ReplaceApplied,
            T.ReplaceDenied,
            T.ReplaceConflict,
            T.Path,
            T.DigestHex,
            T.FileText,
            T.ExcerptText,
            T.EntryKind,
            T.DocumentRole,
        }) {
            _ = Definition;
            _ = config;
            return .{
                T.Memory,
                T.DecisionView,
                T.DecisionEvidence,
                T.CompactListing,
                ?T.CompactListing,
                T.CompactTreeEntry,
                T.ListResult,
                T.TreeEntry,
                CompactEntries,
                SourceEntries,
                T.ReadResult,
                ?T.ReadResult,
                T.CompactSearch,
                ?T.CompactSearch,
                T.CompactSearchHit,
                T.SearchResult,
                T.SearchHit,
                CompactHits,
                SourceHits,
                T.TestResult,
                ?T.TestResult,
                T.CompactTestResult,
                ?T.CompactTestResult,
                T.ReplacementSummary,
                T.ReplaceOutcome,
                T.ReplaceApplied,
                T.ReplaceDenied,
                T.ReplaceConflict,
                T.Path,
                T.DigestHex,
                T.FileText,
                T.ExcerptText,
                T.EntryKind,
                T.DocumentRole,
            };
        }

        pub fn initialMemory(comptime Definition: type, comptime config: anytype) T.Memory {
            _ = Definition;
            _ = config;
            return .{
                .listing = null,
                .package_document = null,
                .source_document = null,
                .test_document = null,
                .latest_search = null,
                .latest_test = null,
                .replacement = null,
                .failing_test_observed = false,
                .mutation_applied = false,
                .passing_test_observed = false,
            };
        }

        fn compactListing(flow: anytype, source: anytype, comptime context: anytype) agent.Value(T.CompactListing) {
            _ = context;
            return flow.copy(source);
        }

        fn compactSearch(flow: anytype, source: anytype, comptime context: anytype) agent.Value(T.CompactSearch) {
            _ = context;
            return flow.copy(source);
        }

        fn replaceMemoryField(
            flow: anytype,
            memory: anytype,
            comptime field_index: usize,
            replacement: anytype,
        ) agent.Value(T.Memory) {
            return flow.productReplace(field_index, memory, replacement);
        }

        fn observeRead(flow: anytype, memory: anytype, read: anytype, comptime context: anytype) agent.Value(T.Memory) {
            const code = flow.productExtract(1, read);
            const zero_code = flow.constant(u8, context.zero_u8_index);
            const source_code = flow.constant(u8, context.one_u8_index);
            const test_code = flow.constant(u8, context.two_u8_index);
            const is_package = flow.integerEqual(code, zero_code);
            const is_source = flow.integerEqual(code, source_code);
            const is_test = flow.integerEqual(code, test_code);
            const package = flow.block(.segment, .{});
            const classify_non_package = flow.block(.segment, .{});
            const source = flow.block(.segment, .{});
            const classify_test = flow.block(.segment, .{});
            const test_document = flow.block(.segment, .{});
            const invalid = flow.block(.terminal_handoff, .{});
            const joined = flow.block(.segment, .{T.Memory});
            flow.branch(is_package, package, .{}, classify_non_package, .{});

            _ = flow.enter(package);
            const package_read = flow.productReplace(
                0,
                read,
                flow.constant(T.DocumentRole, context.package_role_index),
            );
            flow.jump(joined, .{replaceMemoryField(
                flow,
                memory,
                1,
                flow.optionalSome(?T.ReadResult, package_read),
            )});

            _ = flow.enter(classify_non_package);
            flow.branch(is_source, source, .{}, classify_test, .{});

            _ = flow.enter(source);
            const source_read = flow.productReplace(
                0,
                read,
                flow.constant(T.DocumentRole, context.source_role_index),
            );
            flow.jump(joined, .{replaceMemoryField(
                flow,
                memory,
                2,
                flow.optionalSome(?T.ReadResult, source_read),
            )});

            _ = flow.enter(classify_test);
            flow.branch(is_test, test_document, .{}, invalid, .{});

            _ = flow.enter(test_document);
            const test_read = flow.productReplace(
                0,
                read,
                flow.constant(T.DocumentRole, context.test_role_index),
            );
            flow.jump(joined, .{replaceMemoryField(
                flow,
                memory,
                3,
                flow.optionalSome(?T.ReadResult, test_read),
            )});

            _ = flow.enter(invalid);
            flow.failValue(flow.constant(T.Failure, context.invalid_variant_index));

            return flow.enter(joined)[0];
        }

        fn observeTest(flow: anytype, memory: anytype, test_result: anytype, comptime context: anytype) agent.Value(T.Memory) {
            const passed = flow.productExtract(1, test_result);
            const mutation = flow.productExtract(8, memory);
            const failing = flow.booleanAnd(flow.booleanNot(passed), flow.booleanNot(mutation));
            const compact = flow.productConstruct(T.CompactTestResult, .{
                flow.productExtract(0, test_result),
                passed,
                flow.productExtract(4, test_result),
                flow.productExtract(5, test_result),
            });
            _ = context;
            const flags = flow.block(.segment, .{ T.Memory, bool, bool });
            flow.jump(flags, .{
                replaceMemoryField(
                    flow,
                    memory,
                    5,
                    flow.optionalSome(?T.CompactTestResult, compact),
                ),
                failing,
                flow.select(
                    mutation,
                    passed,
                    flow.productExtract(9, memory),
                ),
            });

            const flag_values = flow.enter(flags);
            const failing_memory = replaceMemoryField(
                flow,
                flag_values[0],
                7,
                flow.booleanOr(flow.productExtract(7, flag_values[0]), flag_values[1]),
            );
            return replaceMemoryField(
                flow,
                failing_memory,
                9,
                flag_values[2],
            );
        }

        fn observeReplacement(flow: anytype, memory: anytype, outcome: anytype, comptime context: anytype) agent.Value(T.Memory) {
            const applied = flow.sumTagIs(0, outcome);
            const conflict = flow.sumTagIs(2, outcome);
            const clears_source = flow.booleanOr(applied, conflict);
            const absent_read = flow.optionalNone(?T.ReadResult);
            const search = flow.block(.segment, .{ T.Memory, T.ReplaceOutcome, bool });
            flow.jump(search, .{
                replaceMemoryField(
                    flow,
                    memory,
                    2,
                    flow.select(clears_source, absent_read, flow.productExtract(2, memory)),
                ),
                outcome,
                applied,
            });

            const search_values = flow.enter(search);
            const clears_search = flow.booleanOr(
                search_values[2],
                flow.sumTagIs(2, search_values[1]),
            );
            const summary = flow.block(.segment, .{ T.Memory, T.ReplaceOutcome, bool });
            flow.jump(summary, .{
                replaceMemoryField(
                    flow,
                    search_values[0],
                    4,
                    flow.select(
                        clears_search,
                        flow.optionalNone(?T.CompactSearch),
                        flow.productExtract(4, search_values[0]),
                    ),
                ),
                search_values[1],
                search_values[2],
            });

            const summary_values = flow.enter(summary);
            const mutation = flow.block(.segment, .{ T.Memory, bool, bool });
            flow.jump(mutation, .{
                replaceMemoryField(
                    flow,
                    summary_values[0],
                    6,
                    flow.optionalSome(T.ReplacementSummary, summary_values[1]),
                ),
                summary_values[2],
                flow.booleanOr(
                    summary_values[2],
                    flow.sumTagIs(2, summary_values[1]),
                ),
            });

            const mutation_values = flow.enter(mutation);
            const mutation_memory = replaceMemoryField(
                flow,
                mutation_values[0],
                8,
                flow.booleanOr(
                    flow.productExtract(8, mutation_values[0]),
                    mutation_values[1],
                ),
            );
            return replaceMemoryField(
                flow,
                mutation_memory,
                9,
                flow.select(
                    mutation_values[2],
                    flow.constant(bool, context.false_index),
                    flow.productExtract(9, mutation_memory),
                ),
            );
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
            _ = Definition;
            _ = config;
            const payload = flow.sumExtract(observation_index, observation);
            return switch (observation_index) {
                0 => replaceMemoryField(
                    flow,
                    memory,
                    0,
                    flow.optionalSome(?T.CompactListing, payload),
                ),
                1 => observeRead(flow, memory, payload, context),
                2 => replaceMemoryField(
                    flow,
                    memory,
                    4,
                    flow.optionalSome(?T.CompactSearch, payload),
                ),
                3 => observeTest(flow, memory, payload, context),
                4 => observeReplacement(flow, memory, payload, context),
                else => unreachable,
            };
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
                0 => replaceMemoryField(
                    flow,
                    memory,
                    0,
                    flow.optionalSome(?T.CompactListing, payload),
                ),
                1 => observeRead(flow, memory, payload, context),
                2 => replaceMemoryField(
                    flow,
                    memory,
                    4,
                    flow.optionalSome(?T.CompactSearch, payload),
                ),
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
                        0 => replaceMemoryField(
                            flow,
                            values[0],
                            0,
                            flow.optionalSome(?T.CompactListing, payload),
                        ),
                        1 => observeRead(flow, values[0], payload, context),
                        2 => replaceMemoryField(
                            flow,
                            values[0],
                            4,
                            flow.optionalSome(?T.CompactSearch, payload),
                        ),
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
                flow.productExtract(7, memory),
                flow.productExtract(8, memory),
                flow.productExtract(9, memory),
            });
            return flow.productConstruct(T.DecisionView, .{
                flow.productExtract(0, memory),
                flow.productExtract(1, memory),
                flow.productExtract(2, memory),
                flow.productExtract(3, memory),
                flow.productExtract(4, memory),
                flow.productExtract(5, memory),
                flow.productExtract(6, memory),
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
            _ = context;
            return flow.booleanAnd(
                flow.booleanAnd(
                    flow.productExtract(7, memory),
                    flow.productExtract(8, memory),
                ),
                flow.booleanAnd(
                    flow.productExtract(9, memory),
                    flow.productExtract(2, result),
                ),
            );
        }
    };
}
