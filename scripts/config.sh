#!/bin/bash

# Environment manager - now integrated with Node.js CLI
# Falls back to bash implementation if Node.js is not available

source $MLSH_TOP_DIR/node_modules/mlsh-core/scripts/common.sh >/dev/null 2>&1

main() {
  local env=$1

  # Check if we have Node.js available and if the CLI tool exists
  if command -v node &>/dev/null && [ -f "$MLSH_TOP_DIR/cli/env-manager.js" ]; then
    # Use the new Node.js interactive CLI
    node "$MLSH_TOP_DIR/cli/env-manager.js"

    # After the CLI exits, load the updated environment
    if [ -f ~/.mlshrc ]; then
      source ~/.mlshrc
    fi
    if [ -f ~/.mlshrc-gen ]; then
      source ~/.mlshrc-gen
    fi
  else
    # Fallback to bash implementation
    bashMain "$env"
  fi
}

bashMain() {
  local env=$1
  echo ""
  if [ -z "$env" ]; then
    echo "Current env is [$ML_ENV]"
    showHelp
  fi
  export ML_ENV=$env
  source ~/.mlshrc

  output_file=~/.mlshrc-gen
  echo "#!/bin/bash" >"$output_file"
  # Loop through environment variables starting with "ML_"
  for var in $(env | grep -o 'ML_[A-Za-z0-9_]*='); do
    # Extract the variable name and value
    var_name=$(echo "$var" | sed 's/=$//')
    var_value="${!var_name}"

    # Export the variable to the output file
    echo "export $var_name=\"$var_value\"" >>"$output_file"
  done

  # Fixed vars:
  echo "export CORB_JAR=$CORB_JAR" >>"$output_file"
  echo "export MLSH_TOP_DIR=$MLSH_TOP_DIR" >>"$output_file"
  echo "export XCC_JAR=$XCC_JAR" >>"$output_file"
  echo "export MLCP_PATH=$MLCP_PATH" >>"$output_file"

  chmod +x "$output_file"

  if [ -n "$env" ]; then
    echo "Setting local env to [$env]"
  else
    echo "Env contains:"
  fi

  echo "  ML_ENV: $ML_ENV"
  echo "  ML_HOST: $ML_HOST"
  echo "  ML_USER: $ML_USER"
}

showHelp() {
  local envs=$(cat ~/.mlshrc | grep ")$" | grep -v "*" | awk '{print $1}' | awk -F\) '{print $1}')
  echo "Available environments:"
  echo "$envs" | sed 's/^/  /'
}

main "$@"
