#!/bin/bash

source "$MLSH_TOP_DIR/scripts/common.sh"
export MLSH_LOG_SCOPE=modules

TODAY=$(date +%Y%m%d)
MODULE_FIND_LIMIT=${MLSH_MODULE_FIND_LIMIT:-200}
# Give the server slightly less time than the client's curl --max-time
# (MLSH_CURL_TIMEOUT, default 120s in common.sh) so we get MarkLogic's own
# XDMP-EXTIME error instead of the client cutting the connection first.
MODULE_FIND_TIMEOUT=${MLSH_MODULE_FIND_TIMEOUT:-90}
# How many module downloads/uploads to run concurrently. Each file is an
# independent HTTP request, so batching them in parallel turns an N-file
# operation from N sequential round-trips into ceil(N/concurrency).
MODULE_CONCURRENCY=${MLSH_MODULE_CONCURRENCY:-4}

main() {
  local option=$1
  case $option in
  find|retrieve|match|search)
    shift
    findModules "$@"
    ;;
  load|update)
    loadModules
    ;;
  loadOne)
    loadModules one
    ;;
  reset)
    loadModules reset
    ;;
  clone)
    cloneModule
    ;;
  *)
    echo "Usage: mlsh modules {find <pattern>|load|loadOne|clone|reset}"
    ;;
  esac
}

# jsonEscape - Escape a value for embedding in a JSON string literal.
jsonEscape() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s' "$value"
}

# normalisePattern - Make bare terms behave the way people expect.
# 'trans' becomes '*trans*'; anything already containing a wildcard is left be.
normalisePattern() {
  local pattern=$1
  case "$pattern" in
  *'*'* | *'?'*) printf '%s' "$pattern" ;;
  *) printf '*%s*' "$pattern" ;;
  esac
}

