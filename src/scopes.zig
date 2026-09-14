//! Lexical interpretations and explicit portable scope values. Exiting a scope
//! restores the enclosing handler; suspension retains the installed environment.
const boundary = @import("boundary");
const source = boundary.computation;
const Id = source.Id;
const sets = @import("sets.zig");
const decision = @import("decision.zig");

/// Conversation/turn/branch memory can use Boundary's ordinary scoped state.
/// The caller supplies its region and chooses when/how to retain observations.
pub const state = boundary.library.state;
pub const Scope = decision.Scope;
pub const Reader = struct {
    family: decision.Family,
    handler: Id,
    resumption: Id,
    environment: Id,
};

pub fn define(
    b: *source.Builder,
    identity: []const u8,
    environment: Id,
    result: Id,
    scope: Scope,
) source.Error!Reader {
    const instance = try b.specialization(Reader, "agent.scope/v1", .{
        identity, environment, result, scope,
    });
    if (instance.cached) |cached| return cached;
    const unit = try b.scalar(void);
    const family = try decision.define(b, identity, unit, environment);
    const captures = try b.allocator().alloc(Id, scope.captures.len + 2);
    @memcpy(captures[0..scope.captures.len], scope.captures);
    captures[scope.captures.len] = family.capability;
    captures[scope.captures.len + 1] = environment;
    const token = try b.schema(.{ .internal = .{ .resumption = .{
        .effect = family.effect,
        .input = environment,
        .answer = result,
        .effects = scope.residual.effects,
        .capture_bound = captures,
        .handled = &.{family.effect},
        .mode = .deep,
        .use = .linear,
        .owned_regions = scope.owned_regions,
        .obligations = true,
    } } });
    const returns = try b.declare(&.{ environment, result }, result, &.{}, scope.borrowed_regions);
    try b.define(returns, try b.pure(try b.reference(b.parameter(returns, 1))));
    const clause = try b.declare(
        &.{ environment, unit, token },
        result,
        scope.residual.effects,
        scope.borrowed_regions,
    );
    try b.define(clause, try b.term(.{ .resume_value = .{
        .resumption = try b.reference(b.parameter(clause, 2)),
        .argument = try b.reference(b.parameter(clause, 0)),
    } }));
    return instance.finish(b, .{
        .family = family,
        .environment = environment,
        .resumption = token,
        .handler = try b.handler(.{
            .mode = .deep,
            .input = result,
            .answer = result,
            .return_function = returns,
            .state = &.{environment},
            .effects = scope.residual.effects,
            .clauses = &.{.{ .effect = family.effect, .function = clause, .resumption = token }},
        }),
    });
}

pub fn read(b: *source.Builder, reader: Reader, capability: Id) source.Error!Id {
    return decision.ask(b, reader.family, capability, try b.constant(void, {}));
}

pub fn enter(
    b: *source.Builder,
    reader: Reader,
    body: Id,
    environment: Id,
    arguments: []const Id,
) source.Error!Id {
    return b.term(.{ .handle = .{
        .handler = reader.handler,
        .body = body,
        .arguments = arguments,
        .state = &.{environment},
    } });
}

/// This optional product is ordinary application data, not runtime scope state.
/// Instructions are in caller order followed by each lexical contribution.
pub const Layout = struct {
    schema: Id,
    instructions: Id,
    model: Id,
    models: sets.Set,
    tools: sets.Set,
    skills: sets.Set,
    memory: Id,
    override_result: Id,
};
pub const Values = struct {
    model: Id,
    instructions: Id,
    models: Id,
    tools: Id,
    skills: Id,
    memory: Id,
};
pub const Restriction = struct { instructions: Id, models: Id, tools: Id, skills: Id };
pub const Field = enum(u64) { model, instructions, models, tools, skills, memory };

