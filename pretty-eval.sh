#!/bin/bash

# Pretty-print eval.sh results with JSON formatting
# Usage: ./pretty-eval.sh [eval args...]

set -e

# Run eval.sh and capture output
output=$(./scripts/eval.sh "$@" 2>&1)

# Extract content between lines containing at least three consecutive dashes
content=$(echo "$output" \
  | sed -n -E '/-{3,}/,/-{3,}/p' \
  | sed '1d;$d')

# Check if content is JSON
if [[ "$content" =~ ^[[:space:]]*\{ ]] || [[ "$content" =~ ^[[:space:]]*\[ ]]; then
    # Try to format as JSON
    if command -v jq >/dev/null 2>&1; then
        echo "$content" | jq '.'
    elif command -v python3 >/dev/null 2>&1; then
        echo "$content" | python3 -m json.tool
    else
        echo "$content"
    fi
else
    # Not JSON, show original output
    echo "$output"
fi
