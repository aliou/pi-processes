#!/usr/bin/env bash
set -eu

printf 'burst ready\n'
while [ ! -e release-burst ]; do
  sleep 0.05
done
touch burst-started
i=0
while [ "$i" -lt 1024 ]; do
  printf '%0255d\n' "$i"
  printf '%0255d\n' "$i" >&2
  i=$((i + 1))
done
printf 'stdout burst complete\n'
printf 'stderr burst complete\n' >&2
touch burst-finished
