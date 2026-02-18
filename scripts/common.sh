#!/bin/bash

#
# Common functions for MLSH scripts
#

# LL - Log Line (logging function)
LL() {
  if [ "$MLSH_DEBUG" = "1" ]; then
    echo "[MLSH DEBUG] $@" >&2
  fi
}

# doEval - Evaluate a script against a MarkLogic database
doEval() {
  local script=$1
  local database=$2
  local params=$3

  if [ -z "$script" ]; then
    echo "Error: Script file required"
    return 1
  fi

  if [ ! -f "$script" ]; then
    echo "Error: Script file not found: $script"
    return 1
  fi

  if [ -z "$database" ]; then
    database="$ML_CONTENT_DB"
  fi

  # Check for XCC JAR (just for info, not actually used)
  local xcc_jar=""
  if [ -n "$XCC_JAR" ] && [ -f "$XCC_JAR" ]; then
    xcc_jar="$XCC_JAR"
  elif [ -f "${MLSH_TOP_DIR}/dependencies/xcc.jar" ]; then
    xcc_jar="${MLSH_TOP_DIR}/dependencies/xcc.jar"
  elif [ -f "${HOME}/.mlsh.d/dependencies/xcc.jar" ]; then
    xcc_jar="${HOME}/.mlsh.d/dependencies/xcc.jar"
  fi

  # Read the script file
  local script_content=$(cat "$script")

  # Create the REST API request - use digest auth for compatibility
  echo "═══════════════════════════════════════════════════════════"
  echo "Evaluating: $(basename "$script")"
  echo "Database: $database"
  echo "Server: ${ML_HOST}:${ML_PORT}"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  # Validate curl is available
  if ! command -v curl &>/dev/null; then
    echo "Error: curl is required for XQuery evaluation"
    return 1
  fi

  # Validate MarkLogic is reachable
  if ! curl -s --max-time 2 --digest -u "${ML_USER}:${ML_PASS}" \
    "http://${ML_HOST}:${ML_PORT}/" >/dev/null 2>&1; then
    echo "Error: Cannot connect to MarkLogic at ${ML_HOST}:${ML_PORT}"
    return 1
  fi

  # Execute the XQuery via REST API
  local rest_url="http://${ML_HOST}:${ML_PORT}/v1/eval"
  local start_time=$(date +%s)

  # Make the request
  local response=$(curl -s --digest -u "${ML_USER}:${ML_PASS}" \
    -X POST "$rest_url" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "xquery=$(printf '%s' "$script_content" | jq -sRr @uri)&db=$database" \
    2>&1)

  local end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  # Parse and display the response
  echo "Result:"
  echo "───────────────────────────────────────────────────────────"
  echo "$response" | grep -v "^--" | grep -v "Content-Type:" | grep -v "X-Primitive:" | grep -v "^$"
  echo "───────────────────────────────────────────────────────────"
  echo "Execution time: ${elapsed}s"
  echo ""

  return 0
}

# showHelp - Display help message
showHelp() {
  local cmd=$1

  case $cmd in
  eval)
    echo "Usage: mlsh eval [options] <script> [database] [params]"
    echo ""
    echo "Evaluate an XQuery or JavaScript script against a MarkLogic database"
    echo ""
    echo "Options:"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Arguments:"
    echo "  script          Path to the script file"
    echo "  database        Target database (default: $ML_CONTENT_DB)"
    echo "  params          Query parameters (key=value format)"
    ;;
  *)
    echo "MLSH - MarkLogic Shell"
    echo ""
    echo "Available commands:"
    echo "  mlsh env        Manage environments"
    echo "  mlsh eval       Evaluate scripts"
    echo "  mlsh logs       View server logs"
    echo "  mlsh mlcp       Run MLCP"
    echo "  mlsh corb       Run CoRB"
    ;;
  esac
}

# mlshUpdate - Update MLSH from GitHub
mlshUpdate() {
  echo "mlsh update - not implemented yet"
  echo "To update, use: npm install -g git+https://github.com/anomalyco/mlsh.git"
}

export -f LL
export -f doEval
export -f showHelp
export -f mlshUpdate
