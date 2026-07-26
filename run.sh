#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
JarvisHub local dev launcher.

Usage:
  ./run.sh
  ./run.sh restart
  ./run.sh stop

Optional maintenance:
  ./run.sh --install
  ./run.sh --no-build       Skip agents-cli rebuild (fast restart)
  ./run.sh --clean          Wipe ~/.agents and repo-local .agents caches before build
  ./run.sh db
  ./run.sh db:stop
  ./run.sh db:logs

Environment:
  WEB_PORT=5175       Web dev server port
  WEB_HOST=127.0.0.1  Web dev server host
  API_PORT=8788       API dev server port
  AGENTS_PORT=8799    Agents bridge port
  AGENTS_REQUEST_TIMEOUT_MS=240000
                        Per LLM request timeout for the agents bridge
  TRACE_API_PORT=5781 Trace-viewer API server port
  TRACE_WEB_PORT=5782 Trace-viewer web dev server port
  NPM_REGISTRY=...    Registry used for dependency installation
  RUN_SH_NODE_VERSION=v24.15.0
                        Required Node version for spawned services
  NODE_BIN_DIR=...     Optional bin directory containing the required node
  LOCAL_PROXY_URL=...  Optional proxy exported to spawned services (empty=disabled)
  DATABASE_URL=...     Optional external Postgres DSN (default: managed local Postgres)
  PPT_MASTER_PYTHON=...  Optional Python 3.10+ executable; auto-detected if unset
  PPT_MASTER_HOME=<repo>/vendor/ppt-master/skills/ppt-master
                        PPT Master skill directory; bundled path used if unset
  PPT_MASTER_PROJECTS_ROOT=<repo>/var/ppt-master-projects
                        PPT Master generated project directory
  R2_ACCESS_KEY_ID=...  Override shared-test R2 with private storage
  R2_SECRET_ACCESS_KEY=...
  R2_BUCKET_URL=...
  R2_REGION=auto
  R2_PUBLIC_BASE_URL=...
  APIMART_IMAGE_API_KEY=...  Enables fixed APIMart image generation/edit
  APIMART_API_KEY=...        Also accepted for APIMart image key
  APIMART_IMAGE_MODEL=gpt-image-2  Also accepted as fixed image model
  JARVISHUB_FIXED_IMAGE_MODEL=gpt-image-2  Fixed image model override

Services:
  Web:    apps/web Vite dev server
  API:    apps/hono-api Node dev server
  Agents: apps/agents-cli HTTP bridge
  Trace:  tools/trace-viewer (API + web dev server)

Agents runtime:
  AGENTS_HOME is pinned to repo-local .agents
  AGENTS_SKILLS_DIR is pinned to apps/agents-cli/skills

Build:
  start/restart will install missing workspace dependencies automatically
  DATABASE_URL defaults to a managed local Postgres container; Docker
  Compose starts it and waits for it to become healthy before launch
  PPT Master must be present under vendor/ and uses an automatically
  selected Python 3.10+ with python-pptx and Pillow
  Object storage defaults to a public, disposable shared-test R2 bucket.
  Never upload private data; stable deployments must provide their own R2_* values.
  start/restart will rebuild apps/agents-cli (tsc)
  before launching, unless --no-build is passed. The bridge runs from
  TypeScript source via ts-node, so the build is mainly for type-check
  and does not write global ~/.agents skills unless AGENTS_SYNC_GLOBAL=1.
EOF
}

command="start"
install=0
skip_build=0
clean=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    db|db:start|db:stop|db:logs)
      command="$1"
      ;;
    start|restart|stop)
      command="$1"
      ;;
    --install)
      install=1
      ;;
    --no-build|--skip-build)
      skip_build=1
      ;;
    --clean)
      clean=1
      ;;
    *)
      echo "[run.sh] Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

