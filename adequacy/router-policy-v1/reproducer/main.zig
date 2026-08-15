const agent = @import("agent");

const DocumentSlot = enum {
    readme,
    package,
};

const SnapshotKey = struct {
    slot: DocumentSlot,
    slot_code: u8,
};

fn lowerRequiredValidation() type {
    const Builder = agent.Flow(.{ .schema_types = .{ SnapshotKey, DocumentSlot } });
    comptime var flow = Builder.init("agent-adequacy-slot-code-reproducer");
    const input = flow.begin(SnapshotKey);
    const slot = flow.productExtract(0, input);
    const slot_code = flow.productExtract(1, input);

    // Agent Adequacy Section 15.5 requires this correspondence check. Agent
    // v2.0.0 accepts only equal fixed-width integer operand types here and
    // exposes no enum ordinal operation.
    const corresponds = flow.integerEqual(slot, slot_code);
    flow.returnValue(corresponds);
    return flow.finish(bool);
}

comptime {
    _ = lowerRequiredValidation();
}