pub fn layout(
    b: *source.Builder,
    instruction: Id,
    memory: Id,
    models: usize,
    tools: usize,
    skills: usize,
) source.Error!Layout {
    const model_schema = try b.scalar(u64);
    const instructions = try b.schema(.{ .seq = instruction });
    const model_set = try sets.define(b, models);
    const tool_set = try sets.define(b, tools);
    const skill_set = try sets.define(b, skills);
    const schema = try b.schema(.{ .product = &.{
        model_schema, instructions, model_set.schema, tool_set.schema, skill_set.schema, memory,
    } });
    return .{
        .schema = schema,
        .instructions = instructions,
        .model = model_schema,
        .models = model_set,
        .tools = tool_set,
        .skills = skill_set,
        .memory = memory,
        .override_result = try b.schema(.{ .sum = &.{ schema, model_schema } }),
    };
}

pub fn value(b: *source.Builder, shape: Layout, values: Values) source.Error!Id {
    return b.primitive(shape.schema, .product, &.{
        values.model, values.instructions, values.models, values.tools, values.skills, values.memory,
    }, 0);
}

pub fn field(b: *source.Builder, shape: Layout, environment: Id, selected: Field) source.Error!Id {
    const schema = switch (selected) {
        .model => shape.model,
        .instructions => shape.instructions,
        .models => shape.models.schema,
        .tools => shape.tools.schema,
        .skills => shape.skills.schema,
        .memory => shape.memory,
    };
    return b.primitive(schema, .field, &.{environment}, @intFromEnum(selected));
}

/// A skill/policy contribution can only restrict authority. Instructions append
/// in lexical order; memory and the selected model remain explicit caller values.
pub fn narrow(
    b: *source.Builder,
    shape: Layout,
    outer: Id,
    restriction: Restriction,
) source.Error!Id {
    const models = try b.variable(shape.models.schema);
    const tools = try b.variable(shape.tools.schema);
    const skills = try b.variable(shape.skills.schema);
    const narrowed = try value(b, shape, .{
        .model = try field(b, shape, outer, .model),
        .instructions = try b.primitive(shape.instructions, .sequence_concat, &.{
            try field(b, shape, outer, .instructions), restriction.instructions,
        }, 0),
        .models = try b.reference(models),
        .tools = try b.reference(tools),
        .skills = try b.reference(skills),
        .memory = try field(b, shape, outer, .memory),
    });
    const narrowed_models = try sets.intersection(
        b,
        shape.models,
        try field(b, shape, outer, .models),
        restriction.models,
    );
    const narrowed_tools = try sets.intersection(
        b,
        shape.tools,
        try field(b, shape, outer, .tools),
        restriction.tools,
    );
    const narrowed_skills = try sets.intersection(
        b,
        shape.skills,
        try field(b, shape, outer, .skills),
        restriction.skills,
    );
    const with_skills = try b.bind(skills, narrowed_skills, try b.pure(narrowed));
    const with_tools = try b.bind(tools, narrowed_tools, with_skills);
    return b.bind(models, narrowed_models, with_tools);
}

/// Accepted(environment) | Denied(requested_model). The caller must author its
/// denied branch. There is no host override or silent selection of another model.
pub fn overrideModel(
    b: *source.Builder,
    shape: Layout,
    environment: Id,
    model_index: usize,
) source.Error!Id {
    const selected = try b.constant(u64, model_index);
    const allowed = try b.variable(try b.scalar(bool));
    const check = try sets.member(b, shape.models, try field(b, shape, environment, .models), model_index);
    const updated = try value(b, shape, .{
        .model = selected,
        .instructions = try field(b, shape, environment, .instructions),
        .models = try field(b, shape, environment, .models),
        .tools = try field(b, shape, environment, .tools),
        .skills = try field(b, shape, environment, .skills),
        .memory = try field(b, shape, environment, .memory),
    });
    return b.bind(allowed, check, try b.term(.{ .conditional = .{
        .condition = try b.reference(allowed),
        .when_true = try b.pure(try b.primitive(shape.override_result, .variant, &.{updated}, 0)),
        .when_false = try b.pure(try b.primitive(shape.override_result, .variant, &.{selected}, 1)),
    } }));
}
