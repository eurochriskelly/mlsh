#!/bin/bash

main() {
  case $1 in
  list)
    listWorkspaces
    ;;
  pull|download)
    pullQueries "$2"
    ;;
  push|upload)
    pushQueries
    ;;
  *)
    echo "Usage: mlsh qc {list|pull|push}"
    ;;
  esac
}

listWorkspaces() {
  doEval "$MLSH_TOP_DIR/scripts/eval/getWorkspaces.xqy" "App-Services"
}

pullQueries() {
  local workspace=${1:-$(basename "$PWD")}
  echo "Pulling Query Console workspace: $workspace"
  doEval "$MLSH_TOP_DIR/scripts/eval/prepWorkspaces.xqy" "App-Services"
  echo "Use the workspace details above to retrieve the selected queries."
}

pushQueries() {
  if [ ! -f "_workspace.xml" ]; then
    echo "No _workspace.xml found in the current directory."
    return 1
  fi
  echo "Uploading Query Console workspace: $(basename "$PWD")"
  doEval "$MLSH_TOP_DIR/scripts/eval/updateWorkspaces.xqy" "App-Services"
}

main "$@"
