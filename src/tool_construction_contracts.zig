//! Ordinary bounded values shared by tool authoring and native execution.
const contracts = @import("contracts.zig");

pub const maximum_asset_bytes = 128 * 1024;
pub const maximum_value_bytes = 32 * 1024;
pub const maximum_recipe_bytes = 8 * 1024;
pub const Name = contracts.Text(64);
pub const Component = struct { id: Name, object: contracts.Bytes(maximum_asset_bytes) };
pub const Catalog = contracts.Vector(Component, 16);
pub const Endpoint = struct { instance: Name, symbol: Name };
pub const Recipe = struct {
    instances: contracts.Vector(struct { key: Name, component_id: Name }, 16),
    bindings: contracts.Vector(struct { required: Endpoint, supplied: Endpoint }, 64),
    entry: Endpoint,
};
pub const Interface = struct {
    input: contracts.Bytes(maximum_asset_bytes),
    output: contracts.Bytes(maximum_asset_bytes),
    failure: contracts.Bytes(maximum_asset_bytes),
};
pub const Built = struct { image: contracts.Bytes(maximum_asset_bytes), interface: Interface };