absolute_repo_path() {
  local value="$1"
  if [ -z "$value" ]; then
    return 1
  fi
  case "$value" in
    /*) printf "%s" "$value" ;;
    *) printf "%s/%s" "$ROOT_DIR" "$value" ;;
  esac
}

has_ppt_master_scripts() {
  local skill_dir="${1%/}"
  [ -f "$skill_dir/SKILL.md" ] &&
    [ -f "$skill_dir/scripts/project_manager.py" ] &&
    [ -f "$skill_dir/scripts/svg_to_pptx.py" ]
}

ensure_ppt_master_home() {
  local configured="${PPT_MASTER_HOME:-${PPT_MASTER_SKILL_DIR:-}}"
  local configured_absolute=""

  if [ -n "$configured" ]; then
    configured_absolute="$(absolute_repo_path "${configured%/}")"
    if has_ppt_master_scripts "$configured_absolute"; then
      export PPT_MASTER_HOME="$configured_absolute"
      return 0
    fi
    echo "[run.sh] Configured PPT Master directory is incomplete: $configured_absolute" >&2
    return 1
  fi

  local skill_dir="$ROOT_DIR/vendor/ppt-master/skills/ppt-master"

  if ! has_ppt_master_scripts "$skill_dir"; then
    echo "[run.sh] Bundled PPT Master runtime is incomplete: $skill_dir" >&2
    echo "[run.sh] Re-download the repository, or set PPT_MASTER_HOME to a complete skill directory." >&2
    return 1
  fi

  export PPT_MASTER_HOME="$skill_dir"
  return 0
}

ensure_ppt_projects_root() {
  local root="${PPT_MASTER_PROJECTS_ROOT:-$ROOT_DIR/var/ppt-master-projects}"
  root="$(absolute_repo_path "$root")"
  mkdir -p "$root"
  export PPT_MASTER_PROJECTS_ROOT="$root"
}

resolve_executable() {
  local value="$1"
  if [[ "$value" == */* ]]; then
    [ -x "$value" ] || return 1
    printf "%s" "$value"
    return 0
  fi
  command -v "$value" 2>/dev/null
}

ppt_python_version() {
  "$1" -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>/dev/null
}

ppt_python_is_supported() {
  local version major minor
  version="$(ppt_python_version "$1" || true)"
  [[ "$version" =~ ^[0-9]+\.[0-9]+ ]] || return 1
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  [ "$major" -gt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -ge 10 ]; }
}

ppt_python_has_modules() {
  "$1" -c "import pptx; import PIL" >/dev/null 2>&1
}

ensure_ppt_master_python() {
  local candidate=""
  local version=""

  if [ -n "${PPT_MASTER_PYTHON:-}" ]; then
    candidate="$(resolve_executable "$PPT_MASTER_PYTHON" || true)"
    if [ -z "$candidate" ]; then
      echo "[run.sh] PPT_MASTER_PYTHON is not executable: $PPT_MASTER_PYTHON" >&2
      return 1
    fi
    version="$(ppt_python_version "$candidate" || true)"
    if ! ppt_python_is_supported "$candidate"; then
      echo "[run.sh] PPT Master requires Python 3.10+, but $candidate is ${version:-unreadable}." >&2
      return 1
    fi
    if ! ppt_python_has_modules "$candidate"; then
      echo "[run.sh] PPT Master Python is missing python-pptx or Pillow: $candidate" >&2
      echo "[run.sh] Install them with: $candidate -m pip install python-pptx Pillow" >&2
      return 1
    fi
    export PPT_MASTER_PYTHON="$candidate"
    echo "[run.sh] PPT Master Python: ${version} (${candidate})"
    return 0
  fi

  local candidates=()
  local name path seen="|"
  for name in python3 python3.13 python3.12 python3.11 python3.10; do
    path="$(command -v "$name" 2>/dev/null || true)"
    [ -n "$path" ] && candidates+=("$path")
  done
  [ -n "${CONDA_PREFIX:-}" ] && candidates+=("$CONDA_PREFIX/bin/python3")
  candidates+=(
    "$HOME/miniconda3/bin/python3"
    "$HOME/anaconda3/bin/python3"
    "/opt/homebrew/bin/python3"
    "/usr/local/bin/python3"
  )

  for path in "${candidates[@]}"; do
    [ -x "$path" ] || continue
    case "$seen" in
      *"|$path|"*) continue ;;
    esac
    seen="${seen}${path}|"
    if ppt_python_is_supported "$path" && ppt_python_has_modules "$path"; then
      export PPT_MASTER_PYTHON="$path"
      version="$(ppt_python_version "$path")"
      echo "[run.sh] PPT Master Python: ${version} (${path})"
      return 0
    fi
  done

  echo "[run.sh] PPT Master requires Python 3.10+ with python-pptx and Pillow." >&2
  echo "[run.sh] Install a compatible Python, or run: PPT_MASTER_PYTHON=/absolute/path/to/python3 ./run.sh" >&2
  return 1
}

