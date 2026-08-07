#!/usr/bin/env bash
set -eu

printf 'stdin repl ready\n'

while IFS= read -r line; do
  case "$line" in
    quit|exit)
      printf 'goodbye\n'
      exit 0
      ;;
    *)
      printf 'echo:%s\n' "$line"
      ;;
  esac
done

# stdin closed (EOF) without an explicit quit
printf 'stdin closed\n'
