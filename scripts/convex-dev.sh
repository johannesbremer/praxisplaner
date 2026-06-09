#!/usr/bin/env sh
set -eu

export AUTH_BYPASS_ENABLED="${AUTH_BYPASS_ENABLED:-true}"
if [ "$AUTH_BYPASS_ENABLED" = "true" ]; then
  export WORKOS_API_KEY="${WORKOS_API_KEY:-sk_test_local_preview_placeholder}"
  export WORKOS_CLIENT_ID="${WORKOS_CLIENT_ID:-client_local_preview_placeholder}"
  export WORKOS_WEBHOOK_SECRET="${WORKOS_WEBHOOK_SECRET:-whsec_local_preview_placeholder}"
fi

cleanup() {
  if [ -n "${seed_pid:-}" ]; then
    kill "$seed_pid" 2> /dev/null || true
  fi
  if [ "${backend_owned:-false}" = "true" ] && [ -n "${backend_pid:-}" ]; then
    kill "$backend_pid" 2> /dev/null || true
  fi
}
trap cleanup EXIT INT TERM

convex_backend_port="${CONVEX_LOCAL_BACKEND_PORT:-3210}"
backend_owned=false
backend_pid=""

if lsof -iTCP:"$convex_backend_port" -sTCP:LISTEN -n -P > /dev/null 2>&1; then
  printf 'Reusing existing local Convex backend on port %s.\n' "$convex_backend_port"
else
  AUTH_BYPASS_ENABLED="$AUTH_BYPASS_ENABLED" pnpm exec convex dev &
  backend_pid="$!"
  backend_owned=true
fi

(
  until
    pnpm exec convex env set AUTH_BYPASS_ENABLED "$AUTH_BYPASS_ENABLED" \
      && { [ "$AUTH_BYPASS_ENABLED" != "true" ] \
        || pnpm exec convex env set WORKOS_API_KEY "$WORKOS_API_KEY" \
        && pnpm exec convex env set WORKOS_CLIENT_ID "$WORKOS_CLIENT_ID" \
        && pnpm exec convex env set WORKOS_WEBHOOK_SECRET "$WORKOS_WEBHOOK_SECRET"; }
  do
    sleep 1
  done
  until pnpm exec convex run devAuth:ensurePreviewAuthPersonas; do
    sleep 1
  done
) &
seed_pid="$!"

if [ "$backend_owned" = "true" ]; then
  wait "$backend_pid"
else
  while lsof -iTCP:"$convex_backend_port" -sTCP:LISTEN -n -P > /dev/null 2>&1; do
    sleep 1
  done
fi
