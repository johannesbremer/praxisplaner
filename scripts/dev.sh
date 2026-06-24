#!/usr/bin/env sh
set -eu

export AUTH_BYPASS_ENABLED="${AUTH_BYPASS_ENABLED:-true}"
if [ "$AUTH_BYPASS_ENABLED" = "true" ]; then
  export WORKOS_API_KEY="${WORKOS_API_KEY:-sk_test_local_preview_placeholder}"
  export WORKOS_CLIENT_ID="${WORKOS_CLIENT_ID:-client_local_preview_placeholder}"
  export WORKOS_WEBHOOK_SECRET="${WORKOS_WEBHOOK_SECRET:-whsec_local_preview_placeholder}"
fi

backend_log_file=""
backend_log_tail_pid=""

reject_convex_deploy_key() {
  if [ -f .env.local ] && grep -q '^CONVEX_DEPLOY_KEY=' .env.local; then
    printf 'Remove CONVEX_DEPLOY_KEY from .env.local before running pnpm dev.\n' >&2
    exit 1
  fi
}

read_local_env_value() {
  if [ ! -f .env.local ]; then
    return 1
  fi

  value="$(sed -n -E "s/^$1=//p" .env.local | tail -n 1)"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"

  if [ -z "$value" ]; then
    return 1
  fi

  printf '%s\n' "$value"
}

cleanup() {
  if [ -n "${frontend_pid:-}" ]; then
    kill "$frontend_pid" 2> /dev/null || true
  fi
  if [ -n "${seed_pid:-}" ]; then
    kill "$seed_pid" 2> /dev/null || true
  fi
  if [ -n "$backend_log_tail_pid" ]; then
    kill "$backend_log_tail_pid" 2> /dev/null || true
  fi
  if [ "${backend_owned:-false}" = "true" ] && [ -n "${backend_pid:-}" ]; then
    kill "$backend_pid" 2> /dev/null || true
  fi
  if [ -n "$backend_log_file" ] && [ -f "$backend_log_file" ]; then
    rm -f "$backend_log_file"
  fi
}
trap cleanup EXIT INT TERM

reject_convex_deploy_key

selected_convex_deployment="$(read_local_env_value CONVEX_DEPLOYMENT || true)"
preview_deployment=false
case "$selected_convex_deployment" in
  preview:*) preview_deployment=true ;;
esac

wait_for_owned_backend_ready() {
  if [ "$backend_owned" != "true" ]; then
    return 0
  fi

  while ! grep -q 'Convex functions ready' "$backend_log_file" 2> /dev/null; do
    if ! kill -0 "$backend_pid" 2> /dev/null; then
      wait "$backend_pid"
      exit "$?"
    fi
    sleep 1
  done
}

convex_backend_port="${CONVEX_LOCAL_BACKEND_PORT:-3210}"
backend_owned=false
backend_pid=""

if [ "$preview_deployment" = "true" ]; then
  printf 'Syncing Convex preview deployment from .env.local.\n'
  backend_log_file="$(mktemp)"
  tail -n +1 -f "$backend_log_file" &
  backend_log_tail_pid="$!"
  AUTH_BYPASS_ENABLED="$AUTH_BYPASS_ENABLED" pnpm exec convex dev > "$backend_log_file" 2>&1 &
  backend_pid="$!"
  backend_owned=true
elif lsof -iTCP:"$convex_backend_port" -sTCP:LISTEN -n -P > /dev/null 2>&1; then
  printf 'Reusing existing local Convex backend on port %s.\n' "$convex_backend_port"
else
  backend_log_file="$(mktemp)"
  tail -n +1 -f "$backend_log_file" &
  backend_log_tail_pid="$!"
  AUTH_BYPASS_ENABLED="$AUTH_BYPASS_ENABLED" pnpm exec convex dev > "$backend_log_file" 2>&1 &
  backend_pid="$!"
  backend_owned=true
fi

wait_for_owned_backend_ready

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
  if [ "$backend_owned" = "true" ] && ! kill -0 "$backend_pid" 2> /dev/null; then
    wait "$backend_pid"
    exit "$?"
  fi
  if ! kill -0 "$frontend_pid" 2> /dev/null; then
    wait "$frontend_pid"
    exit "$?"
  fi
  sleep 1
done
