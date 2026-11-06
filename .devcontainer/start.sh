#!/bin/sh
set -eu

# Reconcile dependencies on every start, including after switching branches.
pnpm install --frozen-lockfile --store-dir /home/node/.local/share/pnpm/store
exec pnpm dev
