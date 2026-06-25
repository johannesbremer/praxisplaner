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

require_env() {
  name="$1"
  value="$(printenv "$name" 2> /dev/null || true)"
  if [ -z "$value" ]; then
    printf 'Missing required environment variable: %s\n' "$name" >&2
    exit 1
  fi
}

append_convex_deploy_selection_env() {
  file="$1"
  append_if_set CONVEX_DEPLOY_KEY "$file"
  append_if_set CONVEX_DEPLOYMENT "$file"
  append_if_set CONVEX_SELF_HOSTED_URL "$file"
  append_if_set CONVEX_SELF_HOSTED_ADMIN_KEY "$file"
}

get_workos_client_id() {
  workos_client_id="$(printenv WORKOS_CLIENT_ID 2> /dev/null || true)"
  if [ -z "$workos_client_id" ]; then
    workos_client_id="$(printenv VITE_WORKOS_CLIENT_ID 2> /dev/null || true)"
  fi
  printf '%s' "$workos_client_id"
}

append_auth_config_env() {
  file="$1"
  append_if_set WORKOS_API_KEY "$file"
  workos_client_id="$(get_workos_client_id)"
  if [ -n "$workos_client_id" ]; then
    printf 'WORKOS_CLIENT_ID=%s\n' "$workos_client_id" >> "$file"
  fi
  append_if_set WORKOS_WEBHOOK_SECRET "$file"
}

append_vite_auth_config_env() {
  file="$1"
  workos_client_id="$(get_workos_client_id)"
  if [ -n "$workos_client_id" ]; then
    printf 'VITE_WORKOS_CLIENT_ID=%s\n' "$workos_client_id" >> "$file"
  fi
}

export_vite_auth_config_env() {
  workos_client_id="$(get_workos_client_id)"
  if [ -n "$workos_client_id" ]; then
    export VITE_WORKOS_CLIENT_ID="$workos_client_id"
  fi
}

require_real_auth_env() {
  require_env WORKOS_API_KEY
  workos_client_id="$(get_workos_client_id)"
  if [ -z "$workos_client_id" ]; then
    printf 'Missing required environment variable: WORKOS_CLIENT_ID or VITE_WORKOS_CLIENT_ID\n' >&2
    exit 1
  fi
}

append_preview_auth_bypass_env() {
  file="$1"
  printf 'WORKOS_CLIENT_ID=client_local_preview_placeholder\n' >> "$file"
  printf 'WORKOS_API_KEY=sk_test_local_preview_placeholder\n' >> "$file"
  printf 'WORKOS_WEBHOOK_SECRET=whsec_local_preview_placeholder\n' >> "$file"
  printf 'AUTH_BYPASS_ENABLED=true\n' >> "$file"
  printf 'VITE_AUTH_BYPASS_ENABLED=true\n' >> "$file"
  printf 'VITE_VERCEL_ENV=preview\n' >> "$file"
}

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  preview_name="$(printf '%s' "${VERCEL_GIT_COMMIT_REF:-preview}" | tr '/' '-')"
  preview_deployment_ref="preview/$preview_name"
  deploy_env_file="$(mktemp)"
  runtime_env_file="$(mktemp)"
  trap 'rm -f "$deploy_env_file" "$runtime_env_file"' EXIT

  append_convex_deploy_selection_env "$deploy_env_file"
  append_vite_auth_config_env "$deploy_env_file"
  append_preview_auth_bypass_env "$deploy_env_file"
  append_vite_auth_config_env "$runtime_env_file"
  append_preview_auth_bypass_env "$runtime_env_file"
  export_vite_auth_config_env

  pnpm seed:preview
  AUTH_BYPASS_ENABLED=true pnpm exec convex deploy \
    --env-file "$deploy_env_file" \
    --cmd "VITE_AUTH_BYPASS_ENABLED=true VITE_VERCEL_ENV=preview pnpm run build" \
    --preview-name "$preview_name"
  pnpm exec convex env set \
    --deployment "$preview_deployment_ref" \
    --from-file "$runtime_env_file" \
    --force
  pnpm exec convex import \
    --preview-name "$preview_name" \
    --replace-all \
    --yes .cache/seed/preview.zip
  pnpm exec convex run devAuth:ensurePreviewAuthPersonas \
    --deployment "$preview_deployment_ref"
else
  if [ "${AUTH_BYPASS_ENABLED:-}" = "true" ]; then
    printf 'AUTH_BYPASS_ENABLED=true is only allowed for Vercel preview builds.\n' >&2
    exit 1
  fi

  require_real_auth_env

  deploy_env_file="$(mktemp)"
  trap 'rm -f "$deploy_env_file"' EXIT

  append_convex_deploy_selection_env "$deploy_env_file"
  append_auth_config_env "$deploy_env_file"
  append_vite_auth_config_env "$deploy_env_file"
  printf 'AUTH_BYPASS_ENABLED=false\n' >> "$deploy_env_file"
  export_vite_auth_config_env

  pnpm exec convex env set AUTH_BYPASS_ENABLED false
  AUTH_BYPASS_ENABLED=false pnpm exec convex deploy \
    --env-file "$deploy_env_file" \
    --cmd "pnpm run build"
fi
