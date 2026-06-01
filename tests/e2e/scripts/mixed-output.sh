#!/usr/bin/env bash
set -eu

i=0
while true; do
  printf 'info: message %d\n' "$i"
  printf 'error: something failed %d\n' "$i" >&2
  i=$((i + 1))
  sleep 0.5
done
