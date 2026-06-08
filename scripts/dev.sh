#!/usr/bin/env sh
set -eu

export AUTH_BYPASS_ENABLED="${AUTH_BYPASS_ENABLED:-true}"
export VITE_AUTH_BYPASS_ENABLED="${VITE_AUTH_BYPASS_ENABLED:-true}"
export VITE_VERCEL_ENV="${VITE_VERCEL_ENV:-preview}"

WORKOS_ID="${WORKOS_CLIENT_ID:-${VITE_WORKOS_CLIENT_ID:-client_local_preview_placeholder}}"
export WORKOS_CLIENT_ID="${WORKOS_CLIENT_ID:-$WORKOS_ID}"
export VITE_WORKOS_CLIENT_ID="${VITE_WORKOS_CLIENT_ID:-$WORKOS_ID}"

pnpm exec convex env set AUTH_BYPASS_ENABLED "$AUTH_BYPASS_ENABLED"

pnpm exec convex dev \
  --run devAuth:ensurePreviewAuthPersonas \
  --start "pnpm dev:frontend"
