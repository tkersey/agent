#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
observed=$(mktemp "${TMPDIR:-/tmp}/agent-zig-paths.XXXXXX")
trap 'rm -f "$observed"' EXIT

cd "$repo_root"
rg --files -g '*.zig' -g '!zig-cache/**' -g '!zig-out/**' -g '!zig-pkg/**' | sort >"$observed"
cmp -s repo_zig_paths.txt "$observed" || {
    diff -u repo_zig_paths.txt "$observed" >&2 || true
    printf '%s\n' 'repo_zig_paths.txt does not cover the current Zig source graph' >&2
    exit 1
}
