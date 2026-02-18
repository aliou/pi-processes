#!/bin/bash
# Test script for processes extension
# Writes 80 characters every second, empty line every 10 seconds

counter=0
while true; do
  counter=$((counter + 1))
  
  # Generate 80 characters: timestamp + padding
  timestamp=$(date '+%H:%M:%S')
  line=$(printf "[%s] Line %05d: " "$timestamp" "$counter")
  # Pad to 80 chars with random chars
  padding_len=$((80 - ${#line}))
  padding=$(head -c $padding_len /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' 2>/dev/null || printf '%*s' "$padding_len" '' | tr ' ' 'x')
  echo "${line}${padding}"
  
  # Every 10 seconds, print an empty line
  if [ $((counter % 10)) -eq 0 ]; then
    echo ""
  fi
  
  # Every 5 lines, write something to stderr
  if [ $((counter % 5)) -eq 0 ]; then
    echo "[WARN] Counter reached $counter" >&2
  fi
  
  sleep 1
done
