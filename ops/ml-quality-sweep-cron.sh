#!/usr/bin/env bash
# Wrapper para systemd: corre la sweep de calidad ML diaria sobre la
# última 24h, escribe el reporte a /var/log/servifibras/ y sale con
# código 1 si encuentra cualquier hit CRIT (para que systemd marque
# la unit como failed → journalctl + alerting lo recoge).
set -euo pipefail

DAYS="${1:-1}"
LIMIT="${2:-300}"
LOG_DIR="/var/log/servifibras"
DATE_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$LOG_DIR/ml-quality-sweep-$DATE_STAMP.log"

mkdir -p "$LOG_DIR"

# Run the sweep, capture output to both the dated log and stdout.
bash /home/servifibras/ops/ml-quality-sweep.sh "$DAYS" "$LIMIT" | tee "$OUT"

# Exit non-zero if any CRIT-severity pattern fired with > 0 hits.
# Matches lines like "  [CRIT] mayorista_hijack: 3 — ..."
if grep -E '^\s+\[CRIT\] [a-z_]+: [1-9][0-9]*' "$OUT" >/dev/null 2>&1; then
  echo "" >&2
  echo "*** CRIT pattern(s) fired in last ${DAYS}d ML sweep — see $OUT ***" >&2
  grep -E '^\s+\[CRIT\] [a-z_]+: [1-9][0-9]*' "$OUT" >&2
  exit 1
fi

exit 0
