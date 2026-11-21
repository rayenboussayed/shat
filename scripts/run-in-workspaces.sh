#!/usr/bin/env bash
# Run a script in every workspace dir (apps/*, packages/*). Workspaces that
# do not define the script are skipped; use npm's --if-present flag so this
# stays correct without hand-writing a package.json parser.
set -euo pipefail
script="$1"
failed=0
for d in apps/* packages/*; do
  if [ -f "$d/package.json" ]; then
    echo "== npm run $script -- $d =="
    if ! (cd "$d" && npm run "$script" --if-present); then
      failed=1
    fi
  fi
done
if [ "$failed" -ne 0 ]; then
  echo "run-in-workspaces: at least one workspace failed" >&2
  exit 1
fi
