#!/usr/bin/env bash
# ============================================================================
# Servifibras — canonical deploy script.
#
# Marcos 2026-06-10: every redeploy must go through here so the rebuild
# + restart sequence is consistent, the build window is short, and we
# don't end up running `prisma db push --accept-data-loss` or other
# destructive shortcuts that have burned us before.
#
# Flow:
#   1) Pre-flight checks (paths, systemd units, postgres reachable).
#   2) Detect schema drift on prisma/schema.prisma — abort unless the
#      operator explicitly passes --allow-schema-change (raw ALTER TABLE
#      must already have been applied at that point; see the memory
#      note feedback_prisma_db_push_data_loss.md).
#   3) Backend: `npm ci` (fallback npm install) → `npm run build`.
#   4) Frontend: same.
#   5) `prisma generate` so the freshly compiled JS picks up any new
#      Prisma client surface.
#   6) Restart backend via systemd (graceful shutdown hooks defined in
#      main.ts drain in-flight requests during SIGTERM). Poll /health
#      until 200 or timeout.
#   7) Restart frontend via systemd. Poll /login until 200.
#   8) Print a one-line summary; exit non-zero on any failure.
#
# Flags:
#   --backend-only      skip frontend
#   --frontend-only     skip backend
#   --no-build          skip builds (config-only redeploys)
#   --allow-schema-change   acknowledge that prisma/schema.prisma changed
#                       and you've already applied the matching SQL
#   --dry-run           print the plan, don't execute
#   --help              this text
#
# Exit codes:
#   0  success
#   1  unhandled error (set -e bailed)
#   2  precondition failed (paths missing, systemd not happy)
#   3  schema drift without --allow-schema-change
#   4  build failed (backend or frontend)
#   5  service didn't come back healthy after restart
# ============================================================================

set -euo pipefail
shopt -s extglob

# ---- paths --------------------------------------------------------------
BACKEND_DIR="/home/servifibras/backend"
FRONTEND_DIR="/home/servifibras/frontend"
BACKEND_UNIT="servifibras-backend"
FRONTEND_UNIT="servifibras-frontend"
BACKEND_HEALTH="http://localhost:3001/health"
FRONTEND_HEALTH="http://localhost:3000/login"
SCHEMA_FILE="$BACKEND_DIR/prisma/schema.prisma"
SCHEMA_HASH_FILE="/var/lib/servifibras-deploy/schema.sha256"
LOG_DIR="/var/log"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/servifibras-deploy-$TS.log"

# ---- flags --------------------------------------------------------------
DO_BACKEND=1
DO_FRONTEND=1
DO_BUILD=1
ALLOW_SCHEMA=0
DRY_RUN=0

while [[ ${1-} ]]; do
  case "$1" in
    --backend-only)        DO_FRONTEND=0 ;;
    --frontend-only)       DO_BACKEND=0 ;;
    --no-build)            DO_BUILD=0 ;;
    --allow-schema-change) ALLOW_SCHEMA=1 ;;
    --dry-run)             DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *) echo "FATAL: unknown flag '$1' — try --help" >&2; exit 2 ;;
  esac
  shift
done

# ---- helpers ------------------------------------------------------------
log()  { printf "[%s] %s\n" "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"; }
run()  {
  log "» $*"
  if [[ $DRY_RUN -eq 1 ]]; then return 0; fi
  "$@" 2>&1 | tee -a "$LOG_FILE"
  local rc=${PIPESTATUS[0]}
  if [[ $rc -ne 0 ]]; then log "✗ exit=$rc"; return $rc; fi
}
fatal(){ log "FATAL: $*"; exit "${2:-1}"; }

# ---- preconditions ------------------------------------------------------
sudo -n mkdir -p "$(dirname "$SCHEMA_HASH_FILE")" 2>/dev/null \
  || mkdir -p "$(dirname "$SCHEMA_HASH_FILE")" 2>/dev/null \
  || true
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/servifibras-deploy-$TS.log"
exec 2> >(tee -a "$LOG_FILE" >&2)
log "Servifibras deploy — log $LOG_FILE"
log "flags: backend=$DO_BACKEND frontend=$DO_FRONTEND build=$DO_BUILD allow_schema=$ALLOW_SCHEMA dry_run=$DRY_RUN"

[[ -d "$BACKEND_DIR" ]]  || fatal "backend dir missing: $BACKEND_DIR" 2
[[ -d "$FRONTEND_DIR" ]] || fatal "frontend dir missing: $FRONTEND_DIR" 2
systemctl cat "$BACKEND_UNIT" >/dev/null 2>&1  || fatal "$BACKEND_UNIT unit not found"  2
systemctl cat "$FRONTEND_UNIT" >/dev/null 2>&1 || fatal "$FRONTEND_UNIT unit not found" 2

# .env ownership guard — Marcos 2026-06-18 incident: an Edit-tool write
# under root left backend/.env owned root:root mode 600. The nightly
# backup service runs as user `servifibras` and silently FATAL'd
# ("/home/servifibras/backend/.env not readable") for 2 nights — the
# health endpoint then flagged backup as 'down' and Caddy refused
# upstream traffic. Heal proactively on every deploy so any errant
# editor (deploy script, manual sudo edit, AI tool) gets corrected.
if [[ -f "$BACKEND_DIR/.env" ]]; then
  chown servifibras:servifibras "$BACKEND_DIR/.env" 2>/dev/null || true
  chmod 640 "$BACKEND_DIR/.env" 2>/dev/null || true
