#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
JarvisHub one-click dev launcher.

Local (recommended for fastest HMR):
  ./scripts/dev.sh local [--install] [--webcut] [--no-object-storage]

Docker Compose (HMR via bind mount; slower, but closer to prod):
  ./scripts/dev.sh docker [--build]

Examples:
  ./scripts/dev.sh local --install
  ./scripts/dev.sh local --webcut
  ./scripts/dev.sh local --no-object-storage
  ./scripts/dev.sh docker
  ./scripts/dev.sh docker --build
EOF
}

has_env_key() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$file"
}

read_env_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  local line=""
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | head -n 1 || true)"
  [ -n "$line" ] || return 1
  local value="${line#*=}"
  value="${value%$'\r'}"
  # Trim surrounding quotes if present.
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf "%s" "$value"
  return 0
}

detect_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

compose() {
  local flavor=""
  flavor="$(detect_compose || true)"
  if [ "$flavor" = "docker" ]; then
    docker compose "$@"
    return $?
  fi
  if [ "$flavor" = "docker-compose" ]; then
    docker-compose "$@"
    return $?
  fi
  echo "[dev.sh] docker compose not available (neither 'docker compose' nor 'docker-compose')" >&2
  return 1
}


LOG_DIR="${JARVISHUB_DEV_LOG_DIR:-/tmp/jarvishub-services/logs}"

ensure_log_dir() {
  mkdir -p "$LOG_DIR"
}

has_ppt_master_scripts() {
  local skill_dir="${1%/}"
  [ -f "$skill_dir/SKILL.md" ] &&
    [ -f "$skill_dir/scripts/project_manager.py" ] &&
    [ -f "$skill_dir/scripts/svg_to_pptx.py" ]
}

ensure_ppt_master_home() {
  # If user already set PPT_MASTER_HOME (or PPT_MASTER_SKILL_DIR), respect it.
  if [ -n "${PPT_MASTER_HOME:-}" ] && has_ppt_master_scripts "${PPT_MASTER_HOME%/}"; then
    return 0
  fi
  if [ -n "${PPT_MASTER_SKILL_DIR:-}" ] && has_ppt_master_scripts "${PPT_MASTER_SKILL_DIR%/}"; then
    export PPT_MASTER_HOME="${PPT_MASTER_SKILL_DIR}"
    return 0
  fi

  local vendor_dir="$PWD/vendor/ppt-master"
  local skill_dir="$vendor_dir/skills/ppt-master"

  if ! has_ppt_master_scripts "$skill_dir"; then
    echo "[dev.sh] Bundled PPT Master runtime is incomplete: $skill_dir" >&2
    echo "[dev.sh] Re-download the repository, or set PPT_MASTER_HOME to a complete skill directory." >&2
    return 1
  fi
  export PPT_MASTER_HOME="$skill_dir"
  return 0
}

