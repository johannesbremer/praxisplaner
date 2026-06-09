#!/usr/bin/env sh
set -eu

export AUTH_BYPASS_ENABLED="${AUTH_BYPASS_ENABLED:-true}"
if [ "$AUTH_BYPASS_ENABLED" = "true" ]; then
  export WORKOS_API_KEY="${WORKOS_API_KEY:-sk_test_local_preview_placeholder}"
  export WORKOS_CLIENT_ID="${WORKOS_CLIENT_ID:-client_local_preview_placeholder}"
  export WORKOS_WEBHOOK_SECRET="${WORKOS_WEBHOOK_SECRET:-whsec_local_preview_placeholder}"
fi

cleanup() {
  if [ -n "${frontend_pid:-}" ]; then
    kill "$frontend_pid" 2> /dev/null || true
  fi
  if [ -n "${seed_pid:-}" ]; then
    kill "$seed_pid" 2> /dev/null || true
  fi
  if [ -n "${backend_pid:-}" ]; then
    kill "$backend_pid" 2> /dev/null || true
  fi
}
trap cleanup EXIT INT TERM

AUTH_BYPASS_ENABLED="$AUTH_BYPASS_ENABLED" pnpm exec convex dev &
backend_pid="$!"

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

pnpm dev:frontend &
frontend_pid="$!"

while :; do
  if ! kill -0 "$backend_pid" 2> /dev/null; then
    wait "$backend_pid"
    exit "$?"
  fi
  if ! kill -0 "$frontend_pid" 2> /dev/null; then
    wait "$frontend_pid"
    exit "$?"
  fi
  sleep 1
done
