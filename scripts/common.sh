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

  # Check for XCC JAR in multiple locations
  local xcc_jar=""

  # Try explicit XCC_JAR environment variable first
  if [ -n "$XCC_JAR" ] && [ -f "$XCC_JAR" ]; then
    xcc_jar="$XCC_JAR"
  # Try MLSH_TOP_DIR/dependencies
  elif [ -f "${MLSH_TOP_DIR}/dependencies/xcc.jar" ]; then
    xcc_jar="${MLSH_TOP_DIR}/dependencies/xcc.jar"
  # Try ~/.mlsh.d/dependencies (fallback for old installations)
  elif [ -f "${HOME}/.mlsh.d/dependencies/xcc.jar" ]; then
    xcc_jar="${HOME}/.mlsh.d/dependencies/xcc.jar"
  fi

  if [ -z "$xcc_jar" ] || [ ! -f "$xcc_jar" ]; then
    echo "Error: MarkLogic XCC JAR not found"
    echo ""
    echo "mlsh eval requires the MarkLogic XCC (XQuery Connector for Java) JAR"
    echo ""
    echo "Checked locations:"
    echo "  - \$XCC_JAR (not set)"
    echo "  - ${MLSH_TOP_DIR}/dependencies/xcc.jar"
    echo "  - ${HOME}/.mlsh.d/dependencies/xcc.jar"
    echo ""
    echo "To fix this, download xcc.jar from your MarkLogic installation and place it at:"
    echo "  ${MLSH_TOP_DIR}/dependencies/xcc.jar"
    echo ""
    echo "Or set the XCC_JAR environment variable:"
    echo "  export XCC_JAR=/path/to/xcc.jar"
    return 1
  fi

  # For now, just show what would happen
  echo "✓ Script: $script"
  echo "✓ Database: $database"
  echo "✓ Server: ${ML_HOST}:${ML_PORT} (user: ${ML_USER})"
  echo "✓ XCC JAR: $xcc_jar"
  echo ""
  echo "Note: XQuery evaluation would execute here if MarkLogic were running."
  echo "The eval.sh script requires further implementation to connect and execute."

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
