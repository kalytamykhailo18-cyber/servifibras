#!/usr/bin/env bash
# Refresh todos los reclamos abiertos: re-fetch desde ML + re-guarda
# el mensaje con el formato actualizado. Útil después de cambios en
# fetchClaimDetails (ej. strip HTML del mediador 2026-06-29).
#   bash ops/refresh-open-claims.sh [limit=200]
set -euo pipefail
BACKEND_DIR="/home/servifibras/backend"
SCRIPT="$BACKEND_DIR/dist/src/scripts/refresh-open-claims.js"
[[ -f "$SCRIPT" ]] || { echo "ERROR: $SCRIPT no existe. npm run build primero." >&2; exit 2; }
[[ -f "$BACKEND_DIR/.env" ]] || { echo "ERROR: $BACKEND_DIR/.env no existe." >&2; exit 2; }
cd "$BACKEND_DIR"
set -a
# shellcheck disable=SC1091
source ./.env
set +a
exec node --max-old-space-size=2048 "$SCRIPT" "${1:-}"
