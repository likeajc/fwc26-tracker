#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs the API's npm dependencies so tests can run in remote sessions.
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# The REST API (and its dependencies) lives in api/.
cd "$PROJECT_DIR/api"

# install (not ci) so the cached container reuses node_modules across sessions.
npm install
