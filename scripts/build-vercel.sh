#!/usr/bin/env sh
set -eu

append_if_set() {
  name="$1"
  file="$2"
  value="$(printenv "$name" 2> /dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$name" "$value" >> "$file"
  fi
}

append_convex_deploy_selection_env() {
  file="$1"
  append_if_set CONVEX_DEPLOY_KEY "$file"
  append_if_set CONVEX_DEPLOYMENT "$file"
  append_if_set CONVEX_SELF_HOSTED_URL "$file"
  append_if_set CONVEX_SELF_HOSTED_ADMIN_KEY "$file"
}

append_auth_config_env() {
  file="$1"
  append_if_set WORKOS_CLIENT_ID "$file"
}

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  cp convex/auth.preview.config.ts convex/auth.config.ts

  preview_name="$(printf '%s' "${VERCEL_GIT_COMMIT_REF:-preview}" | tr '/' '-')"
  preview_deployment_ref="preview/$preview_name"
  deploy_env_file="$(mktemp)"
  runtime_env_file="$(mktemp)"
  trap 'rm -f "$deploy_env_file" "$runtime_env_file"' EXIT

  append_convex_deploy_selection_env "$deploy_env_file"
  append_auth_config_env "$deploy_env_file"
  printf 'AUTH_BYPASS_ENABLED=true\nVITE_AUTH_BYPASS_ENABLED=true\nVITE_VERCEL_ENV=preview\n' >> "$deploy_env_file"
  printf 'AUTH_BYPASS_ENABLED=true\nVITE_AUTH_BYPASS_ENABLED=true\nVITE_VERCEL_ENV=preview\n' > "$runtime_env_file"

  pnpm seed:preview
  pnpm exec convex deploy \
    --env-file "$deploy_env_file" \
    --cmd "VITE_AUTH_BYPASS_ENABLED=true VITE_VERCEL_ENV=preview pnpm run build" \
    --preview-create "$preview_name"
  pnpm exec convex env set \
    --deployment "$preview_deployment_ref" \
    --from-file "$runtime_env_file" \
    --force
  pnpm exec convex import \
    --preview-name "$preview_name" \
    --replace-all .cache/seed/preview.zip
  pnpm exec convex run devAuth:ensurePreviewAuthPersonas \
    --deployment "$preview_deployment_ref"
else
  deploy_env_file="$(mktemp)"
  trap 'rm -f "$deploy_env_file"' EXIT

  append_convex_deploy_selection_env "$deploy_env_file"
  append_auth_config_env "$deploy_env_file"
  printf 'AUTH_BYPASS_ENABLED=false\n' >> "$deploy_env_file"

  pnpm exec convex deploy \
    --env-file "$deploy_env_file" \
    --cmd "pnpm run build"
fi
