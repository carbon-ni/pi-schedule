#!/usr/bin/env sh
set -eu
log=$(mktemp)
trap 'rm -f "$log"' EXIT HUP INT TERM
if (npm run lint && npm run typecheck && npm test) >"$log" 2>&1; then
  printf 'true\n'
else
  printf 'false\n'
  tail -n 40 "$log"
  exit 1
fi
