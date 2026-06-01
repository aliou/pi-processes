#!/usr/bin/env bash
set -eu

i=0
while true; do
  printf 'verbose output line %d with some padding text to make the line longer and more realistic\n' "$i"
  i=$((i + 1))
  sleep 0.1
done
