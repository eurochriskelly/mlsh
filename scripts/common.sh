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

  # Get the XCC JAR path
  local xcc_jar="${XCC_JAR:-${MLSH_TOP_DIR}/dependencies/xcc.jar}"

  if [ ! -f "$xcc_jar" ]; then
    echo "Error: XCC JAR not found at: $xcc_jar"
    echo "Please install MarkLogic XCC JAR to ~/.mlsh.d/dependencies/xcc.jar"
    return 1
  fi

  # Prepare Java command
  local java_cmd="java -cp \"$xcc_jar\""
  java_cmd="$java_cmd -Dcom.marklogic.xcc.ContentSource=xcc://${ML_USER}:${ML_PASS}@${ML_HOST}:${ML_PORT}/${database}"

  # Run the XQuery script
  echo "Evaluating script: $script"
  echo "Database: $database"
  echo "Server: ${ML_HOST}:${ML_PORT}"

  # This is a placeholder - actual eval implementation would go here
  echo "(XQuery evaluation not fully implemented - placeholder message)"

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
