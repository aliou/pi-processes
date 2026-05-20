#!/usr/bin/env bash
set -eu

marker="${1:-release-output}"
message="${2:-dynamic ready}"

printf 'waiting for %s\n' "$marker"
while [ ! -e "$marker" ]; do
  sleep 0.05
done

printf '%s\n' "$message"
