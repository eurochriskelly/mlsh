#!/bin/bash

#
# Common functions for MLSH scripts
#

#
# ---------------------------------------------------------------------------
# Logging
#
# mlsh.log is a structured diagnostic log, NOT a terminal transcript. Every
# line is "<utc-timestamp> <LEVEL> [<scope>] <message>" with no ANSI codes.
# The terminal transcript lives separately in mlsh-session.log.
#
# Levels: trace < debug < info < warn < error < off
# Configure with MLSH_LOG_LEVEL (default: info). MLSH_DEBUG=1 is shorthand for
# MLSH_LOG_LEVEL=debug and also mirrors log lines to stderr.
# ---------------------------------------------------------------------------
#
: "${MLSH_LOG_FILE:=$HOME/.mlsh/mlsh.log}"
if [ "$MLSH_DEBUG" = "1" ]; then
  : "${MLSH_LOG_LEVEL:=debug}"
else
  : "${MLSH_LOG_LEVEL:=info}"
fi

# mlshLogLevelNum - Map a level name to a comparable number.
mlshLogLevelNum() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
  trace) echo 10 ;;
  debug) echo 20 ;;
  info) echo 30 ;;
  warn | warning) echo 40 ;;
  error) echo 50 ;;
  off | none | silent) echo 99 ;;
  *) echo 30 ;;
  esac
}

# mlshRedact - Strip secrets out of text destined for the log.
mlshRedact() {
  local text=$1
  if [ -n "$ML_PASS" ]; then
    text=${text//"$ML_PASS"/********}
  fi
  printf '%s' "$text"
}

# mlshLog - Write one structured line to the diagnostic log.
# Usage: mlshLog <level> <message...>
mlshLog() {
  local level=$1
  shift
  [ "$(mlshLogLevelNum "$level")" -lt "$(mlshLogLevelNum "$MLSH_LOG_LEVEL")" ] && return 0

  local dir
  dir=$(dirname "$MLSH_LOG_FILE")
  [ -d "$dir" ] || mkdir -p "$dir" 2>/dev/null || return 0

  local line
  line=$(printf '%s %-5s [%s] %s' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    "$(printf '%s' "$level" | tr '[:lower:]' '[:upper:]')" \
    "${MLSH_LOG_SCOPE:-mlsh}" \
    "$(mlshRedact "$*")")

  printf '%s\n' "$line" >>"$MLSH_LOG_FILE" 2>/dev/null
  if [ "$MLSH_DEBUG" = "1" ]; then
    printf '%s\n' "$line" >&2
  fi
}

logTrace() { mlshLog trace "$@"; }
logDebug() { mlshLog debug "$@"; }
logInfo() { mlshLog info "$@"; }
logWarn() { mlshLog warn "$@"; }
logError() { mlshLog error "$@"; }

# LL - Log Line. Retained for backwards compatibility; now a debug alias.
LL() { mlshLog debug "$@"; }

# mlshLogBlock - Log a multi-line payload with each line prefixed, at a level.
# Usage: mlshLogBlock <level> <label> <text>
mlshLogBlock() {
  local level=$1 label=$2 text=$3
  [ "$(mlshLogLevelNum "$level")" -lt "$(mlshLogLevelNum "$MLSH_LOG_LEVEL")" ] && return 0
  local line
  while IFS= read -r line; do
    mlshLog "$level" "$label | $line"
  done <<<"$text"
}

# mlshCurlLine - Render curl args as a copy-pasteable, password-redacted command.
# Usage: mlshCurlLine <max-arg-len|0 for unlimited> <curl args...>
# Long arguments (inline XQuery, mostly) are elided so the default-level log
# stays readable; the untruncated command is logged at debug.
mlshCurlLine() {
  local maxlen=$1
  shift
  local rendered="curl" arg
  for arg in "$@"; do
    if [ "$maxlen" -gt 0 ] && [ "${#arg}" -gt "$maxlen" ]; then
      arg="${arg:0:$maxlen}... <elided, ${#arg} chars>"
    fi
    case "$arg" in
    *[[:space:]\'\"\$\&\|\;\<\>\(\)\*\?]*) rendered="$rendered '${arg//\'/\'\\\'\'}'" ;;
    "") rendered="$rendered ''" ;;
    *) rendered="$rendered $arg" ;;
    esac
  done
  mlshRedact "$rendered"
}

# mlshCurl - Run curl with full request/response logging.
#
# Writes the response body to the file named by $2 and echoes the HTTP status
# code on stdout. Returns curl's exit code.
# Usage: mlshCurl <label> <body-file> <curl args...>
mlshCurl() {
  local label=$1 body_file=$2
  shift 2

  logInfo "$label request: $(mlshCurlLine 160 "$@")"
  logDebug "$label request (full): $(mlshCurlLine 0 "$@")"

  local start_ms end_ms
  start_ms=$(date +%s)

  local http_code
  http_code=$(curl "$@" -o "$body_file" -w '%{http_code}' 2>>"$MLSH_LOG_FILE")
  local rc=$?

  end_ms=$(date +%s)
  local bytes=0
  [ -f "$body_file" ] && bytes=$(wc -c <"$body_file" | tr -d ' ')

  if [ "$rc" -ne 0 ]; then
    logError "$label transport failure: curl exit=$rc after $((end_ms - start_ms))s"
  else
    logInfo "$label response: status=$http_code bytes=$bytes elapsed=$((end_ms - start_ms))s"
  fi

  # Failure bodies are logged at warn so they are visible at the default level;
  # successful bodies only at trace, to keep the log small.
  if [ -f "$body_file" ] && [ "$bytes" -gt 0 ]; then
    case "$http_code" in
    2*) mlshLogBlock trace "$label body" "$(cat "$body_file")" ;;
    *) mlshLogBlock warn "$label body" "$(cat "$body_file")" ;;
    esac
  fi

  printf '%s' "$http_code"
  return $rc
}

