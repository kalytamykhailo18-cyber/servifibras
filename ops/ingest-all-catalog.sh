#!/usr/bin/env bash
# Wrapper para correr el script ingest-all-catalog.js con el .env del
# backend cargado (igual que lo hace systemd via EnvironmentFile).
#
#   bash ops/ingest-all-catalog.sh both              # ambas cuentas (default)
#   bash ops/ingest-all-catalog.sh mercadolibre
#   bash ops/ingest-all-catalog.sh mercadolibre_cuenta2
set -euo pipefail

BACKEND_DIR="/home/servifibras/backend"
SCRIPT="$BACKEND_DIR/dist/src/scripts/ingest-all-catalog.js"
ACCOUNT_KEY="${1:-both}"

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

exec node --max-old-space-size=2048 "$SCRIPT" "$ACCOUNT_KEY"
