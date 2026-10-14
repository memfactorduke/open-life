#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
state="${MEMS_LIFE_PG_STATE:-$PWD/.runtime/postgres}"
port="${MEMS_LIFE_PG_PORT:-55432}"
export PGHOST=127.0.0.1 PGPORT="$port" PGUSER=mems_life
# Exact isolated fixture names used by server tests. mems_life is the separate
# development database. Scripts create mems_life_offline_live_test themselves.
# mems_life_rc_tooling and mems_life_production_web_test are intentionally absent.
# mems_life_ci_web is the hermetic browser fixture only.
fixture_databases=(
  mems_life_agent_workflows_test
  mems_life_attention_test
  mems_life_ci_web
  mems_life_features_test
  mems_life_food_test
  mems_life_mcp_test
  mems_life_mcp_workflows_test
  mems_life_native_media_test
  mems_life_next_wiring_test
  mems_life_portability_test
  mems_life_productivity_test
  mems_life_rc_core
  mems_life_rc_data
  mems_life_reconciliation_test
  mems_life_restore_test
  mems_life_sessions_test
  mems_life_sync_test
  mems_life_task_files_test
  mems_life_test
  mems_life_whoop_test
  mems_life_wiring_test
)

refuse_symlinks() {
  if [[ -L "$state" || -L "$state/data" ]]; then
    printf 'Refusing symlinked PostgreSQL state.\n' >&2
    exit 1
  fi
}

ensure_database() {
  local database="$1"
  if [[ ! "$database" =~ ^mems_life(_[a-z0-9]+)*$ ]]; then
    printf 'Refusing unexpected database name.\n' >&2
    exit 1
  fi
  local exists
  exists="$(psql -d postgres -At -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = '${database}'")"
  if [[ "$exists" != 1 ]]; then
    createdb "$database"
  fi
}

ensure_fixtures() {
  local database
  for database in "${fixture_databases[@]}"; do
    ensure_database "$database"
  done
}

case "${1:-status}" in
  init)
    refuse_symlinks
    mkdir -p "$state/socket"
    chmod 700 "$state"
    if [[ ! -f "$state/data/PG_VERSION" ]]; then
      initdb -D "$state/data" -U mems_life -A trust --encoding=UTF8 --locale=C
      printf "\nlisten_addresses = '127.0.0.1'\nport = %s\nunix_socket_directories = '%s'\nmax_connections = 80\nshared_buffers = 128MB\nwork_mem = 4MB\nsuperuser_reserved_connections = 3\n" "$port" "$state/socket" >> "$state/data/postgresql.conf"
    fi
    ;;
  start)
    bash scripts/db.sh init
    if ! pg_ctl -D "$state/data" status >/dev/null 2>&1; then
      pg_ctl -D "$state/data" -l "$state/server.log" -w start
    fi
    ensure_database mems_life
    ensure_fixtures
    printf 'Local PostgreSQL ready at 127.0.0.1:%s. Development-only trust authentication. %s fixture databases ensured; none dropped.\n' "$port" "${#fixture_databases[@]}"
    ;;
  ensure-databases)
    ensure_fixtures
    printf 'Ensured %s fixture databases at 127.0.0.1:%s without dropping existing databases.\n' "${#fixture_databases[@]}" "$port"
    ;;
  foreground)
    bash scripts/db.sh init
    exec postgres -D "$state/data"
    ;;
  stop)
    refuse_symlinks
    if [[ -f "$state/data/PG_VERSION" ]] && pg_ctl -D "$state/data" status >/dev/null 2>&1; then
      pg_ctl -D "$state/data" -m fast -w stop
    fi
    ;;
  status)
    pg_ctl -D "$state/data" status
    psql -d mems_life -c 'SELECT current_database(), version();'
    ;;
  *) printf 'Use init, start, ensure-databases, foreground, stop, or status.\n' >&2; exit 2;;
esac
