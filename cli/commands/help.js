const HELP = {
  eval: `Usage: mlsh eval [options] <script> [database] [params]

Evaluate a local XQuery or JavaScript file against MarkLogic.

Options:
  -s, --script <file>       Script to evaluate
  -d, --database <name>    Target database (defaults to ML_CONTENT_DB)
  -p, --params <value>     Value for the REST API vars parameter
  -v, --vars <pairs>       Convert key=value pairs to JSON

Running 'mlsh eval' with no script opens an interactive picker for scripts
(.xqy, .js, .sjs, .sql, .spl) in the current directory. In a real terminal
this is a full-screen navigator:
  [\u2191/\u2193 j/k] browse scripts   [ENTER] view the selected script
  [r] run             [e] edit it ($EDITOR/nvim/vim/vi)
  [s] back to the script list         [a] add a new script file
  [p] set query params                [q] or Ctrl+C to quit`,
  modules: `Usage: mlsh modules {find <pattern>|new <pattern>|load|loadOne|clone|reset} [--workspace <directory>]

Download modules for local editing and load them back into MarkLogic.

'find' reuses the most recent module workspace if one exists, only creating a
new dated folder if none are available. 'new' always creates a fresh workspace.

Load, reset, and clone reuse today's workspace or the newest valid modules_*
workspace. Use --workspace to select one explicitly.`,
  logs: `Usage: mlsh logs {show-errors|show-access|search|follow} [options]

Read or follow MarkLogic server logs.`,
  qc: `Usage: mlsh qc {list|pull|push}

Manage Query Console workspaces.`,
  backup: `Usage: mlsh backup {list|create|delete}

Run the bundled MarkLogic backup operations.`,
  mlcp: `Usage: mlsh mlcp [import|export|copy] [job]

Run MLCP (via ml-gradle) using a job file under .jobs/mlcp/<operation>/<job>.job
in the current directory.

  mlsh mlcp                  Open an interactive job browser (types -> jobs -> view)
  mlsh mlcp import           Create and edit a new numbered import job, then run it
  mlsh mlcp import 123       Run .jobs/mlcp/import/123.job, or create/edit it if missing
  mlsh mlcp export 123       Same, for an export job
  mlsh mlcp copy 123         Same, for a copy job (database to database)

Running 'mlsh mlcp' with no arguments opens an interactive job browser. In a
real terminal this is a full-screen navigator:
  [\u2191/\u2193 j/k] navigate      [ENTER] select a type, then a job
  [n] create a new job in the current type   [r] run the selected job
  [e] edit it ($EDITOR/nvim/vim/vi)          [ESC] back a level
  [q] or Ctrl+C to quit

Job files are simple key=value files, edited with $EDITOR/nvim/vim/vi. Each
operation opens a template with sensible defaults and commented-out options.
Connection details always come from the active MLSH environment (or the
env_from/env_to fields in the job) - never from the job file itself.`,
  corb: `Usage: mlsh corb [options]

Run CoRB with connection defaults from the active MLSH environment.`,
  env: `Usage: mlsh env [list|current|<name>]

With no argument, interactively create, select, or edit an environment.`
};

export function showHelp(command) {
  const canonical = command === 'log' ? 'logs' : command === 'module' ? 'modules' : command === 'qconsole' ? 'qc' : command;
  if (HELP[canonical]) {
    console.log(HELP[canonical]);
    return 0;
  }
  console.log(`MLSH - MarkLogic shell

Usage: mlsh <command> [arguments]

Commands:
  env                         Create, select, or edit an environment
  eval <script> ...           Evaluate XQuery or JavaScript
  logs <command>              Query MarkLogic logs
  qc <command>                Manage Query Console workspaces
  modules <command>           Download, edit, and load modules
  mlcp <import|export|copy>   Run MLCP jobs via ml-gradle
  corb <args>                 Run CoRB
  backup <command>            Manage backups
  session-log [transcript]    Locate or view MLSH logs
  help <command>              Show detailed command help

Run mlsh without arguments to enter the interactive MLSH shell.`);
  return 0;
}
