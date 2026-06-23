#!/usr/bin/env sh
set -eu

env_file=".env.local"
backup_file=""
filtered_file=""

restore_env_file() {
  if [ -n "$backup_file" ] && [ -f "$backup_file" ]; then
    mv "$backup_file" "$env_file"
  fi
  if [ -n "$filtered_file" ] && [ -f "$filtered_file" ]; then
    rm -f "$filtered_file"
  fi
}

trap restore_env_file EXIT HUP INT TERM

if [ -f "$env_file" ] && grep -q '^CONVEX_DEPLOY_KEY=' "$env_file"; then
  backup_file="$(mktemp)"
  filtered_file="$(mktemp)"
  cp "$env_file" "$backup_file"
  sed -E '/^CONVEX_DEPLOY_KEY=/d' "$backup_file" > "$filtered_file"
  mv "$filtered_file" "$env_file"
  chmod 600 "$env_file"
fi

env -u CONVEX_DEPLOY_KEY pnpm exec convex codegen