compose_api() {
  docker compose -f apps/hono-api/docker-compose.yml "$@"
}

require_docker_compose() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[run.sh] Docker is required to start the managed local Postgres database." >&2
    echo "[run.sh] Install and start Docker, or configure DATABASE_URL for an existing database." >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "[run.sh] Docker Compose is required to start the managed local Postgres database." >&2
    echo "[run.sh] Install Docker Compose, or configure DATABASE_URL for an existing database." >&2
    exit 1
  fi
}

start_managed_postgres() {
  require_docker_compose
  echo "[run.sh] Starting managed local Postgres container..."
  compose_api up -d --wait postgres
}

has_postgres_compose_overrides() {
  local key
  for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_PORT; do
    if [ -n "${!key:-}" ]; then
      return 0
    fi
  done
  return 1
}

ensure_database_runtime() {
  local database_url="${DATABASE_URL:-}"

  if [ -z "$database_url" ]; then
    if has_postgres_compose_overrides; then
      echo "[run.sh] POSTGRES_* overrides require a matching DATABASE_URL." >&2
      echo "[run.sh] Set DATABASE_URL in the shell command, or remove the POSTGRES_* overrides." >&2
      exit 1
    fi
    database_url="$MANAGED_DATABASE_URL"
    export DATABASE_URL="$database_url"
  fi

  if [ "$database_url" = "$MANAGED_DATABASE_URL" ]; then
    start_managed_postgres
  fi
}

ensure_node_version() {
  local required="${RUN_SH_NODE_VERSION:-v24.15.0}"
  if [[ "$required" != v* ]]; then
    required="v${required}"
  fi

  local candidates=()
  if [ -n "${NODE_BIN_DIR:-}" ]; then
    candidates+=("$NODE_BIN_DIR")
  fi
  if [ -n "${NVM_DIR:-}" ]; then
    candidates+=("${NVM_DIR}/versions/node/${required}/bin")
  fi
  candidates+=("$HOME/.nvm/versions/node/${required}/bin")

  for dir in "${candidates[@]}"; do
    if [ ! -x "${dir}/node" ]; then
      continue
    fi
    local version
    version="$("${dir}/node" -p 'process.version' 2>/dev/null || true)"
    if [ "$version" = "$required" ]; then
      export PATH="${dir}:$PATH"
      echo "[run.sh] Node runtime pinned: ${version} (${dir}/node)"
      return
    fi
  done

  local current_version
  current_version="$(node -p 'process.version' 2>/dev/null || true)"
  if [ "$current_version" = "$required" ]; then
    echo "[run.sh] Node runtime pinned: ${current_version} ($(command -v node))"
    return
  fi

  echo "[run.sh] Error: Node ${required} is required, but current node is ${current_version:-not found}." >&2
  echo "[run.sh] Install it with nvm, or set NODE_BIN_DIR to the bin directory containing node ${required}." >&2
  exit 1
}

WEB_PORT="${WEB_PORT:-5175}"
WEB_HOST="${WEB_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8788}"
AGENTS_PORT="${AGENTS_PORT:-8799}"
TRACE_API_PORT="${TRACE_API_PORT:-5781}"
TRACE_WEB_PORT="${TRACE_WEB_PORT:-5782}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
LOCAL_PROXY_URL="${LOCAL_PROXY_URL:-}"
LOCAL_NO_PROXY_DEFAULT="localhost,127.0.0.1,::1,0.0.0.0,.local"
MANAGED_DATABASE_URL="postgresql://jarvishub:jarvishub@127.0.0.1:5432/jarvishub?schema=public"

R2_STORAGE_MODE="shared-test"
for key in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_URL R2_REGION R2_PUBLIC_BASE_URL; do
  if [ -n "${!key:-}" ]; then
    R2_STORAGE_MODE="custom"
    break
  fi
