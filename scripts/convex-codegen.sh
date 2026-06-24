#!/usr/bin/env sh
set -eu

env_file=".env.local"
backup_file=""
filtered_file=""

restore_env_file() {
  if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
    return 0
  fi

  if [ -f "$env_file" ] && [ -f "$filtered_file" ] && cmp -s "$env_file" "$filtered_file"; then
    mv "$backup_file" "$env_file"
  else
    rm -f "$backup_file"
    printf '.env.local changed during codegen; leaving current file unchanged.\n' >&2
  fi
  rm -f "$filtered_file"
}

trap restore_env_file EXIT HUP INT TERM

if [ -f "$env_file" ] \
  && grep -q '^CONVEX_DEPLOY_KEY=' "$env_file" \
  && ! grep -q '^CONVEX_DEPLOYMENT=' "$env_file" \
  && [ -z "${CONVEX_DEPLOYMENT:-}" ]; then
  cat >&2 << 'EOF'
CONVEX_DEPLOY_KEY is only for Codex setup.

Run setup first so .env.local contains CONVEX_DEPLOYMENT before running pnpm gen.
EOF
  exit 1
fi

if [ -f "$env_file" ] && grep -q '^CONVEX_DEPLOY_KEY=' "$env_file"; then
  backup_file="$(mktemp)"
  filtered_file="$(mktemp)"
  cp "$env_file" "$backup_file"
  sed -E '/^CONVEX_DEPLOY_KEY=/d' "$backup_file" > "$filtered_file"
  cp "$filtered_file" "$env_file"
  chmod 600 "$env_file"
fi

env -u CONVEX_DEPLOY_KEY pnpm exec convex codegen
