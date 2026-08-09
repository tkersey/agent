#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

forbidden='AgentRuntime|AgentSession|AgentInterpreter|load_agent|load_strategy|register_tool|switch_strategy|interpret_definition|runtime_tool_registry|runtime_strategy_registry|std\.http|openai|anthropic|@import\("world|@import\("world-host|@import\("world-capabilities'

if rg -n -i "$forbidden" "$repo_root/src" -g '*.zig'; then
    printf '%s\n' 'agent production source contains a forbidden runtime or integration surface' >&2
    exit 1
fi

if rg -n 'pub const (Runtime|Session|Interpreter|VM|Loader|Registry|Scheduler|Host|Capability|World)[[:space:]]*=' "$repo_root/src/root.zig"; then
    printf '%s\n' 'agent root exposes a forbidden runtime owner' >&2
    exit 1
fi

printf '%s\n' 'runtime_agent_definition_loader=false'
printf '%s\n' 'runtime_strategy_registry=false'
printf '%s\n' 'runtime_tool_registry=false'
printf '%s\n' 'generic_agent_interpreter=false'
printf '%s\n' 'boundary_machine_is_only_reducer=true'