findModules() {
  local pattern=$1
  local directory="modules_${TODAY}"

  if [ -z "$pattern" ]; then
    read -r -p "Pattern to match (for example, *foo.xqy): " pattern
  fi
  if [ -z "$pattern" ]; then
    echo "No pattern given."
    return 1
  fi

  local search
  search=$(normalisePattern "$pattern")

  if [ -z "$ML_MODULES_DB" ]; then
    logError "ML_MODULES_DB is not set for env ${ML_ENV:-none}"
    echo "No modules database configured. Run 'mlsh env' and set the modules database."
    return 1
  fi

  logInfo "find pattern='$pattern' normalised='$search' target-db='$ML_MODULES_DB' eval-db='${ML_CONTENT_DB:-default}' limit=$MODULE_FIND_LIMIT timeout=${MODULE_FIND_TIMEOUT}s"

  local vars
  vars=$(printf '{"pattern":"%s","limit":"%s","timeoutSeconds":"%s","targetDatabase":"%s"}' \
    "$(jsonEscape "$search")" "$(jsonEscape "$MODULE_FIND_LIMIT")" \
    "$(jsonEscape "$MODULE_FIND_TIMEOUT")" "$(jsonEscape "$ML_MODULES_DB")")

  # Deliberately do NOT pass $ML_MODULES_DB as the REST eval "database" field
  # here. Doing so makes the REST /v1/eval evaluator itself set up its
  # request context against that database before our script even runs - and
  # if FS-modules (or whichever modules db) isn't a fully-fledged content
  # database from the REST layer's point of view, that setup can hang
  # indefinitely, indistinguishable from a slow query. Instead we evaluate
  # against the normal content database and have moduleLister.xqy hop into
  # $targetDatabase itself via xdmp:invoke-function (same technique
  # scripts/eval.sh's modulesWrapper already uses).
  local results status
  results=$(MLSH_EVAL_QUIET=1 doEval \
    "$MLSH_TOP_DIR/scripts/eval/moduleLister.xqy" "$ML_CONTENT_DB" "$vars")
  status=$?

  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$results"
    return 1
  fi

  # The multipart response uses CRLF; strip the CRs before any line matching.
  results=${results//$'\r'/}

  # The server reports how it searched and why a result set may be empty.
  local diagnostics
  diagnostics=$(printf '%s\n' "$results" | grep '^MLSH-DIAG:' | sed 's/^MLSH-DIAG://')
  if [ -n "$diagnostics" ]; then
    while IFS= read -r diag; do
      logInfo "server: $diag"
    done <<<"$diagnostics"
  fi

  local matches=()
  local line
  while IFS= read -r line; do
    case "$line" in
    MLSH-DIAG:*) continue ;;
    *'~'*'~'*'~EOL') matches+=("$line") ;;
    esac
  done <<<"$results"

  if [ "${#matches[@]}" -eq 0 ]; then
    echo "No modules match '$search' in $ML_MODULES_DB."
    if [ -n "$diagnostics" ]; then
      echo "Server diagnostics:"
      printf '%s\n' "$diagnostics" | sed 's/^/  /'
    fi
    echo "Details in $MLSH_LOG_FILE (run 'debug on' for the full request/response)."
    return 0
  fi

  logInfo "find matched ${#matches[@]} module(s)"
  echo "Matching modules:"
  local index=1
  for line in "${matches[@]}"; do
    echo "  ${index}. ${line%%~*}"
    index=$((index + 1))
  done
  read -r -p "Numbers to download (for example, 1,3), ALL, or Enter to cancel: " choices
  [ -z "$choices" ] && return
  mkdir -p "$directory/originals" "$directory/edited"
  if [ "$choices" = "ALL" ]; then choices=$(seq -s, 1 $((index - 1))); fi
  local selected=" ${choices//,/ } "

  # Collect the lines to download first, then fetch them $MODULE_CONCURRENCY
  # at a time in the background, instead of one full request-response
  # round-trip after another.
  local to_download=()
  index=1
  for line in "${matches[@]}"; do
    [[ "$selected" == *" $index "* ]] && to_download+=("$line")
    index=$((index + 1))
  done

  local failures_file
  failures_file=$(mktemp "${TMPDIR:-/tmp}/mlsh-dl-failures.XXXXXX")

  local total=${#to_download[@]}
  local i=0
  while [ "$i" -lt "$total" ]; do
    local batch_end=$((i + MODULE_CONCURRENCY))
    [ "$batch_end" -gt "$total" ] && batch_end=$total
    local j
    for ((j = i; j < batch_end; j++)); do
      downloadOneModule "$directory" "$failures_file" "${to_download[j]}" &
    done
    wait
    i=$batch_end
  done

  if [ -s "$failures_file" ]; then
    echo "Some modules failed to download:"
    sed 's/^/  /' "$failures_file"
  fi
  rm -f "$failures_file"

  echo "Edit files in $directory/edited, then run: mlsh modules load"
}

