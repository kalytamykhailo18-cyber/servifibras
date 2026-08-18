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

npx ts-node --transpile-only src/scripts/replay-real-inbox.ts "$@"
