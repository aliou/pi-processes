#!/bin/bash
# Test script that simulates a crash (exit code 137 - like SIGKILL)
# Usage: ./test-exit-crash.sh [seconds]

WAIT_SECONDS=${1:-5}

echo "Starting unstable task..."
echo "Will crash in ${WAIT_SECONDS} seconds"

for i in $(seq 1 $WAIT_SECONDS); do
  echo "[$(date '+%H:%M:%S')] Running... ($i/$WAIT_SECONDS)"
  if [ $i -eq $((WAIT_SECONDS - 1)) ]; then
    echo "[WARN] Memory pressure detected" >&2
  fi
  sleep 1
done

echo "FATAL: Segmentation fault (core dumped)" >&2
exit 137
