#!/usr/bin/env bash
set -eu

printf 'booting fixture service\n'
printf 'server ready on http://localhost:3000\n'
printf 'cache warmup complete\n'
printf 'TypeError: broken fixture\n' >&2
printf 'job completed\n'
printf 'unrelated healthcheck ok\n'
printf 'tail'
