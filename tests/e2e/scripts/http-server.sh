#!/usr/bin/env bash
set -eu

i=0
while true; do
  printf 'GET /api/users 200 %d\n' "$i"
  printf 'POST /api/login 200 %d\n' "$i"
  printf 'GET /api/missing 404 %d\n' "$i"
  printf 'GET /api/broken 500 %d\n' "$i"
  i=$((i + 1))
  sleep 0.5
done
