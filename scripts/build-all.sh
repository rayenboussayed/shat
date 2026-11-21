#!/usr/bin/env bash
set -euo pipefail

# SHAT — spec v1.0-draft §15.4: build every workspace package.
npm run build
