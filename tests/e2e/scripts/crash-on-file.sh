set -eu

marker="${1:-crash-now}"

printf 'worker waiting for %s\n' "$marker"
while [ ! -e "$marker" ]; do
  sleep 0.05
done

printf 'fatal: marker %s detected\n' "$marker" >&2
exit 42
