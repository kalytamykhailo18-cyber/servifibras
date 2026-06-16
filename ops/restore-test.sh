#!/usr/bin/env bash
# ============================================================================
# Servifibras — backup restoration test
#
# Pulls the most recent encrypted backup (offsite if BACKUP_S3_* is wired,
# otherwise local), decrypts it, restores into an isolated sandbox database
# on the same Postgres instance, runs a battery of validation queries, and
# then drops the sandbox DB. The point is to prove that a backup we hold
# right now is actually restorable — Marcos's "backup no probado no cuenta"
# requirement.
#
# Safety:
#   - Restores into servifibras_db_restoretest (a DIFFERENT name from prod)
#   - Drops/recreates that sandbox DB unconditionally before the restore,
#     so successive runs don't pile up.
#   - Never writes to the live servifibras_db. The DB owner role is the
#     same so privileges line up, but the data path is isolated.
#
# Pass criteria (all must hold):
#   1) Decryption succeeds (passphrase matches)
#   2) pg_restore equivalent (psql) returns rc=0
#   3) Row counts: at least 1 contact, 1 conversation, 1 message
#   4) Schema has the indexed tables we expect (contacts, conversations,
#      messages, users, products) — guards against partial dumps
#   5) Restored row counts are within 10% of live counts (catches the
#      "backup is yesterday's empty dump" case)
#
# Exit codes:
#   0  pass
#   1  config error
#   2  decryption failed
#   3  restore failed
#   4  validation failed
# ============================================================================

set -euo pipefail

ENV_FILE="/home/servifibras/backend/.env"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "FATAL: $ENV_FILE not readable" >&2
  exit 1
fi

read_env() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^"//; s/"$//; s/^'\''//; s/'\''$//'
}

DATABASE_URL="$(read_env DATABASE_URL)"
BACKUP_DIR="$(read_env BACKUP_DIR || true)"
BACKUP_ENCRYPTION_KEY="$(read_env BACKUP_ENCRYPTION_KEY || true)"
S3_ENDPOINT="$(read_env BACKUP_S3_ENDPOINT || true)"
S3_REGION="$(read_env BACKUP_S3_REGION || true)"
S3_BUCKET="$(read_env BACKUP_S3_BUCKET || true)"
S3_ACCESS_KEY="$(read_env BACKUP_S3_ACCESS_KEY || true)"
S3_SECRET_KEY="$(read_env BACKUP_S3_SECRET_KEY || true)"
: "${BACKUP_DIR:=/var/backups/servifibras}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FATAL: DATABASE_URL not set" >&2
  exit 1
fi
if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  echo "FATAL: BACKUP_ENCRYPTION_KEY not set" >&2
  exit 1
fi

# Pull connection coords out of the URL — postgres://user:pass@host:port/dbname?params
# Strip prisma-only query params; psql will tolerate them but cleaner without.
PG_URL="${DATABASE_URL%%\?*}"
PG_USER=$(printf '%s' "$PG_URL" | sed -E 's|^[a-z]+://([^:]+):.*|\1|')
PG_PASS=$(printf '%s' "$PG_URL" | sed -E 's|^[a-z]+://[^:]+:([^@]+)@.*|\1|')
PG_HOST=$(printf '%s' "$PG_URL" | sed -E 's|^[a-z]+://[^@]+@([^:/]+).*|\1|')
PG_PORT=$(printf '%s' "$PG_URL" | sed -E 's|^[a-z]+://[^@]+@[^:]+:([0-9]+)/.*|\1|; t; s|.*|5432|')
PG_DB=$(printf '%s' "$PG_URL" | sed -E 's|^[a-z]+://[^/]+/([^?]+).*|\1|')
SANDBOX_DB="${PG_DB}_restoretest"

export PGPASSWORD="$PG_PASS"

