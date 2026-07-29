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

# fetch - Send an authenticated request to the configured MarkLogic REST API.
fetch() {
  local endpoint=$1
  shift
  curl --silent --show-error --digest -u "${ML_USER}:${ML_PASS}" \
    "${ML_PROTOCOL:-http}://${ML_HOST}:${ML_PORT}${endpoint}" "$@"
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

# showLogs - Display MarkLogic error logs via REST API
showLogs() {
  local log_type=$1    # "error" or "access"
  local lines=${2:-50} # Number of lines to show

  if [ -z "$log_type" ]; then
    log_type="error"
  fi

  if ! command -v curl &>/dev/null; then
    echo "Error: curl is required to view logs"
    return 1
  fi

  # Validate MarkLogic is reachable
  if ! curl -s --max-time 2 --digest -u "${ML_USER}:${ML_PASS}" \
    "http://${ML_HOST}:${ML_PORT}/" >/dev/null 2>&1; then
    echo "Error: Cannot connect to MarkLogic at ${ML_HOST}:${ML_PORT}"
    return 1
  fi

  echo "Fetching $log_type logs from ${ML_HOST}:${ML_PORT}..."
  echo "═══════════════════════════════════════════════════════════"

  # Use Management REST API to get logs
  local rest_url="http://${ML_HOST}:${ML_PORT}/manage/v2/logs"

  if [ "$log_type" = "error" ]; then
    rest_url="${rest_url}?log-type=ErrorLog&limit=${lines}"
  elif [ "$log_type" = "access" ]; then
    rest_url="${rest_url}?log-type=AccessLog&limit=${lines}"
  fi

  local response=$(curl -s --digest -u "${ML_USER}:${ML_PASS}" \
    -H "Accept: application/json" \
    "$rest_url" 2>&1)

  # Check if response contains error
  if echo "$response" | grep -q "error"; then
    # Fallback to showing raw logs via XQuery if REST API fails
    echo "Note: Using XQuery to fetch logs (REST API not available on this server)"
    echo ""

    # Create a simple XQuery to get logs
    local tmp_xqy=$(mktemp)
    cat >"$tmp_xqy" <<'EOF'
xdmp:get-request-error-log(xdmp:request-timestamp(xdmp:request()) - 300, fn:current-dateTime())[1 to 50]
EOF
    doEval "$tmp_xqy"
    rm -f "$tmp_xqy"
  else
    # Pretty-print JSON response
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
    echo "═══════════════════════════════════════════════════════════"
  fi
}

# runMlcp - Run MarkLogic Content Pump
runMlcp() {
  local mlcp_path="${MLCP_PATH}"

  # Try multiple locations for MLCP
  if [ -z "$mlcp_path" ]; then
    if [ -f "${HOME}/.mlsh.d/dependencies/mlcp/bin/mlcp.sh" ]; then
      mlcp_path="${HOME}/.mlsh.d/dependencies/mlcp/bin/mlcp.sh"
    elif [ -f "${MLSH_TOP_DIR}/dependencies/mlcp/bin/mlcp.sh" ]; then
      mlcp_path="${MLSH_TOP_DIR}/dependencies/mlcp/bin/mlcp.sh"
    fi
  fi

  if [ ! -f "$mlcp_path" ]; then
    echo "Error: MLCP not found"
    echo "Checked locations:"
    echo "  - ${HOME}/.mlsh.d/dependencies/mlcp/bin/mlcp.sh"
    echo "  - ${MLSH_TOP_DIR}/dependencies/mlcp/bin/mlcp.sh"
    return 1
  fi

  echo "Running MLCP with arguments: $@"
  echo "═══════════════════════════════════════════════════════════"

  # Extract the command (first argument)
  local cmd="$1"
  shift # Remove the command from arguments

  # Build the command: mlcp COMMAND [options]
  local mlcp_cmd="$mlcp_path $cmd"

  # Add connection options unless it's a help/version command
  if [ "$cmd" != "help" ] && [ "$cmd" != "version" ] && [ "$cmd" != "HELP" ] && [ "$cmd" != "VERSION" ]; then
    mlcp_cmd="$mlcp_cmd -host $ML_HOST"
    mlcp_cmd="$mlcp_cmd -port $ML_PORT"
    mlcp_cmd="$mlcp_cmd -username $ML_USER"
    mlcp_cmd="$mlcp_cmd -password $ML_PASS"
  fi

  # Add any additional arguments passed to this function
  if [ $# -gt 0 ]; then
    mlcp_cmd="$mlcp_cmd $@"
  fi

  # Execute MLCP
  eval "$mlcp_cmd"

  local exit_code=$?
  echo "═══════════════════════════════════════════════════════════"
  echo "MLCP completed with exit code: $exit_code"

  return $exit_code
}

# runCorb - Run MarkLogic CoRB (Content Operations for MarkLogic)
runCorb() {
  local corb_jar="${CORB_JAR}"

  # Try multiple locations for CoRB
  if [ -z "$corb_jar" ]; then
    if [ -f "${HOME}/.mlsh.d/dependencies/corb.jar" ]; then
      corb_jar="${HOME}/.mlsh.d/dependencies/corb.jar"
    elif [ -f "${MLSH_TOP_DIR}/dependencies/corb.jar" ]; then
      corb_jar="${MLSH_TOP_DIR}/dependencies/corb.jar"
    fi
  fi

  if [ ! -f "$corb_jar" ]; then
    echo "Error: CoRB JAR not found"
    echo "Checked locations:"
    echo "  - ${HOME}/.mlsh.d/dependencies/corb.jar"
    echo "  - ${MLSH_TOP_DIR}/dependencies/corb.jar"
    return 1
  fi

  if ! command -v java &>/dev/null; then
    echo "Error: Java is required to run CoRB"
    return 1
  fi

  echo "Running CoRB with arguments: $@"
  echo "═══════════════════════════════════════════════════════════"

  # Locate XCC JAR
  local xcc_jar="${XCC_JAR}"
  if [ -z "$xcc_jar" ]; then
    if [ -f "${HOME}/.mlsh.d/dependencies/xcc.jar" ]; then
      xcc_jar="${HOME}/.mlsh.d/dependencies/xcc.jar"
    elif [ -f "${MLSH_TOP_DIR}/dependencies/xcc.jar" ]; then
      xcc_jar="${MLSH_TOP_DIR}/dependencies/xcc.jar"
    fi
  fi

  # Build Java command with CoRB JAR and XCC JAR in classpath
  local corb_cmd="java -cp ${corb_jar}:${xcc_jar} com.marklogic.developer.corb.Manager"

  # Add connection URI and options only if not asking for help/version
  local first_arg="$1"
  if [ "$first_arg" != "help" ] && [ "$first_arg" != "-h" ] && [ "$first_arg" != "--help" ]; then
    corb_cmd="$corb_cmd -Dml.connectionuri=xcc://${ML_USER}:${ML_PASS}@${ML_HOST}:${ML_PORT}/"
  fi

  # Add any additional arguments passed to this function
  if [ $# -gt 0 ]; then
    corb_cmd="$corb_cmd $@"
  fi

  # Execute CoRB
  eval "$corb_cmd"

  local exit_code=$?
  echo "═══════════════════════════════════════════════════════════"
  echo "CoRB completed with exit code: $exit_code"

  return $exit_code
}

export -f LL
export -f fetch
export -f doEval
export -f showHelp
export -f mlshUpdate
export -f showLogs
export -f runMlcp
export -f runCorb
