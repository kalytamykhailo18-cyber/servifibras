#!/usr/bin/env bash
# Full E2E sweep. Runs every test-*-e2e.{ts,js} and the *-detector.ts /
# *-classifier.ts probes in /home/servifibras/e2e in sequence. On a login
# throttle hit, waits for the window to clear and retries the same test
# once. Writes per-test logs to /tmp/e2e-logs and a summary at the end.
set -u
cd /home/servifibras/e2e

LOGDIR=/tmp/e2e-logs
rm -rf "$LOGDIR"; mkdir -p "$LOGDIR"
SUMMARY="$LOGDIR/_summary.tsv"
: > "$SUMMARY"

API="${SERVIFIBRAS_API_URL:-http://localhost:3001}"

# Sweep needs the backend's DATABASE_URL (Prisma seeds + assertions),
# plus every other runtime env (Anthropic key, ML/TN tokens, feature
# flags). Source the backend .env into the sweep process so every
# `bash -c` subshell spawned by run_one inherits them. Marcos 2026-06-11:
# without this every Prisma-using .ts test no-summary-line'd.
ENV_FILE="/home/servifibras/backend/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo ">>> pre-flight: sourced $ENV_FILE (DATABASE_URL present: $([ -n "${DATABASE_URL:-}" ] && echo yes || echo no))"
else
  echo "WARNING: $ENV_FILE not found — Prisma tests will fail"
fi

# Pre-flight: restore the 4 demo seed users (admin / brenda / franco /
# aldo) to canonical role + password. Some user-management tests mutate
# them and don't always cleanup. Without this guard, every other sweep
# cascades into "invalid_credentials" noise. Marcos 2026-06-07: third
# time we got bitten. Cheap and idempotent — always run it.
echo ">>> pre-flight: restoring demo seed users"
SERVIFIBRAS_E2E=1 node /home/servifibras/e2e/_restore-seed-users.js | tee "$LOGDIR/_seed-restore.log" || {
  echo "WARNING: seed-restore script failed — sweep may show false-positive auth failures"
}

# Marcos 2026-06-08, security gap #9 fallout: the per-account lockout
# protection ships enabled in prod, but the sweep includes UI tests
# that do wrong-password attempts on the seed accounts as part of
# RBAC / login-reasons coverage. With the lockout on, those tests
# cumulatively lock admin / brenda / franco / aldo mid-sweep and the
# remaining tests cascade into 401s. Disable lockout for the sweep —
# the security mechanism still passes its own targeted smoke test in
# isolation; the sweep validates the rest of the platform under
# normal auth conditions.
if [ -z "${ACCOUNT_LOCKOUT_ENABLED:-}" ]; then
  export ACCOUNT_LOCKOUT_ENABLED=false
  echo ">>> pre-flight: ACCOUNT_LOCKOUT_ENABLED=false for the sweep"
fi

wait_for_throttle() {
  # Spin until the admin login is accepted again.
  echo "  ...waiting for login throttle to clear"
  local n=0
  until curl -s -X POST "$API/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"email":"admin@servifibras.com","password":"admin123"}' \
      | grep -q accessToken; do
    sleep 5; n=$((n+1))
    if [ $n -gt 24 ]; then echo "  ...still throttled after 2 min"; break; fi
  done
}

