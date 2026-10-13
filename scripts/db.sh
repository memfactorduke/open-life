#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
state="$PWD/.runtime/postgres"
port="${MEMS_LIFE_PG_PORT:-55432}"
mkdir -p "$state/socket"
chmod 700 "$state"
export PGHOST=127.0.0.1 PGPORT="$port" PGUSER=mems_life
case "${1:-status}" in
  init)
    if [[ ! -f "$state/data/PG_VERSION" ]]; then
      initdb -D "$state/data" -U mems_life -A trust --encoding=UTF8 --locale=C
      printf "\nlisten_addresses = '127.0.0.1'\nport = %s\nunix_socket_directories = '%s'\n" "$port" "$state/socket" >> "$state/data/postgresql.conf"
    fi
    ;;
  start)
    bash scripts/db.sh init
    if ! pg_ctl -D "$state/data" status >/dev/null 2>&1; then
      pg_ctl -D "$state/data" -l "$state/server.log" -w start
    fi
    for database in mems_life mems_life_test; do
      exists="$(psql -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname = '$database'")"
      if [[ "$exists" != 1 ]]; then createdb "$database"; fi
    done
    printf 'Local PostgreSQL ready at 127.0.0.1:%s. Development-only trust authentication.\n' "$port"
    ;;
  foreground)
    bash scripts/db.sh init
    exec postgres -D "$state/data"
    ;;
  stop)
    if [[ -f "$state/data/PG_VERSION" ]] && pg_ctl -D "$state/data" status >/dev/null 2>&1; then
      pg_ctl -D "$state/data" -m fast -w stop
    fi
    ;;
  status)
    pg_ctl -D "$state/data" status
    psql -d mems_life -c 'SELECT current_database(), version();'
    ;;
  *) printf 'Use init, start, foreground, stop, or status.\n' >&2; exit 2;;
esac