# downloadOneModule - Fetch one module and record it in module-info.txt.
# Designed to be run standalone in a background job (see the batch loop in
# findModules), so any failure is recorded to $failures_file rather than
# aborting sibling jobs already in flight.
downloadOneModule() {
  local directory=$1 failures_file=$2 line=$3
  local uri=${line%%~*}
  local local_name=${line#*~}
  local_name=${local_name%%~*}

  logInfo "downloading $uri -> $directory/originals/$local_name"
  if ! fetch "/v1/documents?uri=${uri}&database=${ML_MODULES_DB}" -X GET >"$directory/originals/$local_name"; then
    echo "$uri" >>"$failures_file"
    echo "FAILED to download $uri"
    return 1
  fi
  printf '%s\n' "$line" >>"$directory/module-info.txt"
  cp "$directory/originals/$local_name" "$directory/edited/$local_name"
  echo "Downloaded $uri"
}

loadModules() {
  local mode=$1
  local directory="modules_${TODAY}"
  if [ ! -f "$directory/module-info.txt" ]; then
    echo "No module list found. Run 'mlsh modules find' first."
    return 1
  fi

  # Load module-info.txt into an array so "one" mode can offer a numbered
  # pick-list, the same way 'modules find' does.
  local entries=()
  while IFS= read -r line; do
    [ -n "$line" ] && entries+=("$line")
  done <"$directory/module-info.txt"

  if [ "${#entries[@]}" -eq 0 ]; then
    echo "No modules found in $directory/module-info.txt."
    return 1
  fi

  local selected_indices=" "
  if [ "$mode" = "one" ]; then
    echo "Modules available to load:"
    local index=1
    for line in "${entries[@]}"; do
      echo "  ${index}. ${line%%~*}"
      index=$((index + 1))
    done
    read -r -p "Numbers to load (for example, 1,3), ALL, or Enter to cancel: " choices
    if [ -z "$choices" ]; then
      echo "Cancelled."
      return 0
    fi
    if [ "$choices" = "ALL" ]; then choices=$(seq -s, 1 $((index - 1))); fi
    selected_indices=" ${choices//,/ } "
  fi

  local index=1
  local to_load=()
  for line in "${entries[@]}"; do
    if [ "$mode" = "one" ] && [[ "$selected_indices" != *" $index "* ]]; then
      index=$((index + 1))
      continue
    fi
    index=$((index + 1))
    to_load+=("$line")
  done

  local failures_file
  failures_file=$(mktemp "${TMPDIR:-/tmp}/mlsh-load-failures.XXXXXX")

  local total=${#to_load[@]}
  local i=0
  while [ "$i" -lt "$total" ]; do
    local batch_end=$((i + MODULE_CONCURRENCY))
    [ "$batch_end" -gt "$total" ] && batch_end=$total
    local j
    for ((j = i; j < batch_end; j++)); do
      loadOneModuleFile "$directory" "$mode" "$failures_file" "${to_load[j]}" &
    done
    wait
    i=$batch_end
  done

  if [ -s "$failures_file" ]; then
    echo "Some modules failed to load:"
    sed 's/^/  /' "$failures_file"
  fi
  rm -f "$failures_file"
}

# loadOneModuleFile - PUT one edited (or original, in reset mode) module file
# back to MarkLogic. Designed to run standalone in a background job (see the
# batch loop in loadModules), so a failure is recorded to $failures_file
# rather than aborting sibling jobs already in flight.
loadOneModuleFile() {
  local directory=$1 mode=$2 failures_file=$3 line=$4

  local uri=${line%%~*}
  local rest=${line#*~}
  local local_name=${rest%%~*}

  local source_file="$directory/edited/$local_name"
  [ "$mode" = "reset" ] && source_file="$directory/originals/$local_name"
  if [ ! -f "$source_file" ]; then
    echo "Skipping $uri: $source_file not found."
    return 0
  fi

  local url="${ML_PROTOCOL:-http}://${ML_HOST}:${ML_PORT}/v1/documents?uri=${uri}&database=${ML_MODULES_DB}"
  local body_file
  body_file=$(mktemp "${TMPDIR:-/tmp}/mlsh-load.XXXXXX")
  local http_code
  http_code=$(mlshCurl "load $uri" "$body_file" \
    --silent --show-error --digest -u "$ML_USER:$ML_PASS" -X PUT -T "$source_file" "$url")
  local rc=$?
  if [ "$rc" -ne 0 ] || [ "${http_code#2}" = "$http_code" ]; then
    echo "$uri" >>"$failures_file"
    echo "FAILED to load $uri (HTTP ${http_code:-transport-error})"
    sed 's/^/  /' "$body_file"
  else
    echo "Loaded $uri"
  fi
  rm -f "$body_file"
}

cloneModule() {
  local directory="modules_${TODAY}"
  [ -f "$directory/module-info.txt" ] || { echo "Run 'mlsh modules find' first."; return 1; }
  read -r -p "Module file name to clone: " source_name
  read -r -p "New module file name: " target_name
  [ -n "$source_name" ] && [ -n "$target_name" ] || return
  cp "$directory/originals/$source_name" "$directory/originals/$target_name"
  cp "$directory/edited/$source_name" "$directory/edited/$target_name"
  echo "Cloned $source_name to $target_name. Add its destination URI to $directory/module-info.txt before loading."
}

main "$@"
