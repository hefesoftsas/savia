#!/usr/bin/env bash

set -euo pipefail

api_url="${API_URL:-http://localhost:8787}"

get_api() {
  local url="$1"
  local attempt

  for attempt in {1..15}; do
    if curl --fail --silent "$url"; then
      return 0
    fi

    sleep 1
  done

  echo "Could not reach ${url} after ${attempt} attempts" >&2
  return 1
}

health="$(get_api "${api_url}/health")"
if ! jq --exit-status '.database == "ok"' <<<"$health" >/dev/null; then
  echo "Expected ${api_url}/health to report database: ok" >&2
  exit 1
fi

openapi="$(get_api "${api_url}/openapi.json")"
if ! jq --exit-status '.openapi == "3.1.0"' <<<"$openapi" >/dev/null; then
  echo "Expected ${api_url}/openapi.json to report openapi: 3.1.0" >&2
  exit 1
fi

docs="$(get_api "${api_url}/docs")"
if ! grep --quiet --ignore-case "scalar" <<<"$docs"; then
  echo "Expected ${api_url}/docs to include Scalar" >&2
  exit 1
fi

printf '%s\n' "Local stack verified at ${api_url}"
