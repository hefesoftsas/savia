#!/usr/bin/env bash

set -euo pipefail

: "${POSTGRES_URL:?POSTGRES_URL must be set}"

relation="$(psql "$POSTGRES_URL" -Atqc "SELECT to_regclass('public.business_agency')")"

if [[ "$relation" != "business_agency" ]]; then
  echo "Expected public.business_agency to be restored, got: ${relation:-<none>}" >&2
  exit 1
fi

printf '%s\n' "$relation"
