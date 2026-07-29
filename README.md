# mlsh (MarkLogic Shell)

`mlsh` (MarkLogic shell) is a command-line, "swiss-army knife" for
interacting with and developing MarkLogic Application. It is intended
as a lowest-common-denominator tool, (fully written in bash), and
preloaded in your user environment where it can be used across
projects, regardless of build system.

`mlsh` commands can be run with known parameters and scripted. However,
if no parameters are provided, they will run interactively.

## Quick Start

### Global Installation (Recommended)

Install MLSH globally as an npm package:

**After publishing to npm registry (coming soon):**
```bash
npm install -g mlsh
```

**For now, install directly from GitHub:**
```bash
npm install -g git+https://github.com/anomalyco/mlsh.git
```

Then use it from anywhere:

```bash
mlsh          # Start interactive MLSH shell
mlsh env      # Change environment interactively
mlsh eval     # Evaluate XQuery/JavaScript
mlsh logs     # View MarkLogic logs
```

See [NPM_INSTALLATION.md](./NPM_INSTALLATION.md) for more details.

### From a Checkout

After cloning this repository, run `make` to see the available setup and
development commands. To install the checkout as your local `mlsh` command:

```bash
make link
mlsh init
mlsh env
```

`make link` installs the project dependencies and runs `npm link`. If you only
want to try the checkout without adding a global command, run:

```bash
make run
```

`mlsh env` stores one editable file per environment in
`~/.mlsh/environments/`. On first use it creates and opens
`~/.mlsh/environments/dev.env`; subsequently it lists existing environments
to edit or lets you create another one. It uses `$EDITOR`, then `nvim`, `vim`,
or `vi`. The `name` field determines the environment name and file name, so
change it in the editor to create or rename an environment.

```properties
# ENV SETTINGS
name=dev
protocol=http
host=localhost
port=8000
user=admin
pass=admin

# Database names
modules_db=modules
content_db=content
triggers_db=triggers
schemas_db=schemas
```

## Installation

### Download

To get started, create a folder for mlsh, e.g.

```bash
mkdir -p ~/.mlsh.d
cd ~/.mlsh.d
```

Then download and unpack the release:

```bash
curl -s https://api.github.com/repos/eurochriskelly/mlsh/releases/latest \
  | grep zipball_url \
  | awk -F": " '{print $2}' \
  | awk -F\" '{print $2}' \
  | wget -qi - -O mlsh.zip
unzip mlsh.zip
mv eurochriskelly-mlsh-* mlsh
```

### Configure

Add the following to your `.profile` or equivalent init file:

```bash
source ~/.mlsh.d/mlsh/init.sh
```

First time you run, a `~/.mlshrc` file is created for your environment.
Please fix any warnings so you have full mlsh capabilities!

### Dependencies

Copy or symlink the following to `~/.mlsh.d/dependencies/`:

- `corb.jar` - MarkLogic CoRB (Coordinated RBalanced) JAR
- `xcc.jar` - MarkLogic XCC JAR
- `mlcp/` - MarkLogic Content Pump directory

Update paths in `~/.mlshrc` if you place them elsewhere.

## Updates

To update to the latest version, run:

```bash
mlsh update
```

Alternatively, if not using the release, pull the latest code using `git pull`.

## Features & Usage

`mlsh`, when run alone, lists all available commands. Commands are typically
interactive (but can be scripted) and run using the syntax `mlsh <command>`.
More information on any command can be found using `mlsh help <command>`.

### Main Commands

| Command   | Description                                | Example                                  |
|-----------|-------------------------------------------|------------------------------------------|
| `env`     | Show/switch environments                  | `mlsh env`                               |
| `qc`      | Push and pull workspaces from database    | `mlsh qc pull`, `mlsh qc push`           |
| `modules` | Download modules, edit, load & reset      | `mlsh modules find`                      |
| `eval`    | Evaluate a locally stored script          | `mlsh eval script.xqy Documents`         |
| `corb`    | Run CoRB jobs                             | `mlsh corb --job myJob`                  |
| `mlcp`    | Run MLCP with environment defaults        | `mlsh mlcp import --type xml ...`        |
| `log`     | Query and follow MarkLogic logs           | `mlsh log search --pattern XDMP-AS`      |
| `backup`  | Create and restore backups                | `mlsh backup list`, `mlsh backup create` |
| `update`  | Update mlsh from GitHub                   | `mlsh update`                            |

