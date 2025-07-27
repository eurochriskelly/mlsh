#!/bin/bash

if [ ! -f "$HOME/.mlshrc" ]; then
    echo "No ~/.mlshrc file found."
    if [ ! -d "$HOME/.mlsh.d" ]; then
        echo "mlsh not found in the default location of ~/.mlsh.d/mlsh"
        echo "Please set MLSH_TOP_DIR in your ~/.mlshrc file."
        exit 1
    else
        echo "Creating a default .mlshrc file in your home directory."
        echo "Please modify as needed."
        cp ~/.mlsh.d/mlsh/mlshrc.template ~/.mlshrc
    fi
fi

# Convert line endings to unix format if dos2unix is installed
if [ -f "$(which dos2unix)" ];then
    dos2unix ~/.mlshrc 2> /dev/null
    for d in $(find ~/.mlsh.d/ -name "*.sh");do
      dos2unix $d 2> /dev/null
    done
fi

if [ -f ~/.mlshrc-gen ];then
  source ~/.mlshrc-gen
else
  source ~/.mlshrc
fi

export MLSH_VERSION="0.1.0"
export MLSH_CMD="bash $MLSH_TOP_DIR/scripts/mlsh.sh"
alias mlsh="$MLSH_CMD"
alias mlsh:go="cd $MLSH_TOP_DIR"

## shortcuts
 # wrappers
alias mle="mlsh eval $@"
alias mlm="mlsh mlcp $@"
alias mlq="mlsh qc $@"
alias mlc="mlsh corb $@"
alias mlr="mlsh rest $@"

 # core commands
alias mlu="mlsh update $@"
alias mli="mlsh init $@"

