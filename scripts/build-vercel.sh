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
  append_if_set WORKOS_API_KEY "$file"
  append_if_set WORKOS_CLIENT_ID "$file"
  append_if_set WORKOS_WEBHOOK_SECRET "$file"
}

append_vite_auth_config_env() {
  file="$1"
  workos_client_id="$(printenv WORKOS_CLIENT_ID 2> /dev/null || true)"
  if [ -n "$workos_client_id" ]; then
    printf 'VITE_WORKOS_CLIENT_ID=%s\n' "$workos_client_id" >> "$file"
  fi
}

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  preview_name="$(printf '%s' "${VERCEL_GIT_COMMIT_REF:-preview}" | tr '/' '-')"
  preview_deployment_ref="preview/$preview_name"
  deploy_env_file="$(mktemp)"
  runtime_env_file="$(mktemp)"
  trap 'rm -f "$deploy_env_file" "$runtime_env_file"' EXIT

  append_convex_deploy_selection_env "$deploy_env_file"
  append_auth_config_env "$deploy_env_file"
  append_vite_auth_config_env "$deploy_env_file"
  printf 'AUTH_BYPASS_ENABLED=false\nVITE_AUTH_BYPASS_ENABLED=false\nVITE_VERCEL_ENV=preview\n' >> "$deploy_env_file"
  append_auth_config_env "$runtime_env_file"
  append_vite_auth_config_env "$runtime_env_file"
  printf 'AUTH_BYPASS_ENABLED=false\nVITE_AUTH_BYPASS_ENABLED=false\nVITE_VERCEL_ENV=preview\n' >> "$runtime_env_file"
  if [ -n "${WORKOS_CLIENT_ID:-}" ]; then
    export VITE_WORKOS_CLIENT_ID="$WORKOS_CLIENT_ID"
  fi

  pnpm seed:preview
  pnpm exec convex deployment create "$preview_name" --type preview --select \
    || pnpm exec convex deployment select "$preview_deployment_ref"
  pnpm exec convex env set \
    --deployment "$preview_deployment_ref" \
    AUTH_BYPASS_ENABLED false
  AUTH_BYPASS_ENABLED=false pnpm exec convex deploy \
    --env-file "$deploy_env_file" \
    --cmd "VITE_AUTH_BYPASS_ENABLED=false VITE_VERCEL_ENV=preview pnpm run build" \
    --preview-name "$preview_name"
  pnpm exec convex env set \
    --deployment "$preview_deployment_ref" \
    --from-file "$runtime_env_file" \
    --force
  pnpm exec convex import \
    --preview-name "$preview_name" \
    --replace-all \
    --yes .cache/seed/preview.zip
else
  deploy_env_file="$(mktemp)"
  trap 'rm -f "$deploy_env_file"' EXIT

  append_convex_deploy_selection_env "$deploy_env_file"
  append_auth_config_env "$deploy_env_file"
  printf 'AUTH_BYPASS_ENABLED=false\n' >> "$deploy_env_file"

  pnpm exec convex env set AUTH_BYPASS_ENABLED false
  AUTH_BYPASS_ENABLED=false pnpm exec convex deploy \
    --env-file "$deploy_env_file" \
    --cmd "pnpm run build"
fi
