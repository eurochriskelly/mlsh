#!/bin/bash

# CoRB Wrapper - Runs MarkLogic Content Operations for MarkLogic
source $MLSH_TOP_DIR/scripts/common.sh

main() {
  if [ -z "$1" ]; then
    # Interactive mode
    showMenu
  else
    # Direct mode - pass all arguments to runCorb
    runCorb "$@"
  fi
}

showMenu() {
  echo "MarkLogic CoRB (Content Operations for MarkLogic)"
  echo "=================================================="
  echo ""
  echo "1. run        - Run a CoRB task"
  echo "2. help       - Show CoRB help"
  echo ""
  echo -n "Enter your choice (1-2) or command: "
  read choice

  case $choice in
  1)
    runMode
    ;;
  2)
    runCorb -h
    ;;
  *)
    # Assume user typed a direct CoRB command
    runCorb "$choice"
    ;;
  esac
}

runMode() {
  echo ""
  echo "CoRB Task Execution"
  echo "-------------------"
  echo ""

  read -p "CoRB options (e.g., -XDBC-URI=... -URIS-MODULE=...): " corb_options

  echo ""
  echo "Running: corb $corb_options"
  echo ""

  read -p "Continue? (y/n): " confirm
  if [ "$confirm" = "y" ]; then
    runCorb $corb_options
  fi
}

main "$@"