fi
# Marcos 2026-06-30: el cache de Next.js bajo .next/cache/images/
# tenia root:root porque uno de los builds tempranos corrio bajo
# root y dejo el dir asi. El frontend service corre como
# servifibras, asi que cada SSR de pagina con imagen tiraba
# EACCES (180+ errores hoy) lo que en casos limite mostraba
# "Internal Server Error" a Marcos cuando una pagina con imagen
# se renderizaba en cold. Heal proactivo en cada deploy.
if [[ -d "$FRONTEND_DIR/.next/cache" ]]; then
  chown -R servifibras:servifibras "$FRONTEND_DIR/.next/cache" 2>/dev/null || true
fi

# Postgres reachability via the env DB url. We only test that DATABASE_URL
# parses; pg_isready is the cleanest probe.
PG_HOST="$(grep -oP '^DATABASE_URL=postgres(ql)?://[^@]+@\K[^:/]+' "$BACKEND_DIR/.env" || true)"
PG_PORT="$(grep -oP '^DATABASE_URL=postgres(ql)?://[^@]+@[^:/]+:\K[0-9]+' "$BACKEND_DIR/.env" || echo 5432)"
if [[ -n "$PG_HOST" ]]; then
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q -h "$PG_HOST" -p "$PG_PORT" || fatal "postgres not reachable at $PG_HOST:$PG_PORT" 2
  fi
fi

# ---- schema drift detection ---------------------------------------------
if [[ -f "$SCHEMA_FILE" ]]; then
  current_hash="$(sha256sum "$SCHEMA_FILE" | awk '{print $1}')"
  prev_hash=""
  [[ -f "$SCHEMA_HASH_FILE" ]] && prev_hash="$(cat "$SCHEMA_HASH_FILE")"
  if [[ -n "$prev_hash" && "$current_hash" != "$prev_hash" ]]; then
    if [[ $ALLOW_SCHEMA -eq 0 ]]; then
      log "✗ prisma/schema.prisma changed since last deploy"
      log "  previous sha256: $prev_hash"
      log "  current sha256:  $current_hash"
      log "  apply the matching SQL (raw ALTER TABLE) FIRST, then re-run"
      log "  with --allow-schema-change. NEVER use db push --accept-data-loss."
      exit 3
    fi
    log "⚠ schema change acknowledged via --allow-schema-change"
  fi
fi

# ---- builds -------------------------------------------------------------
if [[ $DO_BUILD -eq 1 ]]; then
  if [[ $DO_BACKEND -eq 1 ]]; then
    log "=== BACKEND BUILD ==="
    run cd "$BACKEND_DIR"
    if [[ -f "$BACKEND_DIR/package-lock.json" ]]; then
      run npm --prefix "$BACKEND_DIR" ci || run npm --prefix "$BACKEND_DIR" install || exit 4
    else
      run npm --prefix "$BACKEND_DIR" install || exit 4
    fi
    run npm --prefix "$BACKEND_DIR" run build || exit 4
    # Always regenerate the Prisma client — if a new column was added
    # via raw ALTER + the schema was updated, the in-tree client may
    # still be stale otherwise.
    run npx --prefix "$BACKEND_DIR" prisma generate --schema="$SCHEMA_FILE" || true
  fi

  if [[ $DO_FRONTEND -eq 1 ]]; then
    log "=== FRONTEND BUILD ==="
    if [[ -f "$FRONTEND_DIR/package-lock.json" ]]; then
      run npm --prefix "$FRONTEND_DIR" ci || run npm --prefix "$FRONTEND_DIR" install || exit 4
    else
      run npm --prefix "$FRONTEND_DIR" install || exit 4
    fi
    run npm --prefix "$FRONTEND_DIR" run build || exit 4
  fi
fi

# ---- restarts + health checks -------------------------------------------
poll_health() {
  local url="$1" label="$2" deadline=$(( $(date +%s) + 60 ))
  while [[ $(date +%s) -lt $deadline ]]; do
    local code; code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" || true)"
    if [[ "$code" =~ ^2 ]]; then
      log "✓ $label healthy (HTTP $code)"
      return 0
    fi
    sleep 1
  done
  log "✗ $label did not return 2xx within 60s"
  return 5
}

if [[ $DO_BACKEND -eq 1 ]]; then
  log "=== BACKEND RESTART ==="
  run systemctl restart "$BACKEND_UNIT"
  poll_health "$BACKEND_HEALTH" "backend" || exit 5
fi

if [[ $DO_FRONTEND -eq 1 ]]; then
  log "=== FRONTEND RESTART ==="
  run systemctl restart "$FRONTEND_UNIT"
  poll_health "$FRONTEND_HEALTH" "frontend" || exit 5
fi

# ---- record schema hash so the next deploy can detect drift -------------
if [[ -f "$SCHEMA_FILE" && $DRY_RUN -eq 0 ]]; then
  mkdir -p "$(dirname "$SCHEMA_HASH_FILE")" 2>/dev/null || true
  sha256sum "$SCHEMA_FILE" | awk '{print $1}' > "$SCHEMA_HASH_FILE" 2>/dev/null || true
fi

log "=== DEPLOY OK ==="
log "log file: $LOG_FILE"