done
export R2_STORAGE_MODE
export R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-89e3a82103aa2c479efb9bbebe668b77}"
export R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-e3c999c46655ee6086f8e24a0906bc37bde600cfae22446122b64394591c329d}"
export R2_BUCKET_URL="${R2_BUCKET_URL:-https://1e9bb2455c4a54b88f176a038b5c56ed.r2.cloudflarestorage.com/videogen}"
export R2_REGION="${R2_REGION:-auto}"
export R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL:-https://pub-bfa13e2deb3c4f96acf8bcd4be7b602a.r2.dev}"

ensure_node_version

if [ -n "$LOCAL_PROXY_URL" ]; then
  export HTTP_PROXY="${HTTP_PROXY:-$LOCAL_PROXY_URL}"
  export HTTPS_PROXY="${HTTPS_PROXY:-$LOCAL_PROXY_URL}"
  export ALL_PROXY="${ALL_PROXY:-$LOCAL_PROXY_URL}"
  export http_proxy="${http_proxy:-$HTTP_PROXY}"
  export https_proxy="${https_proxy:-$HTTPS_PROXY}"
  export all_proxy="${all_proxy:-$ALL_PROXY}"
  if [ -n "${NO_PROXY:-}" ]; then
    export NO_PROXY="${NO_PROXY},${LOCAL_NO_PROXY_DEFAULT}"
  else
    export NO_PROXY="$LOCAL_NO_PROXY_DEFAULT"
  fi
  export no_proxy="${no_proxy:-$NO_PROXY}"
  echo "[run.sh] Proxy enabled for external requests: ${LOCAL_PROXY_URL}"
fi

