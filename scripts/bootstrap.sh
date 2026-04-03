#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-start}"

log() {
  printf '[flowforge] %s\n' "$1"
}

fail() {
  printf '[flowforge] %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Missing required command: ${cmd}. ${hint}"
  fi
}

print_versions() {
  log "Node: $(node -v)"
  log "npm: $(npm -v)"
  log "Python: $(python3 --version 2>&1)"
  log "sqlite3: $(sqlite3 --version | awk '{print $1}')"
}

install_node_dependencies() {
  log "Installing npm dependencies"
  (cd "$ROOT_DIR" && npm install --no-fund --no-audit)
}

start_platform() {
  log "Starting FlowForge API Lab"
  log "Console: http://localhost:${PORT:-3000}"
  log "Runner:  http://127.0.0.1:${RUNNER_PORT:-8010}"
  cd "$ROOT_DIR"
  exec npm start
}

case "$MODE" in
  start|--start)
    MODE="start"
    ;;
  install|--install-only)
    MODE="install"
    ;;
  *)
    fail "Unsupported mode: ${MODE}. Use 'start' or '--install-only'."
    ;;
esac

require_cmd node "Install Node.js 18 or later."
require_cmd npm "npm is required to install and start the project."
require_cmd python3 "Install Python 3.9 or later."
require_cmd sqlite3 "Install sqlite3 command line tools before starting the project."

print_versions
install_node_dependencies

if [[ "$MODE" == "install" ]]; then
  log "Project dependencies are ready"
  exit 0
fi

start_platform
