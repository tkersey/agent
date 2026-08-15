#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
clean_root=$(mktemp -d "${TMPDIR:-/tmp}/agent-external-consumer.XXXXXX")
trap 'rm -rf "$clean_root"' EXIT

mkdir "$clean_root/agent" "$clean_root/consumer"
tar \
    --exclude='./.git' \
    --exclude='./.zig-cache' \
    --exclude='./zig-cache' \
    --exclude='./zig-out' \
    --exclude='./zig-pkg' \
    -C "$repo_root" -cf - . | tar -x -C "$clean_root/agent"
cp -R "$repo_root/test/external_consumer/." "$clean_root/consumer/"

if [ -n "${AGENT_BOUNDARY_ROOT:-}" ]; then
    cp -R "$AGENT_BOUNDARY_ROOT" "$clean_root/boundary"
else
    test ! -e "$clean_root/boundary"
fi
if [ -n "${AGENT_WORLD_ROOT:-}" ]; then
    cp -R "$AGENT_WORLD_ROOT" "$clean_root/world"
fi
cd "$clean_root/consumer"
zig build check --summary all

printf '%s\n' \
    'clean_room_agent_definition=true' \
    'clean_room_strategy_selection=true' \
    'boundary_source_checkout_required=false' \
    'sibling_checkout_required=false'
