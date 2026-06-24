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
env_backup_file=""
env_filtered_file=""

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
  if [ -n "$env_backup_file" ] && [ -f "$env_backup_file" ]; then
    if [ -f .env.local ] && [ -f "$env_filtered_file" ] && cmp -s .env.local "$env_filtered_file"; then
      mv "$env_backup_file" .env.local
    else
      rm -f "$env_backup_file"
      printf '.env.local changed while pnpm dev was running; leaving current file unchanged.\n' >&2
    fi
  fi
  if [ -n "$env_filtered_file" ] && [ -f "$env_filtered_file" ]; then
    rm -f "$env_filtered_file"
  fi
}
trap cleanup EXIT INT TERM

if [ -f .env.local ] && grep -q '^CONVEX_DEPLOY_KEY=' .env.local; then
  env_backup_file="$(mktemp)"
  env_filtered_file="$(mktemp)"
  cp .env.local "$env_backup_file"
  sed -E '/^CONVEX_DEPLOY_KEY=/d' "$env_backup_file" > "$env_filtered_file"
  cp "$env_filtered_file" .env.local
  chmod 600 .env.local
fi

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
  AUTH_BYPASS_ENABLED="$AUTH_BYPASS_ENABLED" env -u CONVEX_DEPLOY_KEY pnpm exec convex dev > "$backend_log_file" 2>&1 &
  backend_pid="$!"
  backend_owned=true
elif lsof -iTCP:"$convex_backend_port" -sTCP:LISTEN -n -P > /dev/null 2>&1; then
  printf 'Reusing existing local Convex backend on port %s.\n' "$convex_backend_port"
else
  backend_log_file="$(mktemp)"
  tail -n +1 -f "$backend_log_file" &
  backend_log_tail_pid="$!"
  AUTH_BYPASS_ENABLED="$AUTH_BYPASS_ENABLED" env -u CONVEX_DEPLOY_KEY pnpm exec convex dev > "$backend_log_file" 2>&1 &
  backend_pid="$!"
  backend_owned=true
fi

wait_for_owned_backend_ready

(
  until
    env -u CONVEX_DEPLOY_KEY pnpm exec convex env set AUTH_BYPASS_ENABLED "$AUTH_BYPASS_ENABLED" \
      && { [ "$AUTH_BYPASS_ENABLED" != "true" ] \
        || env -u CONVEX_DEPLOY_KEY pnpm exec convex env set WORKOS_API_KEY "$WORKOS_API_KEY" \
        && env -u CONVEX_DEPLOY_KEY pnpm exec convex env set WORKOS_CLIENT_ID "$WORKOS_CLIENT_ID" \
        && env -u CONVEX_DEPLOY_KEY pnpm exec convex env set WORKOS_WEBHOOK_SECRET "$WORKOS_WEBHOOK_SECRET"; }
  do
    sleep 1
  done
  until env -u CONVEX_DEPLOY_KEY pnpm exec convex run devAuth:ensurePreviewAuthPersonas; do
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