ensure_ppt_projects_root() {
  local root
  root="$(read_env_value "apps/hono-api/.env" "PPT_MASTER_PROJECTS_ROOT" || true)"
  if [ -z "$root" ]; then
    root="${PPT_MASTER_PROJECTS_ROOT:-$PWD/var/ppt-master-projects}"
  fi
  mkdir -p "$root"
  export PPT_MASTER_PROJECTS_ROOT="$root"
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

env_value_from_shell_or_files() {
  local key="$1"
  local value="${!key:-}"
  if [ -n "$value" ]; then
    printf "%s" "$value"
    return 0
  fi
  value="$(read_env_value "apps/hono-api/.env" "$key" || true)"
  if [ -n "$value" ]; then
    printf "%s" "$value"
    return 0
  fi
  value="$(read_env_value "apps/hono-api/.dev.vars" "$key" || true)"
  if [ -n "$value" ]; then
    printf "%s" "$value"
    return 0
  fi
  return 1
}

configured_object_storage_present() {
  local access="" secret="" endpoint="" bucket=""
  access="$(env_value_from_shell_or_files "R2_ACCESS_KEY_ID" || true)"
  [ -n "$access" ] || access="$(env_value_from_shell_or_files "RUSTFS_ACCESS_KEY_ID" || true)"
  secret="$(env_value_from_shell_or_files "R2_SECRET_ACCESS_KEY" || true)"
  [ -n "$secret" ] || secret="$(env_value_from_shell_or_files "RUSTFS_SECRET_ACCESS_KEY" || true)"
  endpoint="$(env_value_from_shell_or_files "R2_BUCKET_URL" || true)"
  [ -n "$endpoint" ] || endpoint="$(env_value_from_shell_or_files "R2_ENDPOINT_URL" || true)"
  [ -n "$endpoint" ] || endpoint="$(env_value_from_shell_or_files "RUSTFS_ENDPOINT_URL" || true)"
  bucket="$(env_value_from_shell_or_files "R2_BUCKET" || true)"
  [ -n "$bucket" ] || bucket="$(env_value_from_shell_or_files "RUSTFS_BUCKET" || true)"

  if [ -n "$access" ] && [ -n "$secret" ] && [ -n "$endpoint" ]; then
    # R2_BUCKET_URL can encode the bucket in the URL path, so explicit bucket is optional there.
    if [ -n "$bucket" ] || [ -n "$(env_value_from_shell_or_files "R2_BUCKET_URL" || true)" ]; then
      return 0
    fi
  fi
  return 1
}

wait_for_http_ready() {
  local url="$1"
  local label="$2"
  local i=0
  while [ "$i" -lt 60 ]; do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "$url" >/dev/null 2>&1; then
        return 0
      fi
    else
      # Fall back to a conservative wait when curl is unavailable.
      sleep 5
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "[dev.sh] Warning: timed out waiting for $label at $url" >&2
  return 1
}

ensure_local_object_storage() {
  if [ "${JARVISHUB_LOCAL_OBJECT_STORAGE:-1}" = "0" ]; then
    echo "[dev.sh] Local object storage disabled by JARVISHUB_LOCAL_OBJECT_STORAGE=0." >&2
    return 0
  fi

  if configured_object_storage_present; then
    echo "[dev.sh] Object storage env already configured; not starting local MinIO." >&2
    return 0
  fi

  local data_dir="${JARVISHUB_MINIO_DATA_DIR:-/tmp/jarvishub-services/minio-data}"
  local access_key="${JARVISHUB_MINIO_ROOT_USER:-jarvishub}"
  local secret_key="${JARVISHUB_MINIO_ROOT_PASSWORD:-jarvishub-local-secret}"
  local bucket="${JARVISHUB_MINIO_BUCKET:-jarvishub-assets}"
  local endpoint="${JARVISHUB_MINIO_ENDPOINT:-http://127.0.0.1:9000}"

  mkdir -p "$data_dir"

  if ! command -v minio >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      if [ "${JARVISHUB_AUTO_INSTALL_MINIO:-1}" = "1" ]; then
        echo "[dev.sh] MinIO is not installed; installing with Homebrew..." >&2
        brew install minio
      else
        echo "[dev.sh] Warning: MinIO is not installed. Run 'brew install minio' or set R2/RustFS env manually." >&2
        return 0
      fi
    else
      echo "[dev.sh] Warning: MinIO is not installed and Homebrew is unavailable; generated images will keep vendor URLs unless R2/RustFS env is configured." >&2
      return 0
    fi
  fi

  if port_in_use 9000; then
    echo "[dev.sh] Port 9000 already in use; assuming an S3-compatible service is available at $endpoint." >&2
  else
    (
      export MINIO_ROOT_USER="$access_key"
      export MINIO_ROOT_PASSWORD="$secret_key"
      exec minio server "$data_dir" --address ":9000" --console-address ":9001"
    ) > "$LOG_DIR/minio.log" 2>&1 &
    pids+=("$!")
    echo "[dev.sh] MinIO on $endpoint (console: http://localhost:9001, data: $data_dir, logs: $LOG_DIR/minio.log)" >&2
  fi

  wait_for_http_ready "$endpoint/minio/health/ready" "MinIO" || true

  (
    cd apps/hono-api
    RUSTFS_ACCESS_KEY_ID="$access_key" \
    RUSTFS_SECRET_ACCESS_KEY="$secret_key" \
    RUSTFS_ENDPOINT_URL="$endpoint" \
    RUSTFS_BUCKET="$bucket" \
    RUSTFS_REGION="${RUSTFS_REGION:-us-east-1}" \
    node <<'NODE'
const { CreateBucketCommand, HeadBucketCommand, S3Client } = require("@aws-sdk/client-s3");
const endpoint = process.env.RUSTFS_ENDPOINT_URL;
const bucket = process.env.RUSTFS_BUCKET;
const client = new S3Client({
  region: process.env.RUSTFS_REGION || "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.RUSTFS_ACCESS_KEY_ID,
    secretAccessKey: process.env.RUSTFS_SECRET_ACCESS_KEY,
  },
});
(async () => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
  )
  echo "[dev.sh] MinIO bucket ready: $bucket" >&2

  export RUSTFS_ACCESS_KEY_ID="$access_key"
  export RUSTFS_SECRET_ACCESS_KEY="$secret_key"
  export RUSTFS_ENDPOINT_URL="$endpoint"
  export RUSTFS_BUCKET="$bucket"
  export RUSTFS_REGION="${RUSTFS_REGION:-us-east-1}"
  # Use the API proxy as the public URL, so the MinIO bucket can stay private.
  export RUSTFS_PUBLIC_BASE_URL="${RUSTFS_PUBLIC_BASE_URL:-http://localhost:8788/assets/r2}"
}

cmd="${1:-local}"
shift || true

case "$cmd" in
  -h|--help|help)
    usage
    exit 0
    ;;
  local)
    install=0
    start_webcut=0
    start_object_storage=1
    while [ $# -gt 0 ]; do
      case "$1" in
        --install) install=1 ;;
        --webcut) start_webcut=1 ;;
        --no-object-storage) start_object_storage=0 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    if [ "$install" = "1" ]; then
      pnpm -w install
    fi

    inferred_web_github_client_id=""
    if [ -z "${VITE_GITHUB_CLIENT_ID:-}" ]; then
      if ! has_env_key "apps/web/.env" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.local" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.development" "VITE_GITHUB_CLIENT_ID" \
        && ! has_env_key "apps/web/.env.development.local" "VITE_GITHUB_CLIENT_ID"; then
        inferred_web_github_client_id="$(read_env_value "apps/hono-api/.env" "GITHUB_CLIENT_ID" || true)"
        if [ -z "$inferred_web_github_client_id" ]; then
          inferred_web_github_client_id="$(read_env_value "apps/hono-api/.dev.vars" "GITHUB_CLIENT_ID" || true)"
        fi
        if [ -z "$inferred_web_github_client_id" ]; then
          echo "[dev.sh] Note: GitHub login is disabled unless you set VITE_GITHUB_CLIENT_ID in apps/web/.env(.local)." >&2
        else
          echo "[dev.sh] Using apps/hono-api (.env/.dev.vars) GITHUB_CLIENT_ID as VITE_GITHUB_CLIENT_ID for web dev." >&2
        fi
      fi
    fi

    pids=()
    cleanup() {
      for pid in "${pids[@]:-}"; do
        kill "$pid" 2>/dev/null || true
      done
      wait 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    ensure_log_dir
    ensure_ppt_projects_root
    ensure_ppt_master_home || true
    if [ "$start_object_storage" = "1" ]; then
      ensure_local_object_storage
    else
      echo "[dev.sh] Local object storage disabled by --no-object-storage." >&2
    fi

    # 1) agents-cli HTTP bridge on 127.0.0.1:8799 (required by hono-api for canvas tools).
    if port_in_use 8799; then
      echo "[dev.sh] Port 8799 already in use; assuming agents-cli is already running." >&2
    else
      (
        cd apps/agents-cli
        exec pnpm dev serve --host 127.0.0.1 --port 8799
      ) > "$LOG_DIR/agents.log" 2>&1 &
      pids+=("$!")
      echo "[dev.sh] agents-cli on http://127.0.0.1:8799 (logs: $LOG_DIR/agents.log)" >&2
    fi

    # 2) hono-api on :8788. Inherit PPT_MASTER_HOME / PPT_MASTER_PROJECTS_ROOT exported above.
    if port_in_use 8788; then
      echo "[dev.sh] Port 8788 already in use; skipping hono-api start." >&2
    else
      (cd apps/hono-api && pnpm dev) > "$LOG_DIR/api.log" 2>&1 &
      pids+=("$!")
      echo "[dev.sh] hono-api on http://localhost:8788 (logs: $LOG_DIR/api.log)" >&2
    fi

    if [ "$start_webcut" = "1" ]; then
      if [ -f "apps/webcut-main/package.json" ]; then
        (cd apps/webcut-main && pnpm dev:app --host 0.0.0.0 --port 5174) &
        pids+=("$!")
        echo "[dev.sh] webcut app on http://localhost:5174" >&2
      else
        echo "[dev.sh] Skip webcut: apps/webcut-main/package.json not found" >&2
      fi
    fi

    if port_in_use 8888; then
      echo "[dev.sh] Port 8888 already in use; skipping web start." >&2
    else
      (
        cd apps/web
        if [ -n "${VITE_GITHUB_CLIENT_ID:-}" ]; then
          exec pnpm dev
        elif [ -n "$inferred_web_github_client_id" ]; then
          exec env VITE_GITHUB_CLIENT_ID="$inferred_web_github_client_id" pnpm dev
        else
          exec pnpm dev
        fi
      ) > "$LOG_DIR/web.log" 2>&1 &
      pids+=("$!")
      echo "[dev.sh] web on http://localhost:8888 (logs: $LOG_DIR/web.log)" >&2
    fi

    echo "" >&2
    echo "[dev.sh] All services launching. Tail logs with:" >&2
    echo "  tail -f $LOG_DIR/agents.log $LOG_DIR/api.log $LOG_DIR/web.log" >&2
    echo "[dev.sh] URLs:" >&2
    echo "  web:    http://localhost:8888" >&2
    echo "  api:    http://localhost:8788" >&2
    echo "  agents: http://127.0.0.1:8799" >&2
    if [ -n "${PPT_MASTER_HOME:-}" ]; then
      echo "[dev.sh] PPT_MASTER_HOME=$PPT_MASTER_HOME" >&2
    fi
    if [ -n "${PPT_MASTER_PROJECTS_ROOT:-}" ]; then
      echo "[dev.sh] PPT_MASTER_PROJECTS_ROOT=$PPT_MASTER_PROJECTS_ROOT" >&2
    fi
    if [ -n "${RUSTFS_ENDPOINT_URL:-}" ] && [ -n "${RUSTFS_BUCKET:-}" ]; then
      echo "[dev.sh] object storage: $RUSTFS_ENDPOINT_URL bucket=$RUSTFS_BUCKET public=$RUSTFS_PUBLIC_BASE_URL" >&2
      echo "[dev.sh] MinIO console: http://localhost:9001" >&2
    fi

    wait
    ;;
  docker)
    build=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --build) build=1 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
      shift
    done

    args=(up)
    args+=(-d)
    if [ "$build" = "1" ]; then
      args+=(--build)
    fi

    compose -f apps/hono-api/docker-compose.yml "${args[@]}"
    echo "Web: http://localhost:${WEB_PORT:-5173}"
    echo "API: http://localhost:${API_PORT:-8788}"
    echo "Agents: http://localhost:${AGENTS_PORT:-8799}"
    echo "Trace API: http://localhost:${TRACE_API_PORT:-5781}"
    echo "Trace Web: http://localhost:${TRACE_WEB_PORT:-5782}"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
