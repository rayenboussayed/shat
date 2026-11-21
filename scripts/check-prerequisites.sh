#!/usr/bin/env bash
set -euo pipefail

# SHAT — spec v1.0-draft §15.2: verify the toolchain before install.
need() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "missing tool: $1" >&2
		exit 1
	fi
}

for tool in git node npm make; do
	need "$tool"
done

expected_node=$(tr -d 'v\r\n' <.nvmrc)
actual_node=$(node --version | tr -d 'v')
if [ "$actual_node" != "$expected_node" ]; then
	echo "node version mismatch: expected $expected_node (from .nvmrc), got $actual_node" >&2
	exit 1
fi

echo "check-prerequisites: git $(git --version | awk '{print $3}'), node $actual_node, npm $(npm --version) — ok"
