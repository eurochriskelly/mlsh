#!/bin/bash

source $MLSH_TOP_DIR/scripts/common.sh
LAST_SCRIPT=

showHelp() {
  echo "Usage: mlsh eval [options] <script> <database> <params>"
  echo "Options:"
  echo "  -s|--script <script>   The script to run"
  echo "  -d|--database <database>   The database to run the script against"
  echo "  -p|--params <params>   The parameters to pass to the script"
  echo "  -h|--help              Show this help"
}

run() {
  LL "Running eval with args $@"
  if [ "$#" -eq 0 ]; then
    local database=$ML_CONTENT_DB
    echo -n "Select a database or press ENTER for default [$ML_CONTENT_DB]: "
    read dbChoice
    local modulesDb=$ML_MODULES_DB
    echo -n "Select a modules db or press ENTER for default [$ML_MODULES_DB]: "
    read modDbChoice
    if [ -n "$dbChoice" ]; then database=$dbChoice; fi
    if [ -n "$modDbChoice" ]; then database=$modDbChoice; fi
    while true; do
      echo "MLSH: ML EVAL DB [$database] MODB [$modulesDb]"
      interactivelyRunScriptsInDir $database $modulesDb
    done
    exit 0
  else
    # Parse arguments - support both positional and named arguments
    local script=
    local database=
    local params=
    local positional_index=0

    while [[ $# -gt 0 ]]; do
      case $1 in
      --script | -s)
        shift
        script=$1
        shift
        # Only strip extension if file doesn't exist with extension
        if [[ $script == *.* && ! -f "$script" ]]; then
          script=${script%.*}
        fi
        ;;

      --params | -p)
        shift
        params=$1
        shift
        ;;

      --vars | -v)
        shift
        params=$(toJson $1)
        shift
        ;;

      --database | -d)
        shift
        database=$1
        shift
        ;;

      --help | -h)
        showHelp
        exit 0
        ;;

      *)
        # Handle positional arguments
        if [ -z "$script" ]; then
          script=$1
          # Only strip extension if file doesn't exist with extension
          if [[ $script == *.* && ! -f "$script" ]]; then
            script=${script%.*}
          fi
        elif [ -z "$database" ]; then
          database=$1
        elif [ -z "$params" ]; then
          params=$1
        fi
        shift
        ;;
      esac
    done
    doEval $script $database $params
  fi

}

# Interactively allow user to select a script to run
# from the list of scripts in the current directory.
# Number each script and let the user select one
# by typing the number and pressing ENTER.
interactivelyRunScriptsInDir() {
  # get xqy, js, and sjs files
  local database=$1
  local modules=$2
  local scripts=$(ls -1 *.xqy *.js *.sjs 2>/dev/null | sort)
  echo "Scripts in current directory:"
  i=1
  for s in $scripts; do
    echo -e "\033[33m  ${i}.\033[0m $s"
    i=$((i + 1))
  done
  local extra=
  if [ -n "$LAST_SCRIPT" ]; then extra="press ENTER to re-run ($LAST_SCRIPT),"; fi
  echo -n "Select a script, ${extra} or choose an option [Database/Params/eXit]: "
  read choice
  if [ "$choice" == "x" ]; then
    exit 0
  fi
  if [ -z "$choice" ]; then
    # if user pressed enter, re-run last script
    script=${LAST_SCRIPT}
    if [ -z "$script" ]; then
      LL "Nothing selected and no previous script ran. Exiting"
      echo "Nothing selected and no previous script ran. Exiting"
      exit 0
    fi
  else
    # split choice into 2 parts
    local scriptNum=$(echo $choice | cut -d' ' -f1)
    local params=$(echo $choice | cut -d' ' -f2)
    if [ -n "$params" ]; then
      params=$(toJson $params)
    fi
    local script=$(echo $scripts | cut -d' ' -f$scriptNum)
  fi
  if [ -z $script ]; then
    echo "No script selected"
    exit 1
  fi
  # remove extension from variable $script
  # FIXME: this should be done inside doEval
  extension=$LAST_EXTENSION
  if [ "$script" != "${script%.*}" ]; then
    extension=${script##*.}
  fi
  script=${script%.*}
  database="$(checkForDatabaseOverride $script $extension $database)"

  clear
  echo "MLSH: ML EVAL DB [$database] MODB [$modules]."
  echo "RUNNING: doEval $script $database $params"
  LAST_SCRIPT=$script
  LAST_EXTENSION=$extension
  # calculate elapsed time
  start=$(date +%s)
  # Echo in green
  echo -e "\033[32m------------------- ------------------------\033[0m"
  tmpScript=$(modulesWrapper $script $extension $database $modules)
  result="$(doEval $tmpScript $database $params)"
  echo "$result" >/tmp/mlsh-eval.out
  local numLines=$(echo "$result" | wc -l)
  # in the terminal we want to truncate the response to 50 lines
  # The full response should be view with a better tool (e.g. vim, emacs)
  if [ $numLines -gt 50 ]; then
    result="$(echo "$result" | head -n 50)n\\nSee /tmp/mlsh-eval.out for full response"
  fi
  echo "$result" | while read -r line; do
    # echo the line but truncate to 200 characters if it's more than that
    # Add ... at the end if the line has been truncated
    if [ ${#line} -gt 200 ]; then
      echo "  ${line:0:200} ... (long line truncated)"
    else
      echo "  ""$line"
    fi
  done
  echo -e "\033[32m------------------- ------------------------\033[0m"
  echo -e "\033[32mFull response @ /tmp/mlsh-eval.out\033[0m"

  end=$(date +%s)
  elapsed=$((end - start))
  echo "Elapsed time: $elapsed seconds"
  echo ""
}

checkForDatabaseOverride() {
  local script=$1
  local extension=$2
  local database=$3
  local predb=$database
  if [ ! -f $script ]; then
    script=${script}.${extension}
  fi
  # if the script contains "@DEFAULTS" in the first 10 lines, parse it for the database name
  # the string should look like this: @DEFAULTS:database=Documents where Documents in the value of the database override
  if [ -n "$(head -n 10 $script | grep "@DEFAULTS:database=")" ]; then
    database=$(head -n 10 $script | grep "@DEFAULTS:database=" | cut -d'=' -f2 | cut -d' ' -f1)
    if [ "$database" != "" ]; then
      LL "Found database override [$database] in script [$script]. Using that instead of [$predb]."
    fi
  fi
  echo "$database"
}

modulesWrapper() {
  local input_file=$1
  local extension=$2
  local database=$3
  local modules=$4
  local tmp_file="/tmp/mlsh-evaler/_${input_file}.${extension}"
  # if extension is sjs or js then do nothing
  if [ "$extension" == "sjs" ] || [ "$extension" == "js" ]; then
    cp $input_file $tmp_file
    return
  fi
  # Extract the filename and contents
  filename=$(basename "$input_file" .xqy)
  test -d /tmp/mlsh-evaler || mkdir -p /tmp/mlsh-evaler
  output_file="/tmp/mlsh-evaler/_${input_file}.xqy"
  # Read the contents of the input file
  contents=$(<"${input_file}.${extension}")
  # Create the output XQuery file with contents, database, and modules embedded in the template
  cat <<EOF >"$output_file"
xquery version "1.0-ml";
xdmp:eval(<root><![CDATA[
$contents
]]></root>//text(), (), <options xmlns="xdmp:eval">
  <database>{xdmp:database("$database")}</database>
  <modules>{xdmp:database("$modules")}</modules>
</options>)
EOF
  echo $tmp_file
}

run $@