# Force IPv4 first for all spawned Node processes. Cloudflare AAAA records (api.apimart.ai,
# codex2.sssaicode.com, etc.) are unreachable from many CN egress paths; Node 24's verbatim
# default makes undici dial dead IPv6 first and ETIMEDOUT before falling back.
# Also disable autoSelectFamily (Happy Eyeballs) — Node 24's undici implementation has a bug
# where it times out instead of falling back when multiple A records resolve to mixed-reachable
# Cloudflare anycast IPs. Disabling it lets undici connect to the first resolved address directly.
# Override via NODE_OPTIONS in the caller's env if you need different behavior.
if [[ "${NODE_OPTIONS:-}" != *"--dns-result-order"* ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --no-network-family-autoselection"
fi
if [ -n "$LOCAL_PROXY_URL" ] && node --help 2>/dev/null | grep -q -- "--use-env-proxy"; then
  if [[ "${NODE_OPTIONS:-}" != *"--use-env-proxy"* ]]; then
    export NODE_OPTIONS="${NODE_OPTIONS:-} --use-env-proxy"
  fi
  echo "[run.sh] Node env proxy enabled via NODE_OPTIONS: --use-env-proxy"
elif [ -n "$LOCAL_PROXY_URL" ]; then
  echo "[run.sh] Warning: current Node does not support --use-env-proxy; Node fetch may ignore HTTP_PROXY/HTTPS_PROXY."
  echo "[run.sh] Use Node v24+ or enable Clash TUN/transparent proxy for Node fetch traffic."
fi

port_listener_pids() {
  local port="$1"
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

process_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

process_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

process_pgid() {
  local pid="$1"
  ps -p "$pid" -o pgid= 2>/dev/null | tr -d '[:space:]'
}

print_port_owner() {
  local port="$1"
  local pid="$2"
  local command_line
  local cwd

  command_line="$(process_command "$pid")"
  cwd="$(process_cwd "$pid")"
  echo "  - port ${port}: pid ${pid}" >&2
  echo "    cwd: ${cwd:-unknown}" >&2
  echo "    command: ${command_line:-unknown}" >&2
}

pid_descendants() {
  local parent="$1"
  local child

  pgrep -P "$parent" 2>/dev/null | while read -r child; do
    pid_descendants "$child"
    printf "%s\n" "$child"
  done
}

terminate_pid_tree() {
  local root_pid="$1"
  local tree

  tree="$(
    pid_descendants "$root_pid"
    printf "%s\n" "$root_pid"
  )"

  echo "$tree" | sort -rn | while read -r pid; do
    [ -n "$pid" ] || continue
    kill "$pid" 2>/dev/null || true
  done
}

port_is_free() {
  local port="$1"
  [ -z "$(port_listener_pids "$port")" ]
}

wait_for_ports_to_free() {
  local attempts=25
  local port

  while [ "$attempts" -gt 0 ]; do
    local busy=0
    for port in "$WEB_PORT" "$API_PORT" "$AGENTS_PORT" "$TRACE_API_PORT" "$TRACE_WEB_PORT"; do
      if ! port_is_free "$port"; then
        busy=1
      fi
    done

    if [ "$busy" -eq 0 ]; then
      return 0
    fi

    attempts=$((attempts - 1))
    sleep 0.2
  done

  return 1
}

stop_existing_services() {
  local found=0
  local pids=""
  local groups=""
  local port
  local pid
  local pgid

  for port in "$WEB_PORT" "$API_PORT" "$AGENTS_PORT" "$TRACE_API_PORT" "$TRACE_WEB_PORT"; do
    while read -r pid; do
      [ -n "$pid" ] || continue
      found=1
      print_port_owner "$port" "$pid"
      pids="${pids}${pid}
"
      pgid="$(process_pgid "$pid")"
      if [ -n "$pgid" ]; then
        groups="${groups}${pgid}
"
      fi
    done <<EOF
$(port_listener_pids "$port")
EOF
  done

  if [ "$found" -eq 0 ]; then
    echo "[run.sh] No existing services found on ${WEB_PORT}/${API_PORT}/${AGENTS_PORT}/${TRACE_API_PORT}/${TRACE_WEB_PORT}."
    return 0
  fi

  echo "[run.sh] Stopping all processes occupying ${WEB_PORT}/${API_PORT}/${AGENTS_PORT}/${TRACE_API_PORT}/${TRACE_WEB_PORT} (SIGTERM)..."
  echo "$groups" | sort -u | while read -r pgid; do
    [ -n "$pgid" ] || continue
    kill -TERM "-$pgid" 2>/dev/null || true
  done
  echo "$pids" | sort -u | while read -r pid; do
    [ -n "$pid" ] || continue
    kill -TERM "$pid" 2>/dev/null || true
  done

  if wait_for_ports_to_free; then
    return 0
  fi

  echo "[run.sh] Ports still busy after SIGTERM; escalating to SIGKILL..."
  echo "$groups" | sort -u | while read -r pgid; do
    [ -n "$pgid" ] || continue
    kill -KILL "-$pgid" 2>/dev/null || true
  done
  echo "$pids" | sort -u | while read -r pid; do
    [ -n "$pid" ] || continue
    kill -KILL "$pid" 2>/dev/null || true
  done

  # Final sweep: re-resolve current listeners and SIGKILL anything that survived
  # (e.g. fresh PIDs spawned by a supervisor while we were terminating the old tree).
  for port in "$WEB_PORT" "$API_PORT" "$AGENTS_PORT" "$TRACE_API_PORT" "$TRACE_WEB_PORT"; do
    while read -r pid; do
      [ -n "$pid" ] || continue
      kill -KILL "$pid" 2>/dev/null || true
    done <<EOF
$(port_listener_pids "$port")
EOF
  done

  if wait_for_ports_to_free; then
    return 0
  fi

  echo "[run.sh] Failed to free required ports:" >&2
  for port in "$WEB_PORT" "$API_PORT" "$AGENTS_PORT" "$TRACE_API_PORT" "$TRACE_WEB_PORT"; do
    while read -r pid; do
      [ -n "$pid" ] || continue
      print_port_owner "$port" "$pid"
    done <<EOF
$(port_listener_pids "$port")
EOF
  done
  exit 1
}

if [ "$command" = "stop" ]; then
  stop_existing_services
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[run.sh] pnpm not found. Install pnpm first, then rerun ./run.sh." >&2
  exit 1
fi

case "$command" in
  db|db:start)
    export DATABASE_URL="${DATABASE_URL:-$MANAGED_DATABASE_URL}"
    start_managed_postgres
    echo
    echo "[run.sh] Postgres is available at:"
    echo "  postgresql://jarvishub:jarvishub@127.0.0.1:5432/jarvishub?schema=public"
    echo
    echo "[run.sh] Database container is running. Schema initialization is a separate step."
    exit 0
    ;;
  db:stop)
    echo "[run.sh] Stopping local Postgres container..."
    compose_api stop postgres
    exit 0
    ;;
  db:logs)
    compose_api logs -f postgres
    exit 0
    ;;
