#!/usr/bin/env bash
# Audita las últimas respuestas AI en ML contra patrones conocidos.
#   bash ops/ml-quality-sweep.sh [days=7] [limit=200]
set -euo pipefail

BACKEND_DIR="/home/servifibras/backend"
SCRIPT="$BACKEND_DIR/dist/src/scripts/ml-quality-sweep.js"

if [[ ! -f "$SCRIPT" ]]; then
  echo "ERROR: $SCRIPT no existe. Corré 'npm run build' primero." >&2
  exit 2
fi
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "ERROR: $BACKEND_DIR/.env no existe." >&2
  exit 2
fi

cd "$BACKEND_DIR"
set -a
# shellcheck disable=SC1091
source ./.env
set +a

exec node "$SCRIPT" "${1:-7}" "${2:-200}"
