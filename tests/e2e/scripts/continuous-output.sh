#!/usr/bin/env bash
set -eu

i=0
while true; do
  printf 'ping %d\n' "$i"
  i=$((i + 1))
  sleep 0.5
done