esac

install_workspace_dependencies() {
  echo "[run.sh] Installing workspace dependencies via ${NPM_REGISTRY}"
  npm_config_registry="$NPM_REGISTRY" pnpm install \
    --prefer-offline \
    --frozen-lockfile \
    --filter @jarvishub/web... \
    --filter @jarvishub/api... \
    --filter agents... \
    --filter trace-viewer...
}

collect_missing_dependencies() {
  missing_deps=()
  [ -x "apps/web/node_modules/.bin/vite" ] || missing_deps+=("apps/web: vite")
  [ -d "apps/hono-api/node_modules/ts-node" ] || missing_deps+=("apps/hono-api: ts-node")
  [ -d "apps/agents-cli/node_modules/ts-node" ] || missing_deps+=("apps/agents-cli: ts-node")
  [ -d "tools/trace-viewer/node_modules/tsx" ] || missing_deps+=("tools/trace-viewer: tsx")
  [ -x "tools/trace-viewer/node_modules/.bin/vite" ] || missing_deps+=("tools/trace-viewer: vite")
}

collect_missing_dependencies
if [ "$install" = "1" ] || [ "${#missing_deps[@]}" -gt 0 ]; then
  if [ "$install" != "1" ]; then
    echo "[run.sh] Workspace dependencies are missing; installing them automatically."
  fi
  install_workspace_dependencies
  collect_missing_dependencies
fi

if [ "${#missing_deps[@]}" -gt 0 ]; then
  echo "[run.sh] Missing dependencies:" >&2
  for item in "${missing_deps[@]}"; do
    echo "  - ${item}" >&2
  done
  echo >&2
  echo "[run.sh] Automatic dependency installation did not provide all required packages." >&2
  echo "[run.sh] Check the pnpm output above, then rerun ./run.sh." >&2
  echo >&2
  echo "[run.sh] If npmjs is unstable, keep the default mirror or set another registry:" >&2
  echo "  NPM_REGISTRY=https://registry.npmmirror.com ./run.sh --install" >&2
  exit 1
fi

ensure_ppt_projects_root
if ! ensure_ppt_master_home; then
  echo "[run.sh] Missing runtime configuration:" >&2
  echo "  - PPT Master runtime is required for editable PPTX export." >&2
  exit 1
fi
if ! ensure_ppt_master_python; then
  exit 1
fi

ensure_database_runtime
export JWT_SECRET="${JWT_SECRET:-dev-secret}"
export INTERNAL_WORKER_TOKEN="${INTERNAL_WORKER_TOKEN:-change-me}"

if [ "$R2_STORAGE_MODE" = "shared-test" ]; then
  echo "[run.sh] Object storage: shared test R2 (public and disposable; do not upload private data)."
else
  echo "[run.sh] Object storage: custom R2 configuration from the shell environment."
fi

clean_agent_caches() {
  echo "[run.sh] Cleaning agent caches (~/.agents/{dist,skills}, ${ROOT_DIR}/.agents/{dist,skills}, apps/agents-cli/dist)..."
  rm -rf "$HOME/.agents/dist" "$HOME/.agents/skills"
  rm -rf "$ROOT_DIR/.agents/dist" "$ROOT_DIR/.agents/skills"
  rm -rf "$ROOT_DIR/apps/agents-cli/dist"
}

build_agents_cli() {
  echo "[run.sh] Building agents-cli (clean → tsc → sync)..."
  if ! ( cd "$ROOT_DIR/apps/agents-cli" && npm run build ); then
    echo "[run.sh] agents-cli build failed; aborting before stopping running services." >&2
    exit 1
  fi
}

if [ "$clean" = "1" ]; then
  clean_agent_caches
