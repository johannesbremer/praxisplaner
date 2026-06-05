#!/usr/bin/env sh
set -eu

auth_config_backup="$(mktemp)"
cp convex/auth.config.ts "$auth_config_backup"
restore_auth_config() {
  cp "$auth_config_backup" convex/auth.config.ts
  rm -f "$auth_config_backup"
}
trap restore_auth_config EXIT INT TERM

cp convex/auth.preview.config.ts convex/auth.config.ts
pnpm exec convex dev
