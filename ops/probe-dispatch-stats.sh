#!/usr/bin/env bash
# Probe Despachos por mensajería. Útil para verificar la cascada de
# derivación de carrier (flexCourier > source > defaultCarrier > Sin asignar).
#   bash ops/probe-dispatch-stats.sh [from=YYYY-MM-DD] [to=YYYY-MM-DD]
set -euo pipefail
BACKEND_DIR="/home/servifibras/backend"
SCRIPT="$BACKEND_DIR/dist/src/scripts/probe-dispatch-stats.js"
[[ -f "$SCRIPT" ]] || { echo "ERROR: $SCRIPT no existe. npm run build primero." >&2; exit 2; }
[[ -f "$BACKEND_DIR/.env" ]] || { echo "ERROR: $BACKEND_DIR/.env no existe." >&2; exit 2; }
cd "$BACKEND_DIR"
set -a
# shellcheck disable=SC1091
source ./.env
set +a
exec node --max-old-space-size=2048 "$SCRIPT" "${1:-}" "${2:-}"