fi

if [ "$skip_build" != "1" ]; then
  build_agents_cli
else
  echo "[run.sh] --no-build set; skipping agents-cli rebuild."
fi

stop_existing_services

pids=()
names=()

cleanup() {
  local code="${1:-$?}"
  trap - EXIT INT TERM

  if [ "${#pids[@]}" -gt 0 ]; then
    echo
    echo "[run.sh] Stopping services..."
    for pid in "${pids[@]}"; do
      terminate_pid_tree "$pid"
    done
    wait 2>/dev/null || true
  fi

  exit "$code"
}

trap 'cleanup $?' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

start_service() {
  local name="$1"
  shift

  echo "[run.sh] Starting ${name}: $*"
  "$@" &
  pids+=("$!")
  names+=("$name")
}

TRACE_ROOT="${TRACE_ROOT:-$ROOT_DIR/apps/agents-cli/.agents/runtime/traces}"

start_service "agents" env \
  AGENTS_HOME="$ROOT_DIR/.agents" \
  AGENTS_SKILLS_DIR="$ROOT_DIR/apps/agents-cli/skills" \
  AGENTS_WORKSPACE_ROOT="$ROOT_DIR" \
  AGENTS_DNS_RESULT_ORDER="${AGENTS_DNS_RESULT_ORDER:-ipv4first}" \
  AGENTS_REQUEST_TIMEOUT_MS="${AGENTS_REQUEST_TIMEOUT_MS:-240000}" \
  AGENTS_FETCH_RETRIES="${AGENTS_FETCH_RETRIES:-3}" \
  TRACE_ROOT="$TRACE_ROOT" \
  TRACE_CAPTURE=1 \
  pnpm --filter agents exec node --loader ts-node/esm src/cli/index.ts serve --port "$AGENTS_PORT"
start_service "api" env \
  PORT="$API_PORT" \
  AGENTS_BRIDGE_BASE_URL="http://127.0.0.1:${AGENTS_PORT}" \
  AGENTS_BRIDGE_AUTOSTART=0 \
  JARVISHUB_REPO_ROOT="$ROOT_DIR" \
  PPT_MASTER_HOME="$PPT_MASTER_HOME" \
  PPT_MASTER_PROJECTS_ROOT="$PPT_MASTER_PROJECTS_ROOT" \
  PPT_MASTER_PYTHON="$PPT_MASTER_PYTHON" \
  pnpm --filter @jarvishub/api exec node -r ts-node/register/transpile-only src/main.ts
start_service "web" env \
  VITE_API_BASE="http://localhost:${API_PORT}" \
  pnpm --filter @jarvishub/web exec vite --host "$WEB_HOST" --port "$WEB_PORT" --strictPort
start_service "trace-api" env \
  TRACE_ROOT="$TRACE_ROOT" \
  TRACE_VIEWER_PORT="$TRACE_API_PORT" \
  npx --prefix tools/trace-viewer tsx tools/trace-viewer/server/index.ts
start_service "trace-web" env \
  npx --prefix tools/trace-viewer vite tools/trace-viewer/web --port "$TRACE_WEB_PORT" --strictPort

echo
echo "[run.sh] Services started:"
echo "  Web:       http://localhost:${WEB_PORT}"
echo "  API:       http://localhost:${API_PORT}"
echo "  Agents:    http://localhost:${AGENTS_PORT}"
echo "  Trace API: http://localhost:${TRACE_API_PORT}"
echo "  Trace Web: http://localhost:${TRACE_WEB_PORT}"
echo "  PPT Master: ${PPT_MASTER_HOME}"
echo "  PPT Python: ${PPT_MASTER_PYTHON}"
echo "  PPT Projects: ${PPT_MASTER_PROJECTS_ROOT}"
echo
echo "[run.sh] Press Ctrl+C to stop all services."

while true; do
  for index in "${!pids[@]}"; do
    pid="${pids[$index]}"
    name="${names[$index]}"

    if ! kill -0 "$pid" 2>/dev/null; then
      set +e
      wait "$pid"
      status=$?
      set -e
      echo "[run.sh] ${name} exited with code ${status}."
      exit "$status"
    fi
  done
  sleep 1
done
