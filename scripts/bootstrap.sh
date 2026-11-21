#!/usr/bin/env bash
set -euo pipefail

# SHAT — spec v1.0-draft §15.2 clone/setup checklist.
cd "$(dirname "$0")/.."
bash scripts/check-prerequisites.sh
npm install --no-audit --no-fund
bash scripts/setup-environment.sh
echo "bootstrap complete. Next: make help, make dev, make check"
