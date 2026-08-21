#!/usr/bin/env bash
# Offline replay of real customer conversations through the AI.
# Reads sample size / lookback from .env (REPLAY_* keys); no outbound
# message is sent, no conversation row is written. See src/scripts/
# replay-real-inbox.ts for the full protocol.
set -euo pipefail

cd /home/servifibras/backend
set -a
. ./.env
set +a

# Isolation: prevent the harness process from touching the live prod
# backend's external connections. Booting AppModule spawns Baileys
# which, if allowed, opens a second WA socket and kicks the production
# session off (code 440 "conflict, replaced"). Overriding here keeps
# the harness self-contained: DB reads, Claude API calls, tool
# execution — no WA connect, no cron scheduling.
export WHATSAPP_QR_ENABLED=false

npx ts-node --transpile-only src/scripts/replay-real-inbox.ts "$@"
