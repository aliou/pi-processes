#!/usr/bin/env bash
set -eu

i=0
while true; do
  printf 'stdout: message %d\n' "$i"
  printf 'stderr: warning %d\n' "$i" >&2
  i=$((i + 1))
  sleep 0.5
done