`modules`, `qc`, and `backup` are included in MLSH; they do not require
separate npm plugin packages.

### Shortcuts

| Alias | Command       |
|-------|---------------|
| `mle` | `mlsh eval`   |
| `mlm` | `mlsh mlcp`   |
| `mlq` | `mlsh qc`     |
| `mlc` | `mlsh corb`   |
| `mlr` | `mlsh rest`   |
| `mlu` | `mlsh update` |
| `mli` | `mlsh init`   |

## Usage

### Interactive Mode

Commands run without options will prompt the user for input.

Example:

```bash
$ mlsh
# Drops into interactive shell with custom prompt

$ mlsh transfer
mlsh v0.1.0:
  Select the source host:
  1) LOC: http://localhost
  2) TST: http:/foo.bar.com
  3) ACC: http://baz.qux.com
  #? 2
  
  Select the destination host:
  1) LOC: http://localhost
  #? 1
  
  Select a collector or enter name of custom collector:
  1) First 100 documents
  2) My favourites list
  #? ../custom.xqy
```

### Scripting Mode

Check the help for scripting options:

```bash
mlsh help <command>
```

Example:

```bash
# Execute a script against a specific database
mlsh eval /path/to/script.xqy Documents

# Execute with variables
mlsh eval script.sjs App-Services "var1=value1&var2=value2"

# Pull Query Console workspaces
mlsh qc pull

# List available workspaces
mlsh qc list

# Run CoRB job
mlsh corb --job jobName --taskDir path/to/tasks --threads 4

# Search logs for errors in last 10 minutes
mlsh log show-errors --time 10m

# Follow logs from specific ports
mlsh log follow --ports 8000,8001,Error,TaskServer

# Search logs for a pattern
mlsh log search --pattern 'XDMP-AS' --ports 8000,8001
```

## Configuration

The `~/.mlshrc` file configures your MarkLogic environments:

```bash
# Installation directory
export MLSH_TOP_DIR=~/.mlsh.d/mlsh

# Dependency paths
export CORB_JAR=~/.mlsh.d/dependencies/corb.jar
export XCC_JAR=~/.mlsh.d/dependencies/xcc.jar
export MLCP_PATH=~/.mlsh.d/dependencies/mlcp/bin/mlcp.sh

# Default environment
export ML_ENV=local

# Database names
export ML_MODULES_DB=modules
export ML_CONTENT_DB=content
export ML_TRIGGERS_DB=triggers
export ML_SCHEMAS_DB=schemas

# Environment-specific settings
case $ML_ENV in
  local)
    export ML_HOST=localhost
    export ML_PORT=8000
    export ML_USER=admin
    export ML_PASS=admin
    export ML_PROTOCOL=http
    ;;
esac
```

## Interactive Shell

Running `mlsh` without arguments clears the terminal and opens an interactive
shell. The prompt includes the active environment:

```text
mlsh [dev]>
```

Run MLSH commands directly inside the shell, without the `mlsh` prefix. Normal
shell commands, pipes, redirection, and history remain available.

```bash
$ mlsh
mlsh [dev]> eval script.xqy Documents
mlsh [dev]> logs show-errors --time 10m
mlsh [dev]> env
mlsh [dev]> git status
mlsh [dev]> exit
```

MLSH command output is appended to the fixed application log
`~/.mlsh/mlsh.log`. MLSH truncates that file on startup only when it exceeds
10 MB. Run `session-log` to print the path or `session-log show` to view it.

## License

ISC

## Contributing

Contributions welcome! Please submit issues and pull requests on GitHub.