# fetch - Send an authenticated request to the configured MarkLogic REST API.
fetch() {
  local endpoint=$1
  shift
  local url="${ML_PROTOCOL:-http}://${ML_HOST}:${ML_PORT}${endpoint}"
  local body_file
  body_file=$(mktemp "${TMPDIR:-/tmp}/mlsh-fetch.XXXXXX")

  local curl_args=(--silent --show-error --digest -u "${ML_USER}:${ML_PASS}" "$url" "$@")
  local http_code
  http_code=$(mlshCurl "fetch ${endpoint%%\?*}" "$body_file" "${curl_args[@]}")
  local rc=$?

  cat "$body_file"
  rm -f "$body_file"

  if [ "$rc" -ne 0 ]; then
    return $rc
  fi
  case "$http_code" in
  2*) return 0 ;;
  *)
    logError "fetch $endpoint returned HTTP $http_code"
    return 1
    ;;
  esac
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

  logInfo "eval script=$script database=$database params=${params:-none} target=${ML_HOST}:${ML_PORT}"
  mlshLogBlock trace "eval source" "$script_content"

  if [ "$MLSH_EVAL_QUIET" != "1" ]; then
    echo "═══════════════════════════════════════════════════════════"
    echo "Evaluating: $(basename "$script")"
    echo "Database: $database"
    echo "Server: ${ML_HOST}:${ML_PORT}"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
  fi

  # Validate curl is available
  if ! command -v curl &>/dev/null; then
    logError "curl not found on PATH"
    echo "Error: curl is required for XQuery evaluation"
    return 1
  fi

  # Validate MarkLogic is reachable
  if ! curl -s --max-time 2 --digest -u "${ML_USER}:${ML_PASS}" \
    "${ML_PROTOCOL:-http}://${ML_HOST}:${ML_PORT}/" >/dev/null 2>&1; then
    logError "cannot reach MarkLogic at ${ML_HOST}:${ML_PORT}"
    echo "Error: Cannot connect to MarkLogic at ${ML_HOST}:${ML_PORT}"
    return 1
  fi

  # Execute the XQuery via REST API
  local rest_url="${ML_PROTOCOL:-http}://${ML_HOST}:${ML_PORT}/v1/eval"

  # Pass the query by file reference rather than inline. Functionally identical
  # to --data-urlencode "xquery=<contents>", but it keeps the logged curl
  # command on a single line and therefore actually copy-pasteable.
  local curl_args=(
    -sS --digest -u "${ML_USER}:${ML_PASS}"
    -X POST "$rest_url"
    -H "Content-Type: application/x-www-form-urlencoded"
    --data-urlencode "xquery@${script}"
    --data-urlencode "db=$database"
  )
  if [ -n "$params" ]; then
    curl_args+=(--data-urlencode "vars=$params")
  fi

  local body_file
  body_file=$(mktemp "${TMPDIR:-/tmp}/mlsh-eval.XXXXXX")

  local start_time=$(date +%s)
  local http_code
  http_code=$(mlshCurl "eval $(basename "$script")" "$body_file" "${curl_args[@]}")
  local curl_rc=$?
  local end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  local response
  response=$(cat "$body_file")
  rm -f "$body_file"

  # A transport failure or non-2xx status is an error. Surface it and fail so
  # callers can distinguish "no results" from "the query blew up".
  if [ "$curl_rc" -ne 0 ] || [ "${http_code#2}" = "$http_code" ]; then
    logError "eval failed script=$script database=$database status=${http_code:-none} curl_exit=$curl_rc"
    echo "Error: eval of $(basename "$script") failed against '$database' (HTTP ${http_code:-transport-error})"
    printf '%s\n' "$(mlshEvalErrorDetail "$response")"
    echo "See $MLSH_LOG_FILE for the full request and response."
    return 1
  fi

  logInfo "eval ok script=$(basename "$script") database=$database elapsed=${elapsed}s"

  if [ "$MLSH_EVAL_QUIET" = "1" ]; then
    printf '%s\n' "$response"
  else
    echo "Result:"
    echo "───────────────────────────────────────────────────────────"
    echo "$response" | grep -v "^--" | grep -v "Content-Type:" | grep -v "X-Primitive:" | grep -v "^$"
    echo "───────────────────────────────────────────────────────────"
    echo "Execution time: ${elapsed}s"
    echo ""
  fi

  return 0
}

