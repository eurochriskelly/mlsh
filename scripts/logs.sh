#!/bin/bash

# Log analysis tasks
source $MLSH_TOP_DIR/scripts/common.sh

main() {
  local option=$1
  local logtype=${2:-error}

  if [ -z "$option" ]; then
    # Ask user to select from known options
    echo "MarkLogic Log Viewer"
    echo "===================="
    echo ""
    echo "1. show-errors   - Display recent error log entries"
    echo "2. show-access   - Display recent access log entries"
    echo "3. search        - Search logs for a pattern"
    echo "4. follow        - Follow logs in real-time"
    echo ""
    echo -n "Enter your choice (1-4): "
    read choice
    case $choice in
    1) option="show-errors" ;;
    2) option="show-access" ;;
    3) option="search" ;;
    4) option="follow" ;;
    *)
      echo "Unknown option [$choice]"
      return 1
      ;;
    esac
  fi

  case $option in
  show-errors)
    showLogs "error" 50
    ;;

  show-access)
    showLogs "access" 50
    ;;

  search)
    shift
    search "$@"
    ;;

  follow)
    follow $logtype
    ;;

  *)
    echo "Unknown option [$option]"
    echo "Please select an option [show-errors/show-access/search/follow]"
    echo "e.g. mlsh logs show-errors"
    return 1
    ;;
  esac
}

search() {
  local pattern=$1
  if [ -z "$pattern" ]; then
    echo -n "Please enter a search pattern (e.g. 'XDMP-AS'): "
    read pattern
  fi

  echo "Searching logs for pattern: $pattern"
  echo "═══════════════════════════════════════════════════════════"

  # Create XQuery to search logs
  local tmp_xqy=$(mktemp)
  cat >"$tmp_xqy" <<EOF
(: Search logs for pattern :)
let \$logs := xdmp:get-request-error-log(xdmp:request-timestamp(xdmp:request()) - 3600, fn:current-dateTime())
return \$logs[contains(., '$pattern')]
EOF

  doEval "$tmp_xqy"
  rm -f "$tmp_xqy"
}

follow() {
  local logtype=$1
  echo "Following logs (press Ctrl+C to stop)..."
  echo "═══════════════════════════════════════════════════════════"

  case $logtype in
  error)
    while true; do
      showLogs "error" 20
      echo ""
      echo "Waiting 5 seconds for new logs..."
      sleep 5
    done
    ;;
  access)
    while true; do
      showLogs "access" 20
      echo ""
      echo "Waiting 5 seconds for new logs..."
      sleep 5
    done
    ;;
  *)
    echo "Unknown log type [$logtype]. Must be one of [error|access]"
    return 1
    ;;
  esac
}

main "$@"
