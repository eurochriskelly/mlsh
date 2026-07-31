# MLSH — MarkLogic shell

MLSH is an interactive development shell and command-line toolkit for MarkLogic.

Run `mlsh` by itself to enter a real Bash session where MLSH commands are first-class shell functions. Normal shell behavior—including `cd`, Git, history, pipes, redirection, and environment variables—continues to work.

```text
$ mlsh

 ███╗   ███╗██╗     ███████╗██╗  ██╗
 ████╗ ████║██║     ██╔════╝██║  ██║
 ██╔████╔██║██║     ███████╗███████║
 ██║╚██╔╝██║██║     ╚════██║██╔══██║
 ██║ ╚═╝ ██║███████╗███████║██║  ██║
 ╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝
MarkLogic shell  Environment: dev

mlsh [dev]> cd my-project
mlsh [dev]> eval queries/check.xqy Documents
mlsh [dev]> modules find '*transform*'
```

Commands can also be called directly from an ordinary terminal or script:

```bash
mlsh eval queries/check.xqy Documents
mlsh logs show-errors
mlsh qc list
```

## Architecture

MLSH deliberately has two layers:

- `shell/bashrc` owns the interactive shell experience: prompt, aliases, shell functions, live environment switching, and session transcripts.
- The Node.js command core owns command parsing, configuration, logging, MarkLogic requests, concurrency, and external-process execution.

The shell functions pass their arguments directly to the Node command core. MLCP, CoRB, and `curl` remain external runtime tools; they are launched without constructing shell command strings.

The XQuery and server-side JavaScript files under `scripts/` are payloads evaluated by MarkLogic, not local shell implementations.

## Installation

Install from GitHub:

```bash
npm install -g git+https://github.com/anomalyco/mlsh.git
```

Or link a checkout while developing:

```bash
git clone https://github.com/anomalyco/mlsh.git
cd mlsh
npm install
npm link
```

Requirements:

- Node.js 18 or later
- Bash for the interactive MLSH session
- `curl` for digest-authenticated MarkLogic requests
- Java and the CoRB/XCC JARs when using `corb`
- A JDK (17 or later) when using `mlcp`; MLSH bundles ml-gradle and downloads Gradle and MLCP on first use

## Environments

Run the environment manager:

```bash
mlsh env
```

Environments are stored as editable files in `~/.mlsh/environments/`. The active environment name is stored in `~/.mlsh/current-env`.

```properties
name=dev
protocol=http
host=localhost
port=8000
user=admin
pass=admin
insecure=false
modules_db=modules
content_db=content
triggers_db=triggers
schemas_db=schemas
```

Set `insecure=true` to trust a self-signed or internally-issued TLS certificate for that
environment without needing a known CA - useful for `https` development or internal clusters.
It's applied automatically wherever that environment is used: `curl`-based commands (`eval`,
`logs`, `qc`, `backup`) pass `--insecure`, and `mlcp` fetches and trusts that exact server
certificate once (trust-on-first-use, like SSH host keys) in a small Java trust store under
`~/.mlsh/trust-store.jks`, used only by MLCP's own JVM.

Useful non-interactive forms:

```bash
mlsh env list
mlsh env current
mlsh env dev
```

Inside the MLSH shell, selecting an environment immediately updates the current session and prompt.

Legacy `~/.mlshrc` and `~/.mlshrc.json` configurations are migrated automatically the first time the environment manager runs.

## Commands

| Command | Purpose |
| --- | --- |
| `env` | Create, edit, list, or select environments |
| `eval` | Evaluate local XQuery or server-side JavaScript |
| `logs` | Show, search, or follow MarkLogic logs |
| `qc` | Manage Query Console workspaces |
| `modules` | Find, download, edit, load, or reset modules |
| `backup` | Run bundled backup operations |
| `mlcp` | Run MLCP import/export/copy jobs via a bundled ml-gradle runner |
| `corb` | Run CoRB with an active-environment connection URI |
| `session-log` | Locate, display, follow, or clear MLSH logs |
| `debug` | Change diagnostic verbosity inside the MLSH shell |

Run `help` inside the MLSH shell or `mlsh help <command>` from any terminal for details.

### Evaluate a script

```bash
mlsh eval query.xqy
mlsh eval query.xqy Documents
mlsh eval --script query.sjs --database App-Services --params 'var1=value1'
mlsh eval query.xqy Documents --vars 'name=Ada&active=true'
```