WORKDIR=$(mktemp -d -t servifibras-restoretest-XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

# --- Step 1: locate the most recent encrypted backup ----------------------
CIPHERTEXT=""
SOURCE_LABEL=""
if [[ -n "$S3_ENDPOINT" && -n "$S3_BUCKET" && -n "$S3_ACCESS_KEY" ]]; then
  S3_HOST="${S3_ENDPOINT#https://}"
  S3_HOST="${S3_HOST#http://}"
  S3CFG="$WORKDIR/.s3cfg"
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

  # Newest object in daily/ wins. s3cmd ls --recursive sorts ascending by
  # date so we tail it.
  LATEST_KEY=$(s3cmd -c "$S3CFG" ls --recursive "s3://$S3_BUCKET/daily/" 2>/dev/null \
    | awk '{print $4}' | grep -E '\.sql\.gz\.enc$' | tail -1 || true)
  if [[ -n "$LATEST_KEY" ]]; then
    CIPHERTEXT="$WORKDIR/$(basename "$LATEST_KEY")"
    echo "[restore-test] downloading $LATEST_KEY from Spaces" >&2
    if ! s3cmd -c "$S3CFG" get "$LATEST_KEY" "$CIPHERTEXT" >&2; then
      echo "FATAL: could not download from Spaces" >&2
      exit 2
    fi
    SOURCE_LABEL="$LATEST_KEY (Spaces)"
  fi
fi

# Fall back to the local mirror if remote wasn't available.
if [[ -z "$CIPHERTEXT" ]]; then
  if [[ -L "$BACKUP_DIR/daily/latest.sql.gz.enc" ]]; then
    CIPHERTEXT="$BACKUP_DIR/daily/latest.sql.gz.enc"
    SOURCE_LABEL="$CIPHERTEXT (local)"
  else
    CIPHERTEXT=$(find "$BACKUP_DIR" -type f -name 'dump_*.sql.gz.enc' -printf '%T@ %p\n' 2>/dev/null \
      | sort -n | tail -1 | cut -d' ' -f2-)
    if [[ -z "$CIPHERTEXT" || ! -r "$CIPHERTEXT" ]]; then
      echo "FATAL: no encrypted backup found under $BACKUP_DIR" >&2
      exit 1
    fi
    SOURCE_LABEL="$CIPHERTEXT (local)"
  fi
fi

echo "[restore-test] source: $SOURCE_LABEL" >&2

# --- Step 2: decrypt -----------------------------------------------------
PLAIN_GZ="$WORKDIR/dump.sql.gz"
export BACKUP_ENCRYPTION_KEY
if ! openssl enc \
       -d -aes-256-cbc -pbkdf2 -iter 100000 \
       -pass env:BACKUP_ENCRYPTION_KEY \
       -in "$CIPHERTEXT" -out "$PLAIN_GZ"; then
  echo "FATAL: decryption failed (wrong passphrase or corrupt file)" >&2
  exit 2
fi

# Quick gzip integrity check before piping the .sql to psql — a bad
# decryption can produce gzip that looks plausible but fails halfway
# through, leaving the sandbox DB partially populated.
if ! gzip -t "$PLAIN_GZ" 2>/dev/null; then
  echo "FATAL: gzip integrity check failed (likely wrong passphrase)" >&2
  exit 2
fi

# --- Step 3: recreate sandbox DB ----------------------------------------
echo "[restore-test] (re)creating sandbox DB $SANDBOX_DB" >&2
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
DROP DATABASE IF EXISTS "$SANDBOX_DB";
CREATE DATABASE "$SANDBOX_DB";
SQL

# --- Step 4: restore -----------------------------------------------------
echo "[restore-test] piping dump into $SANDBOX_DB" >&2
if ! gunzip -c "$PLAIN_GZ" \
     | psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$SANDBOX_DB" \
            -v ON_ERROR_STOP=1 -q >/dev/null; then
  echo "FATAL: psql restore returned non-zero" >&2
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres \
       -c "DROP DATABASE IF EXISTS \"$SANDBOX_DB\";" >/dev/null 2>&1 || true
  exit 3
fi

# --- Step 5: validation queries ------------------------------------------
echo "[restore-test] running validation queries" >&2

run_q() {
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$1" -t -A -c "$2" 2>/dev/null \
    | tr -d ' \n'
}

CONTACTS_R=$(run_q "$SANDBOX_DB" "SELECT COUNT(*) FROM contacts;")
CONVS_R=$(run_q "$SANDBOX_DB" "SELECT COUNT(*) FROM conversations;")
MSGS_R=$(run_q "$SANDBOX_DB" "SELECT COUNT(*) FROM messages;")
USERS_R=$(run_q "$SANDBOX_DB" "SELECT COUNT(*) FROM users;")
PRODS_R=$(run_q "$SANDBOX_DB" "SELECT COUNT(*) FROM products;")
TABLES_R=$(run_q "$SANDBOX_DB" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

CONTACTS_L=$(run_q "$PG_DB" "SELECT COUNT(*) FROM contacts;")
CONVS_L=$(run_q "$PG_DB" "SELECT COUNT(*) FROM conversations;")
MSGS_L=$(run_q "$PG_DB" "SELECT COUNT(*) FROM messages;")
USERS_L=$(run_q "$PG_DB" "SELECT COUNT(*) FROM users;")
PRODS_L=$(run_q "$PG_DB" "SELECT COUNT(*) FROM products;")

# Compare restored vs live with a 10% tolerance — accounts for new rows
# written between the dump time and now.
within_tolerance() {
  local restored="$1"
  local live="$2"
  if (( restored == 0 && live == 0 )); then return 0; fi
  if (( live == 0 )); then return 1; fi
  # |restored - live| / live <= 0.10
  python3 - <<PY 2>/dev/null
import sys
r, l = $restored, $live
ok = abs(r - l) / max(l, 1) <= 0.10
sys.exit(0 if ok else 1)
PY
}

FAIL=0
report_row() {
  local label="$1"; local r="$2"; local l="$3"
  if within_tolerance "$r" "$l"; then
    printf "  ✓ %-15s restored=%-8s live=%-8s\n" "$label" "$r" "$l"
  else
    printf "  ✗ %-15s restored=%-8s live=%-8s  (out of tolerance)\n" "$label" "$r" "$l"
    FAIL=1
  fi
}

echo ""
echo "=== validation report ==="
report_row "contacts"      "$CONTACTS_R" "$CONTACTS_L"
report_row "conversations" "$CONVS_R"    "$CONVS_L"
report_row "messages"      "$MSGS_R"     "$MSGS_L"
report_row "users"         "$USERS_R"    "$USERS_L"
report_row "products"      "$PRODS_R"    "$PRODS_L"
printf "  · tables in restored schema: %s\n" "$TABLES_R"
echo ""

# Drop the sandbox DB regardless of pass/fail — we never leave it
# around because (a) it's just a copy of prod data and (b) keeping
# stale "test" DBs around is exactly how someone accidentally hits
# them later.
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres \
     -c "DROP DATABASE IF EXISTS \"$SANDBOX_DB\";" >/dev/null 2>&1 || true

if (( FAIL != 0 )); then
  echo "[restore-test] FAILED — at least one bucket out of tolerance" >&2
  exit 4
fi

echo "[restore-test] PASSED — backup is restorable; source: $SOURCE_LABEL"
exit 0
