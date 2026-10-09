//! Native snapshot operations retain the baseline application schemas.
const native = @import("agent_native");
const t = @import("application_types");
const Queries = native.repository.Tools(t);
pub const list = Queries.list;
pub const read = Queries.read;
