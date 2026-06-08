#!/usr/bin/env sh
set -eu

export AUTH_BYPASS_ENABLED="${AUTH_BYPASS_ENABLED:-true}"
export VITE_AUTH_BYPASS_ENABLED="${VITE_AUTH_BYPASS_ENABLED:-true}"
export VITE_VERCEL_ENV="${VITE_VERCEL_ENV:-preview}"

WORKOS_ID="${WORKOS_CLIENT_ID:-${VITE_WORKOS_CLIENT_ID:-client_local_preview_placeholder}}"
export WORKOS_CLIENT_ID="${WORKOS_CLIENT_ID:-$WORKOS_ID}"
export VITE_WORKOS_CLIENT_ID="${VITE_WORKOS_CLIENT_ID:-$WORKOS_ID}"

pnpm exec convex env set AUTH_BYPASS_ENABLED "$AUTH_BYPASS_ENABLED"

cleanup() {
  if [ -n "${frontend_pid:-}" ]; then
    kill "$frontend_pid" 2> /dev/null || true
  fi
  if [ -n "${backend_pid:-}" ]; then
    kill "$backend_pid" 2> /dev/null || true
  fi
}
trap cleanup EXIT INT TERM

pnpm exec convex dev --run devAuth:ensurePreviewAuthPersonas &
backend_pid="$!"

pnpm dev:frontend &
frontend_pid="$!"

wait "$frontend_pid"
