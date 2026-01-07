#!/bin/bash
# Test script that exits with failure (exit code 1)
# Usage: ./test-exit-failure.sh [seconds]

WAIT_SECONDS=${1:-5}

echo "Starting failing task..."
echo "Will fail in ${WAIT_SECONDS} seconds"

for i in $(seq 1 $WAIT_SECONDS); do
  echo "[$(date '+%H:%M:%S')] Processing... ($i/$WAIT_SECONDS)"
  sleep 1
done

echo "ERROR: Task failed!" >&2
echo "Something went wrong!" >&2
exit 1
