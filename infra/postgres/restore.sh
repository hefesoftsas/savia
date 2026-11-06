#!/usr/bin/env bash

set -euo pipefail

export PGUSER="$POSTGRES_USER"

pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$POSTGRES_DB" /backups/source.dump
