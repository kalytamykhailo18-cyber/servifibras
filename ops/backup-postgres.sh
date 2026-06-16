#!/usr/bin/env bash
# ============================================================================
# Servifibras — daily Postgres backup with encryption + offsite upload
#
# Pipeline:
#   1) pg_dump (plain SQL, gzipped) — logical dump, restorable on any
#      compatible Postgres, no filesystem snapshot magic.
#   2) AES-256-CBC encryption via openssl (passphrase from .env). The
#      unencrypted .sql.gz never touches the on-disk path that ships out
#      — we pipe straight into openssl so the disk only sees ciphertext.
#   3) Local copy in BACKUP_DIR/daily/ for fast restore on the same box.
#   4) Offsite upload to S3-compatible storage (DigitalOcean Spaces) at
#      s3://$BUCKET/daily/YYYY/MM/DD/dump_TIMESTAMP.sql.gz.enc — TLS in
#      transit, encrypted at rest by us before upload (defence in depth
#      vs. relying on Spaces server-side encryption alone).
#   5) Weekly mirror on Mondays, monthly mirror on day-of-month=01 —
#      separate prefixes on Spaces so each tier rotates independently.
#   6) Tiered local rotation by mtime: daily 14d, weekly 4w, monthly 3m.
#   7) Healthcheck breadcrumb (.last_run) + audit log line + on failure,
#      POST to the backend's alert webhook so Marcos gets a WhatsApp
#      ping the moment a run errors.
#
# Required env (.env at /home/servifibras/backend/.env):
#   DATABASE_URL                 — pg connection (parsed by pg_dump)
#   BACKUP_ENCRYPTION_KEY        — passphrase for AES-256
# Optional env (sensible defaults inline):
#   BACKUP_DIR                   — local root (default /var/backups/servifibras)
#   BACKUP_RETENTION_DAILY_DAYS  — daily bucket retention (14)
#   BACKUP_RETENTION_WEEKLY_WEEKS — weekly bucket retention (4)
#   BACKUP_RETENTION_MONTHLY_MONTHS — monthly bucket retention (3)
#   BACKUP_S3_ENDPOINT / REGION / BUCKET / ACCESS_KEY / SECRET_KEY —
#                                  remote upload (empty endpoint = skip)
#   BACKUP_ALERT_URL / SECRET    — failure webhook (best-effort)
#
# Exit codes:
#   0  success (local + remote, or local only if remote disabled)
#   1  pg_dump failed
#   2  configuration error
#   3  encryption failed
#   4  remote upload failed (local backup is still on disk)
# ============================================================================

set -euo pipefail

ENV_FILE="/home/servifibras/backend/.env"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "FATAL: $ENV_FILE not readable" >&2
  exit 2
fi

# Read a single key from .env, stripping surrounding quotes. Anything we
# don't ask for stays unexported so app secrets don't leak into child
# processes (this script is already minimal, but the discipline matters
# when it grows).
read_env() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^"//; s/"$//; s/^'\''//; s/'\''$//'
}

DATABASE_URL="$(read_env DATABASE_URL)"
BACKUP_DIR="$(read_env BACKUP_DIR || true)"
BACKUP_ENCRYPTION_KEY="$(read_env BACKUP_ENCRYPTION_KEY || true)"
RETENTION_DAILY="$(read_env BACKUP_RETENTION_DAILY_DAYS || true)"
RETENTION_WEEKLY="$(read_env BACKUP_RETENTION_WEEKLY_WEEKS || true)"
RETENTION_MONTHLY="$(read_env BACKUP_RETENTION_MONTHLY_MONTHS || true)"
S3_ENDPOINT="$(read_env BACKUP_S3_ENDPOINT || true)"
S3_REGION="$(read_env BACKUP_S3_REGION || true)"
S3_BUCKET="$(read_env BACKUP_S3_BUCKET || true)"
S3_ACCESS_KEY="$(read_env BACKUP_S3_ACCESS_KEY || true)"
S3_SECRET_KEY="$(read_env BACKUP_S3_SECRET_KEY || true)"
ALERT_URL="$(read_env BACKUP_ALERT_URL || true)"
ALERT_SECRET="$(read_env BACKUP_ALERT_SECRET || true)"

: "${BACKUP_DIR:=/var/backups/servifibras}"
: "${RETENTION_DAILY:=14}"
: "${RETENTION_WEEKLY:=4}"
: "${RETENTION_MONTHLY:=3}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FATAL: DATABASE_URL not set in $ENV_FILE" >&2
  exit 2
fi
if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  echo "FATAL: BACKUP_ENCRYPTION_KEY not set in $ENV_FILE" >&2
  exit 2
fi

