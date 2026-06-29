#!/usr/bin/env bash
# Mide el tiempo de DailyLogisticaAggregatorService.aggregate sin
# tener que esperar tráfico real. Útil para iterar sobre la perf
# del aggregator.
set -euo pipefail

BACKEND_DIR="/home/servifibras/backend"
SCRIPT="$BACKEND_DIR/dist/src/scripts/probe-aggregator.js"

[[ -f "$SCRIPT" ]] || { echo "ERROR: $SCRIPT no existe. Corré 'npm run build'." >&2; exit 2; }
[[ -f "$BACKEND_DIR/.env" ]] || { echo "ERROR: $BACKEND_DIR/.env no existe." >&2; exit 2; }

cd "$BACKEND_DIR"
set -a
# shellcheck disable=SC1091
source ./.env
set +a

exec node --max-old-space-size=2048 "$SCRIPT"
