#!/bin/bash

# MLCP Wrapper - runs MarkLogic Content Pump
source $MLSH_TOP_DIR/scripts/common.sh

main() {
  if [ -z "$1" ]; then
    # Interactive mode
    showMenu
  else
    # Direct mode - pass all arguments to runMlcp
    runMlcp "$@"
  fi
}

showMenu() {
  echo "MarkLogic Content Pump (MLCP)"
  echo "============================="
  echo ""
  echo "1. Import       - Import documents into MarkLogic"
  echo "2. Export       - Export documents from MarkLogic"
  echo "3. Copy         - Copy documents between databases"
  echo "4. Help         - Show MLCP help"
  echo ""
  echo -n "Enter your choice (1-4) or command: "
  read choice

  case $choice in
  1)
    importMode
    ;;
  2)
    exportMode
    ;;
  3)
    copyMode
    ;;
  4)
    runMlcp -help
    ;;
  *)
    # Assume user typed a direct MLCP command
    runMlcp "$choice"
    ;;
  esac
}

importMode() {
  echo ""
  echo "MLCP Import"
  echo "-----------"
  echo ""

  read -p "Input file path: " input_path
  read -p "Input format (json/xml/text/binary): " input_type
  read -p "Output collections (csv): " collections
  read -p "Output URI prefix (e.g. /data/): " uri_prefix

  echo ""
  echo "Running: mlcp import"
  echo "  -input_file_path $input_path"
  echo "  -input_file_type $input_type"
  echo "  -output_collections $collections"
  echo "  -output_uri_prefix $uri_prefix"
  echo ""

  read -p "Continue? (y/n): " confirm
  if [ "$confirm" = "y" ]; then
    runMlcp import \
      -input_file_path "$input_path" \
      -input_file_type "$input_type" \
      -output_collections "$collections" \
      -output_uri_prefix "$uri_prefix"
  fi
}

exportMode() {
  echo ""
  echo "MLCP Export"
  echo "-----------"
  echo ""

  read -p "Output file path: " output_path
  read -p "Output format (json/xml/text/binary): " output_type
  read -p "Collection (leave blank for all): " collection
  read -p "Query filter (XPath or leave blank): " query_filter

  echo ""
  echo "Running: mlcp export"
  echo "  -output_file_path $output_path"
  echo "  -output_type $output_type"
  if [ -n "$collection" ]; then
    echo "  -collection_filter $collection"
  fi
  if [ -n "$query_filter" ]; then
    echo "  -query_filter $query_filter"
  fi
  echo ""

  read -p "Continue? (y/n): " confirm
  if [ "$confirm" = "y" ]; then
    local cmd="runMlcp export -output_file_path \"$output_path\" -output_type $output_type"
    if [ -n "$collection" ]; then
      cmd="$cmd -collection_filter \"$collection\""
    fi
    if [ -n "$query_filter" ]; then
      cmd="$cmd -query_filter \"$query_filter\""
    fi
    eval "$cmd"
  fi
}

copyMode() {
  echo ""
  echo "MLCP Copy"
  echo "---------"
  echo ""

  read -p "Source database: " source_db
  read -p "Target database: " target_db
  read -p "Collection (leave blank for all): " collection

  echo ""
  echo "Running: mlcp copy"
  echo "  -copy_from_host $ML_HOST"
  echo "  -copy_from_port $ML_PORT"
  echo "  -copy_from_user $ML_USER"
  echo "  -copy_to_host $ML_HOST"
  echo "  -copy_to_port $ML_PORT"
  echo "  -copy_to_user $ML_USER"
  if [ -n "$collection" ]; then
    echo "  -collection_filter $collection"
  fi
  echo ""

  read -p "Continue? (y/n): " confirm
  if [ "$confirm" = "y" ]; then
    local cmd="runMlcp copy -copy_from_host $ML_HOST -copy_from_port $ML_PORT -copy_from_user $ML_USER -copy_to_host $ML_HOST -copy_to_port $ML_PORT -copy_to_user $ML_USER"
    if [ -n "$collection" ]; then
      cmd="$cmd -collection_filter \"$collection\""
    fi
    eval "$cmd"
  fi
}

main "$@"