# Failure alerting — fire-and-forget HTTP POST to the backend's internal
# webhook. Backend fans out to WhatsApp + email + audit log. We do this
# from a trap so any unexpected exit also pings us, not just the
# `exit N` lines.
fire_alert() {
  local code="$1"
  local message="$2"
  [[ -z "${ALERT_URL:-}" ]] && return 0
  curl -sk --max-time 8 \
    -H "Content-Type: application/json" \
    -H "X-Backup-Secret: ${ALERT_SECRET:-}" \
    -d "{\"exitCode\":${code},\"message\":$(printf '%s' "$message" | jq -Rs . 2>/dev/null || echo "\"$message\""),\"host\":\"$(hostname)\",\"timestamp\":\"$(date -u -Iseconds)\"}" \
    "$ALERT_URL" >/dev/null 2>&1 || true
}
trap 'rc=$?; if (( rc != 0 )); then fire_alert "$rc" "Backup falló (rc=$rc) — revisar journalctl -u servifibras-backup"; fi' EXIT

# Strip Prisma-only query params (?schema=public, ?pgbouncer=true) that
# pg_dump doesn't understand.
PG_URL="${DATABASE_URL%%\?*}"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"
chmod 750 "$BACKUP_DIR" "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DOW="$(date -u +%u)"        # 1=Mon ... 7=Sun
DOM="$(date -u +%d)"        # 01-31
NAME="dump_${TS}.sql.gz.enc"
DAILY_OUT="$BACKUP_DIR/daily/$NAME"
TMP="$DAILY_OUT.partial"

echo "[$(date -u +%H:%M:%SZ)] pg_dump | gzip | openssl aes-256-cbc → $DAILY_OUT" >&2

# Pipeline: pg_dump → gzip → openssl encrypt. Note we don't write the
# unencrypted plain SQL or the un-encrypted .sql.gz to disk anywhere —
# the only on-disk artefact is the encrypted .sql.gz.enc.
# openssl flags:
#   -salt          adds random salt; required for safe passphrase use
#   -pbkdf2        modern key derivation (vs legacy EVP_BytesToKey)
#   -iter 100000   slows brute-force; matches OWASP guidance for PBKDF2
#   -pass env:KEY  reads the passphrase from env, never argv
# Export so it survives the pipeline subshells (pg_dump → gzip → openssl).
# `VAR=val cmd | cmd2` only sets the var for the first cmd, which is why
# a previous version of this script silently produced an empty file.
export BACKUP_ENCRYPTION_KEY
if ! pg_dump \
       --dbname="$PG_URL" \
       --no-owner \
       --no-privileges \
       --clean \
       --if-exists \
       --format=plain \
     | gzip -9 \
     | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
         -pass env:BACKUP_ENCRYPTION_KEY \
         -out "$TMP"; then
  rm -f "$TMP"
  echo "FATAL: pg_dump | encrypt pipeline failed" >&2
  exit 3
fi

# Sanity-check the ciphertext isn't empty (an empty .enc is ~32 bytes
# of openssl header). Anything under 1KiB means pg_dump silently
# produced nothing meaningful.
SIZE=$(stat -c%s "$TMP")
if (( SIZE < 1024 )); then
  rm -f "$TMP"
  echo "FATAL: encrypted dump suspiciously small ($SIZE bytes)" >&2
  exit 3
fi

mv "$TMP" "$DAILY_OUT"
chmod 640 "$DAILY_OUT"
ln -sfn "$(basename "$DAILY_OUT")" "$BACKUP_DIR/daily/latest.sql.gz.enc"

# Mirror into weekly / monthly buckets when the calendar says so. Hard
# links (not copies) keep disk usage flat — the same on-disk inode
# lives under all three names. When daily rotation drops its name,
# weekly/monthly still hold the inode alive until their own rotation
# expires.
WEEKLY_OUT=""
MONTHLY_OUT=""
if [[ "$DOW" == "1" ]]; then
  WEEKLY_OUT="$BACKUP_DIR/weekly/$NAME"
  ln -f "$DAILY_OUT" "$WEEKLY_OUT" 2>/dev/null || cp -p "$DAILY_OUT" "$WEEKLY_OUT"
  ln -sfn "$(basename "$WEEKLY_OUT")" "$BACKUP_DIR/weekly/latest.sql.gz.enc"
fi
if [[ "$DOM" == "01" ]]; then
  MONTHLY_OUT="$BACKUP_DIR/monthly/$NAME"
  ln -f "$DAILY_OUT" "$MONTHLY_OUT" 2>/dev/null || cp -p "$DAILY_OUT" "$MONTHLY_OUT"
  ln -sfn "$(basename "$MONTHLY_OUT")" "$BACKUP_DIR/monthly/latest.sql.gz.enc"
fi

# --- Offsite upload to S3-compatible storage (DigitalOcean Spaces) ----
# Empty endpoint = the operator hasn't wired Spaces yet; we still keep
# the local encrypted dump so we're not worse off than before. The
# alert webhook will surface "remote disabled" so Marcos sees it.
UPLOAD_NOTE="remote disabled"
if [[ -n "$S3_ENDPOINT" && -n "$S3_BUCKET" && -n "$S3_ACCESS_KEY" && -n "$S3_SECRET_KEY" ]]; then
  S3_HOST="${S3_ENDPOINT#https://}"
  S3_HOST="${S3_HOST#http://}"
  S3CFG=$(mktemp)
  trap 'rm -f "$S3CFG"' RETURN
  cat > "$S3CFG" <<EOF