Calling `eval` without arguments opens the interactive script picker for the current directory.

### Work with modules

```bash
mlsh modules find transform
mlsh modules load
mlsh modules loadOne
mlsh modules reset
mlsh modules load --workspace modules_20260729
```

A bare search term is treated as a contains-style glob. For example, `transform` becomes `*transform*`.
Load, reset, and clone use today's module workspace when available, otherwise
the newest `modules_*` directory containing `module-info.jsonl`.

Each module workspace tracks its modules in `module-info.jsonl`, a JSON Lines
file with one record per module:

```jsonl
{"uri": "/transform.xqy", "permissions": ["app-user=read"], "collections": ["apps"]}
```

Only `uri` is required — `localName` (the file name under `originals/`/`edited/`),
`permissions`, and `collections` are optional and derived/defaulted if omitted.
This makes it easy to hand-add a record (for example after `modules clone`)
by appending a line like `{"uri": "/new.xqy"}`.


### Run MLCP

`mlcp` runs [MarkLogic Content Pump](https://docs.marklogic.com/guide/mlcp) through a bundled
[ml-gradle](https://github.com/marklogic/ml-gradle) runner (`gradle/mlcp/`), driven by simple job
files instead of long command lines:

```bash
mlsh mlcp                  # open an interactive job browser
mlsh mlcp import           # create and edit a new numbered import job, then run it
mlsh mlcp import 123       # run .jobs/mlcp/import/123.job, or create/edit it if missing
mlsh mlcp export 123       # same, for an export job
mlsh mlcp copy 123         # same, for a copy job (database to database)
```

Running `mlsh mlcp` (or just `mlcp` inside the interactive shell) with no arguments opens a
full-screen job browser, the same style as `mlsh eval`'s script picker:

```text
[↑/↓ j/k] navigate      [ENTER] select a type, then a job
[n] create a new job in the current type   [r] run the selected job
[e] edit it ($EDITOR/nvim/vim/vi)          [ESC] back a level
[q] or Ctrl+C to quit
```

Select a job type on the left (Import, Export, Copy), then a matching job stored under that type
(or press `n` to create one). Selecting a job shows its file contents on the right; `r` runs it,
`e` edits it, `q` quits.

Job files live at `.jobs/mlcp/<operation>/<job>.job` in the current directory and are plain
`key=value` files, opened in `$EDITOR`/`nvim`/`vim`/`vi` (same fallback order as everywhere else in
MLSH) when missing. Each operation opens a template with sensible defaults and commented-out
options, for example:

```properties
# Configure an MLCP copy job.
job=001

# Both default to the active environment.
# env_from=development
# env_to=local

collections=foo,bar
```

Connection details (host, port, credentials) always come from MLSH environments - either the
active one, or the `env_from`/`env_to` environment named in the job - never from the job file
itself, so job files are safe to commit alongside a project. `collections` is a convenience alias
for the underlying MLCP option (`output_collections` for import, `collection_filter` for export
and copy); any other MLCP option can be set directly by its usual name (e.g. `thread_count=8`).

This makes it easy to export data from one environment and import it into another - run an
`export` job once, then an `import` job repeatedly while iterating - or to `copy` directly from
one environment to another in a single step.

The first `mlcp` run downloads Gradle and MLCP automatically (both are cached afterward), so only
a JDK (17 or later) needs to be installed beforehand.

### Run CoRB

By default, MLSH looks under `~/.mlsh.d/dependencies/`:

```text
~/.mlsh.d/dependencies/
├── corb.jar
└── xcc.jar
```

Custom locations can be supplied through `CORB_JAR` and `XCC_JAR`.

## Logs

MLSH keeps two separate files:

- `~/.mlsh/mlsh.log` contains structured diagnostic events and redacts the active MarkLogic password.
- `~/.mlsh/mlsh-session.log` contains the ANSI-stripped output of commands run inside the interactive shell.

Inside the shell:

```bash
session-log
session-log show
session-log tail
session-log transcript show
debug on
debug off
```

## Development

```bash
npm test
npm pack --dry-run
```

The test suite covers configuration migration, argument parsing, Node command dispatch, digest-request execution through a fake `curl`, and the interactive shell’s first-class command functions.
