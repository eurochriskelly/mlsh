#!/bin/bash

TODAY=$(date +%Y%m%d)

main() {
  local option=$1
  case $option in
  find|retrieve|match|search)
    findModules "$2"
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

findModules() {
  local pattern=$1
  local directory="modules_${TODAY}"
  if [ -z "$pattern" ]; then
    read -r -p "Pattern to match (for example, *foo.xqy): " pattern
  fi
  local results
  results=$(MLSH_EVAL_QUIET=1 doEval "$MLSH_TOP_DIR/scripts/eval/moduleLister.xqy" "$ML_MODULES_DB" "{\"pattern\":\"${pattern}\"}") || {
    printf '%s\n' "$results"
    return 1
  }
  local matches=()
  while IFS= read -r line; do
    [ -n "$line" ] && [[ "$line" == *"~"* ]] && matches+=("$line")
  done <<< "$results"
  if [ "${#matches[@]}" -eq 0 ]; then
    echo "No modules match '$pattern' in $ML_MODULES_DB."
    return
  fi
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
  index=1
  for line in "${matches[@]}"; do
    if [[ "$selected" == *" $index "* ]]; then
      local uri=${line%%~*}
      local local_name=${line#*~}
      local_name=${local_name%%~*}
      fetch "/v1/documents?uri=${uri}&database=${ML_MODULES_DB}" -X GET > "$directory/originals/$local_name" || return
      printf '%s\n' "$line" >> "$directory/module-info.txt"
      cp "$directory/originals/$local_name" "$directory/edited/$local_name"
    fi
    index=$((index + 1))
  done
  echo "Edit files in $directory/edited, then run: mlsh modules load"
}

loadModules() {
  local mode=$1
  local directory="modules_${TODAY}"
  if [ ! -f "$directory/module-info.txt" ]; then
    echo "No module list found. Run 'mlsh modules find' first."
    return 1
  fi
  while IFS='~' read -r uri local_name permissions collections; do
    local source_file="$directory/edited/$local_name"
    [ "$mode" = "reset" ] && source_file="$directory/originals/$local_name"
    [ -f "$source_file" ] || continue
    local url="${ML_PROTOCOL}://${ML_HOST}:${ML_PORT}/v1/documents?uri=${uri}&database=${ML_MODULES_DB}"
    curl --silent --show-error --digest -u "$ML_USER:$ML_PASS" -X PUT -T "$source_file" "$url"
    echo "Loaded $uri"
  done < "$directory/module-info.txt"
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
