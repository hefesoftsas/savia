#!/bin/sh

set -eu

load_environment_file() {
  if [ -f "$1" ]; then
    . "$1"
  fi
}

secrets_directory="${SAVIA_SECRETS_DIR:-infra/secrets}"
load_environment_file "$secrets_directory/auth.dev.env"
load_environment_file "$secrets_directory/assistant-api.dev.env"
load_environment_file "$secrets_directory/mcp.dev.env"
load_environment_file "$secrets_directory/connector-gateway.dev.env"

export SAVIA_MCP_URL="${SAVIA_MCP_URL:-http://127.0.0.1:8789/mcp}"

processes=""

start_process() {
  "$@" &
  processes="$processes $!"
}

stop_processes() {
  trap - EXIT INT TERM
  if [ -n "$processes" ]; then
    kill $processes 2>/dev/null || true
    wait $processes 2>/dev/null || true
  fi
}

wait_for_auth() {
  attempts=0
  while ! curl --fail --silent --max-time 2 \
    http://127.0.0.1:8788/_internal/session >/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 100 ]; then
      printf '%s\n' "Better Auth Worker did not become ready" >&2
      return 1
    fi
    sleep 0.1
  done
}

select_admin_port() {
  if [ -n "${SAVIA_ADMIN_PORT:-}" ]; then
    printf '%s\n' "$SAVIA_ADMIN_PORT"
    return
  fi

  port=5173
  while lsof -nP -sTCP:LISTEN -iTCP:"$port" >/dev/null 2>&1; do
    port=$((port + 1))
  done
  printf '%s\n' "$port"
}

trap stop_processes EXIT INT TERM

admin_port="$(select_admin_port)"
admin_origin="http://127.0.0.1:$admin_port"

CI=1 pnpm --filter @savia/api exec wrangler d1 migrations apply savia-agencies \
  --local --config wrangler.jsonc

set -- pnpm --filter @savia/auth exec wrangler dev --local \
  --ip 127.0.0.1 --port 8788 --inspector-port 9230 \
  --config wrangler.jsonc \
  --var "SAVIA_ADMIN_REDIRECT_URI:$admin_origin/auth/callback"

if [ -n "${BETTER_AUTH_SECRET:-}" ]; then
  set -- "$@" --var "BETTER_AUTH_SECRET:$BETTER_AUTH_SECRET"
fi

start_process "$@"

wait_for_auth

if [ -n "${SAVIA_MCP_SHARED_SECRET:-}" ]; then
  start_process env -i PATH="$PATH" HOME="${HOME:-}" TMPDIR="${TMPDIR:-/tmp}" \
    MCP_TRANSPORT=http MCP_HOST=127.0.0.1 MCP_PORT=8789 \
    SAVIA_API_URL=http://127.0.0.1:8787 \
    SAVIA_MCP_SHARED_SECRET="$SAVIA_MCP_SHARED_SECRET" \
    pnpm --filter @savia/mcp start
fi

pnpm --filter @savia/request run setup:local
CI=1 pnpm --filter @savia/request run migrate:local
start_process pnpm --filter @savia/request exec wrangler dev --local \
  --ip 127.0.0.1 --port 8797 --inspector-port 9232 --config wrangler.jsonc

start_process env "SAVIA_PUBLIC_ORIGIN=$admin_origin" "SAVIA_DISABLE_CAPTCHA=1" "SAVIA_MOCK_QUOTES=${SAVIA_MOCK_QUOTES:-1}" pnpm exec node scripts/dev-api-runtime.mjs
start_process pnpm exec node scripts/crm-sync-local-scheduler.mjs
start_process pnpm --filter @savia/admin exec vite --host "${SAVIA_DEV_HOST:-127.0.0.1}" \
  --port "$admin_port" --strictPort

wait