# mlshEvalErrorDetail - Pull the human-readable bits out of a MarkLogic error
# payload (JSON or XML), falling back to the raw body.
mlshEvalErrorDetail() {
  local body=$1
  local detail=""

  if command -v jq &>/dev/null; then
    detail=$(printf '%s' "$body" | jq -r '
      .errorResponse // empty
      | "  \(.messageCode // "?"): \(.message // "")\n  \(.formatString // "")"
    ' 2>/dev/null)
  fi

  if [ -z "$detail" ]; then
    detail=$(printf '%s' "$body" |
      grep -oE '(XDMP|SEC|REST|MANAGE)-[A-Z0-9]+[^<"]*' | head -n 5 | sed 's/^/  /')
  fi

  if [ -z "$detail" ]; then
    detail=$(printf '%s' "$body" | head -n 20 | sed 's/^/  /')
  fi

  printf '%s' "$detail"
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

export MLSH_LOG_FILE
export MLSH_LOG_LEVEL
export -f mlshLogLevelNum
export -f mlshRedact
export -f mlshLog
export -f mlshLogBlock
export -f mlshCurlLine
export -f mlshCurl
export -f mlshEvalErrorDetail
export -f logTrace
export -f logDebug
export -f logInfo
export -f logWarn
export -f logError
export -f LL
export -f fetch
export -f doEval
export -f showHelp
export -f mlshUpdate
export -f showLogs
export -f runMlcp
export -f runCorb
