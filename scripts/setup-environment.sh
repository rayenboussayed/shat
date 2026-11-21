#!/usr/bin/env bash
set -euo pipefail

# SHAT — spec v1.0-draft §15.2: create .env from .env.example when absent.
# Apps that require config values document their needs in their subtasks
# (spec §15.4, §9). At S1 there is no .env.example, so this is a no-op.
if [ ! -f .env ] && [ -f .env.example ]; then
	cp .env.example .env
	echo "created .env from .env.example"
fi
exit 0