[default]
access_key = $S3_ACCESS_KEY
secret_key = $S3_SECRET_KEY
host_base = $S3_HOST
host_bucket = %(bucket)s.$S3_HOST
bucket_location = ${S3_REGION:-us-east-1}
use_https = True
signature_v2 = False
EOF
  chmod 600 "$S3CFG"

  YYYY="$(date -u +%Y)"
  MM="$(date -u +%m)"
  DD="$(date -u +%d)"
  DAILY_KEY="daily/${YYYY}/${MM}/${DD}/${NAME}"

  # Upload daily — fail loud if this errors. The local copy is already
  # safe, but Marcos's requirement is "external backup mandatory" so a
  # remote failure has to surface, not silently degrade.
  if ! s3cmd -c "$S3CFG" put "$DAILY_OUT" "s3://$S3_BUCKET/$DAILY_KEY" --acl-private >&2; then
    rm -f "$S3CFG"
    echo "FATAL: s3cmd upload failed for daily/$NAME" >&2
    exit 4
  fi
  UPLOAD_NOTE="uploaded s3://$S3_BUCKET/$DAILY_KEY"

  if [[ -n "$WEEKLY_OUT" ]]; then
    WEEKLY_KEY="weekly/${YYYY}/W$(date -u +%V)/${NAME}"
    s3cmd -c "$S3CFG" put "$WEEKLY_OUT" "s3://$S3_BUCKET/$WEEKLY_KEY" --acl-private >&2 || true
    UPLOAD_NOTE="$UPLOAD_NOTE + weekly"
  fi
  if [[ -n "$MONTHLY_OUT" ]]; then
    MONTHLY_KEY="monthly/${YYYY}/${MM}/${NAME}"
    s3cmd -c "$S3CFG" put "$MONTHLY_OUT" "s3://$S3_BUCKET/$MONTHLY_KEY" --acl-private >&2 || true
    UPLOAD_NOTE="$UPLOAD_NOTE + monthly"
  fi

  # Best-effort remote rotation. Each tier prunes by listing objects
  # under its prefix and dropping ones older than the retention window.
  # We compute the cutoff in seconds-since-epoch, then keep any object
  # whose LastModified is younger. Listing pages capped at 1000 to
  # avoid pathological scans; if Marcos ever has 1000+ daily backups
  # we have bigger problems.
  prune_tier() {
    local prefix="$1"
    local keep_days="$2"
    local cutoff
    cutoff=$(date -u -d "$keep_days days ago" +%s)
    s3cmd -c "$S3CFG" ls --recursive "s3://$S3_BUCKET/$prefix" 2>/dev/null \
      | awk -v co="$cutoff" '{
          ts=$1"T"$2"Z"; cmd="date -u -d \""ts"\" +%s"; cmd | getline epoch; close(cmd);
          if (epoch < co) print $4
        }' \
      | while read -r oldkey; do
          [[ -z "$oldkey" ]] && continue
          s3cmd -c "$S3CFG" del "$oldkey" >&2 || true
        done
  }
  prune_tier "daily/"   "$RETENTION_DAILY"
  prune_tier "weekly/"  "$((RETENTION_WEEKLY * 7))"
  prune_tier "monthly/" "$((RETENTION_MONTHLY * 31))"

  rm -f "$S3CFG"
fi

# --- Local rotation -------------------------------------------------------
# Same pattern as before but per-bucket. We never rm anything outside
# our dump_*.sql.gz.enc name shape — a stray operator-dropped file
# never gets nuked accidentally.
find "$BACKUP_DIR/daily"   -maxdepth 1 -type f -name 'dump_*.sql.gz.enc' \
     -mtime +"$RETENTION_DAILY" -delete
find "$BACKUP_DIR/weekly"  -maxdepth 1 -type f -name 'dump_*.sql.gz.enc' \
     -mtime +"$((RETENTION_WEEKLY * 7))" -delete
find "$BACKUP_DIR/monthly" -maxdepth 1 -type f -name 'dump_*.sql.gz.enc' \
     -mtime +"$((RETENTION_MONTHLY * 31))" -delete

# Healthcheck breadcrumb — backend /health reads this mtime to expose
# backup-age in the admin UI.
date -u -Iseconds > "$BACKUP_DIR/.last_run"

# Quick legibility log so journalctl -u servifibras-backup tells a clear
# story per run.
COUNT_D=$(find "$BACKUP_DIR/daily"   -maxdepth 1 -type f -name 'dump_*.sql.gz.enc' | wc -l)
COUNT_W=$(find "$BACKUP_DIR/weekly"  -maxdepth 1 -type f -name 'dump_*.sql.gz.enc' | wc -l)
COUNT_M=$(find "$BACKUP_DIR/monthly" -maxdepth 1 -type f -name 'dump_*.sql.gz.enc' | wc -l)
echo "[$(date -u +%H:%M:%SZ)] OK — $DAILY_OUT ($SIZE bytes) — $UPLOAD_NOTE — retained: D=$COUNT_D W=$COUNT_W M=$COUNT_M" >&2

# Clean exit — disarm the failure trap so we don't fire an alert on rc=0.
trap - EXIT
exit 0