run_one() {
  local f="$1" log="$LOGDIR/$(basename "$f").log"
  local cmd
  local NP="/home/servifibras/backend/node_modules:/home/servifibras/e2e/node_modules"
  local TSO='{"module":"commonjs","moduleResolution":"node","esModuleInterop":true,"target":"ES2020","skipLibCheck":true,"experimentalDecorators":true,"emitDecoratorMetadata":true}'
  case "$f" in
    *.ts) cmd="NODE_PATH=$NP TS_NODE_COMPILER_OPTIONS='$TSO' npx ts-node --transpile-only --skip-project $f" ;;
    *.js) cmd="NODE_PATH=$NP node $f" ;;
  esac
  echo ">>> $(basename "$f")"
  bash -c "$cmd" >"$log" 2>&1
  local rc=$?
  local last
  last=$(tail -n 5 "$log" | tr -d '\r' | grep -E "passed|failed|=== " | tail -n 1)
  if [ $rc -ne 0 ] && grep -qiE "ThrottlerException|Too Many Requests|429|throttl" "$log"; then
    wait_for_throttle
    echo ">>> retry $(basename "$f")"
    bash -c "$cmd" >"$log" 2>&1
    rc=$?
    last=$(tail -n 5 "$log" | tr -d '\r' | grep -E "passed|failed|=== " | tail -n 1)
  fi
  # Sweep-stress flake retry: under heavy CPU load (this box runs the
  # frontend dev server, the backend, postgres, AND the playwright
  # browser on 2 vCPUs), a UI test occasionally times out waiting for
  # hydration or for a stable element. These pass 100% in isolation;
  # the failure shape is always `TimeoutError` from Playwright with
  # `waiting for element to be visible, enabled and stable` or
  # `page.waitForURL`. Retry once after a short cooldown so the sweep
  # number reflects real regressions, not lab-box pressure.
  if [ $rc -ne 0 ] && grep -qiE "TimeoutError|waiting for element|waitForURL.*Timeout" "$log"; then
    echo "  ...UI flake suspected, cooling down + retrying"
    sleep 4
    echo ">>> retry $(basename "$f")"
    bash -c "$cmd" >"$log" 2>&1
    rc=$?
    last=$(tail -n 5 "$log" | tr -d '\r' | grep -E "passed|failed|=== " | tail -n 1)
  fi
  printf "%s\t%s\t%s\n" "$rc" "$(basename "$f")" "${last:-no-summary-line}" | tee -a "$SUMMARY"
}

# Run TS first (backend/integration), then JS (UI).
shopt -s nullglob
TS_FILES=(test-*-e2e.ts test-*-detector.ts test-*-classifier.ts test-*-llm-e2e.ts test-*-pipeline-e2e.ts test-handoff-detector.ts test-rbac-e2e.ts test-refresh-token-e2e.ts test-rate-limit-e2e.ts test-webhook-signature-e2e.ts test-sentry-monitoring-e2e.ts test-tiendanube-sync-e2e.ts test-health-deep-e2e.ts)
JS_FILES=(test-*-ui-e2e.js test-frontend-refresh-flow-e2e.js test-note-render-e2e.js test-realtime-metrics-e2e.js test-realtime-toast-e2e.js test-tool-calling-catalog-e2e.js test-laminados-cotizador-e2e.js test-laminados-upload-pricelist-e2e.js test-example-channel-scope-e2e.js test-quality-edit-persists-e2e.js test-ml-per-product-permalink-e2e.js test-ml-laminados-publication-context-e2e.js test-manual-correction-anywhere-e2e.js test-ml-discourage-with-alternative-e2e.js test-publication-faq-e2e.js test-ml-batch-queue-e2e.js test-history-compression-e2e.js test-ml-account-split-e2e.js test-logistica-row-detail-e2e.js test-tiendanube-orders-sync-e2e.js test-logistica-3state-bulk-e2e.js test-logistica-item-check-e2e.js test-ventas-unificadas-e2e.js test-ventas-detail-e2e.js test-ml-post-venta-e2e.js test-ml-reclamos-e2e.js test-logistica-notes-e2e.js test-ml-competitors-e2e.js test-logistica-quickwins-e2e.js test-logistica-backlog-e2e.js test-logistica-shipment-states-e2e.js test-logistica-unread-and-filter-e2e.js test-logistica-3tab-courier-e2e.js test-logistica-archive-cancelled-e2e.js test-logistica-retira-caseros-e2e.js test-logistica-manual-dispatch-e2e.js test-logistica-tab-counts-ui-e2e.js test-logistica-archive-confirm-ui-e2e.js test-users-password-autofill-guard-e2e.js)

# De-dup while preserving order
seen=()
ORDERED=()
for f in "${TS_FILES[@]}" "${JS_FILES[@]}"; do
  case " ${seen[*]-} " in *" $f "*) continue;; esac
  seen+=("$f"); ORDERED+=("$f")
done

for f in "${ORDERED[@]}"; do
  [ -f "$f" ] || continue
  run_one "$f"
done

echo
echo "============ SUMMARY ============"
awk -F'\t' '{ if ($1=="0") ok++; else bad++; print $0 } END { print ""; print "ok="ok" bad="bad }' "$SUMMARY"
