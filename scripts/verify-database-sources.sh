#!/usr/bin/env bash
set -euo pipefail
# Disposable loopback-only fixtures. Never reuse production credentials here.
run_id="savia-dbtest-$(date +%s)-$$"
created=()
cleanup() { for name in "${created[@]}"; do docker rm -f "$name" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT INT TERM
start() { local engine="$1"; shift; local name="${run_id}-${engine}"; docker run -d --name "$name" "$@" >/dev/null; created+=("$name"); }
IFS=',' read -r -a engines <<< "${SAVIA_DB_ENGINES:-postgres,mysql,mssql,mongodb}"
# Run engines sequentially so local SQL Server does not compete with three other databases.
for engine in "${engines[@]}"; do
  case "$engine" in
    postgres) start postgres -e POSTGRES_PASSWORD=savia_test_only -e POSTGRES_DB=savia_test -p 127.0.0.1:15432:5432 postgres:16-alpine ;;
    mysql) start mysql -e MYSQL_ROOT_PASSWORD=savia_test_only -e MYSQL_DATABASE=savia_test -p 127.0.0.1:13306:3306 mysql:8.4 ;;
    mongodb) start mongodb -p 127.0.0.1:17017:27017 mongo:8.0 ;;
    mssql) start mssql --platform linux/amd64 -e ACCEPT_EULA=Y -e MSSQL_PID=Developer -e MSSQL_SA_PASSWORD=Savia_test_Only_2026 -p 127.0.0.1:11433:1433 mcr.microsoft.com/mssql/server:2022-latest ;;
    *) echo "Unknown engine: $engine" >&2; exit 1 ;;
  esac
  ready=false
  for attempt in $(seq 1 180); do
    case "$engine" in
      postgres) docker exec "${run_id}-${engine}" pg_isready -U postgres >/dev/null 2>&1 && ready=true ;;
      mysql) docker exec "${run_id}-${engine}" mysqladmin ping -h localhost -psavia_test_only >/dev/null 2>&1 && ready=true ;;
      mongodb) docker exec "${run_id}-${engine}" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1 && ready=true ;;
      mssql) docker logs "${run_id}-${engine}" 2>&1 | grep -q 'SQL Server is now ready for client connections' && ready=true ;;
    esac
    if "$ready"; then break; fi
    sleep 2
  done
  if ! "$ready"; then echo "$engine did not become ready" >&2; exit 1; fi
  SAVIA_DB_ENGINES="$engine" pnpm --filter @savia/db-bridge test:live
  docker rm -f "${run_id}-${engine}" >/dev/null
done
