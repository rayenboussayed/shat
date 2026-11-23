#!/usr/bin/env bash
set -euo pipefail

# SHAT — health check per spec §15.4: backend /health on 127.0.0.1:$PORT.
# PORT defaults to 3000 when unset or empty; published Docker ports can set it.
host=127.0.0.1
port="${PORT:-3000}"
path=/health

for _ in $(seq 1 30); do
	if curl -fsS --max-time 2 "http://$host:$port$path" >/dev/null 2>&1; then
		echo "health: OK http://$host:$port$path"
		exit 0
	fi
	sleep 1
done

echo "health: backend not responding at http://$host:$port$path (apps: $(ls apps 2>/dev/null | tr '\n' ' ')?)" >&2
exit 1
