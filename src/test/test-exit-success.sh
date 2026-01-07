#!/bin/bash
# Test script that exits successfully (exit code 0)
# Usage: ./test-exit-success.sh [seconds]

WAIT_SECONDS=${1:-5}

echo "Starting successful task..."
echo "Will complete in ${WAIT_SECONDS} seconds"

for i in $(seq 1 $WAIT_SECONDS); do
  echo "[$(date '+%H:%M:%S')] Working... ($i/$WAIT_SECONDS)"
  sleep 1
done

echo "Task completed successfully!"
exit 0
