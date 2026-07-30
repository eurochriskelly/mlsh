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
  mlcp: `Usage: mlsh mlcp <command> [options]

Run MLCP with connection defaults from the active MLSH environment.`,
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
  mlcp <args>                 Run MarkLogic Content Pump
  corb <args>                 Run CoRB
  backup <command>            Manage backups
  session-log [transcript]    Locate or view MLSH logs
  help <command>              Show detailed command help

Run mlsh without arguments to enter the interactive MLSH shell.`);
  return 0;
}
