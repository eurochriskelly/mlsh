#!/bin/bash

SCRIPT_DIR=$(dirname "$0")

main() {
  local command=$1
  case $command in
  list)
    doEval "$SCRIPT_DIR/backup/folders.js" "Security"
    ;;
  create)
    doEval "$SCRIPT_DIR/backup/backup.js" "Security"
    ;;
  delete)
    doEval "$SCRIPT_DIR/backup/delete.js" "Security"
    ;;
  *)
    echo "Usage: mlsh backup {list|create|delete}"
    ;;
  esac
}

main "$@"
