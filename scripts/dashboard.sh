#!/bin/bash
# Starts Richie's dashboard on http://127.0.0.1:8792 (RICHIE_PORT to change it) over your real ledger (read-only), with the
# Pause / Run session / Sell controls (CONTROLS.md). Set RICHIE_CONTROLS=off for a view-only page.
# On macOS it runs inside a sandbox (src/dashboard-sandbox.sb): no Keychain, no internet, writes only the controls inbox.
# For a demo with sample data and no accounts at all, run: npm run demo
set -euo pipefail
CODE="$(cd "$(dirname "$0")/.." && pwd -P)"
DATA="${RICHIE_HOME:-$HOME/.richie}"
mkdir -p "$DATA/controls"
CONTROLS=()
if [ "${RICHIE_CONTROLS:-on}" != "off" ]; then CONTROLS=(--controls "$DATA/controls/inbox.db"); fi
NODE_BIN="$(command -v node)"
if [ "$(uname)" = "Darwin" ] && [ -x /usr/bin/sandbox-exec ] && [ "${RICHIE_SANDBOX:-on}" != "off" ]; then
  NODE_REAL="$(cd "$(dirname "$(readlink -f "$NODE_BIN")")/.." && pwd -P)"
  exec /usr/bin/sandbox-exec -D HOME="$HOME" -D CODE="$CODE" -D DATA="$(cd "$DATA" && pwd -P)" -D NODE="$NODE_REAL" -f "$CODE/src/dashboard-sandbox.sb" \
    "$NODE_BIN" --disable-warning=ExperimentalWarning "$CODE/src/server.mjs" --port "${RICHIE_PORT:-8792}" --ledger "$DATA/ledger.db" ${CONTROLS[@]+"${CONTROLS[@]}"}
fi
exec "$NODE_BIN" --disable-warning=ExperimentalWarning "$CODE/src/server.mjs" --port "${RICHIE_PORT:-8792}" --ledger "$DATA/ledger.db" ${CONTROLS[@]+"${CONTROLS[@]}"}
