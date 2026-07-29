import os from 'os';
import path from 'path';
import { runEnvironmentManager } from './env-manager.js';
import { loadActiveEnvironment } from './lib/environment-files.js';
import { createLogger, prepareLogFile } from './lib/logger.js';
import { MarkLogicClient } from './lib/marklogic.js';
import { runBackup } from './commands/backup.js';
import { runCorb, runMlcp } from './commands/external.js';
import { runEval } from './commands/eval.js';
import { showHelp } from './commands/help.js';
import { runLogs } from './commands/logs.js';
import { runModules } from './commands/modules.js';
import { runQconsole } from './commands/qconsole.js';

const WITHOUT_ENVIRONMENT = new Set(['env', 'mlenv', 'showenv', 'init', 'help', 'helpme', '-h', '--help', 'update']);

export function createContext({ topDir, processEnvironment = process.env } = {}) {
  const home = processEnvironment.HOME || os.homedir();
  const logFile = processEnvironment.MLSH_LOG_FILE || path.join(home, '.mlsh', 'mlsh.log');
  const sessionLogFile = processEnvironment.MLSH_SESSION_LOG_FILE || path.join(home, '.mlsh', 'mlsh-session.log');
  prepareLogFile(logFile);
  prepareLogFile(sessionLogFile);
  const environment = loadActiveEnvironment(home, processEnvironment);
  const logger = createLogger({
    file: logFile,
    level: processEnvironment.MLSH_LOG_LEVEL || 'info',
    scope: processEnvironment.MLSH_LOG_SCOPE || 'mlsh',
    secret: environment?.pass,
    debug: processEnvironment.MLSH_DEBUG === '1'
  });
  const context = { topDir, home, logFile, sessionLogFile, environment, logger, processEnvironment };
  if (environment) context.client = new MarkLogicClient({ environment, logger, processEnvironment });
  return context;
}

export async function runCli(args, options = {}) {
  const context = options.context || createContext(options);
  const command = args[0] || 'help';
  const commandArgs = args.slice(1);

  if (!WITHOUT_ENVIRONMENT.has(command) && !context.environment) {
    console.error("No environment selected. Please run 'mlsh env'.");
    return 1;
  }

  const interactive = context.processEnvironment.MLSH_INTERACTIVE === '1';
  if (!interactive) console.log(`\x1b[38;5;141mMLSH\x1b[0m \x1b[2m[${context.environment?.name || 'none'}]\x1b[0m`);
  context.logger.info(`command: ${context.logger.redact(args.join(' '))}`);

  let status;
  try {
    switch (command) {
      case 'help':
      case 'helpme':
      case '-h':
      case '--help': status = showHelp(commandArgs[0]); break;
      case 'env':
      case 'mlenv':
      case 'showenv': status = await runEnvironmentManager(commandArgs) ?? 0; break;
      case 'init': status = await runEnvironmentManager(commandArgs) ?? 0; break;
      case 'ev':
      case 'eval': status = await runEval(context, commandArgs); break;
      case 'log':
      case 'logs': status = await runLogs(context, commandArgs); break;
      case 'qc':
      case 'qconsole': status = await runQconsole(context, commandArgs); break;
      case 'b':
      case 'backup': status = await runBackup(context, commandArgs); break;
      case 'mod':
      case 'module':
      case 'modules': status = await runModules(context, commandArgs); break;
      case 'mlcp': status = await runMlcp(context, commandArgs); break;
      case 'corb': status = await runCorb(context, commandArgs); break;
      case 'update':
        console.log('Update MLSH with: npm install -g git+https://github.com/anomalyco/mlsh.git@latest');
        status = 0;
        break;
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        status = 1;
    }
  } catch (error) {
    context.logger.error(`command failed: ${command}: ${error.message}`);
    if (error.stack) context.logger.trace(`command stack: ${error.stack}`);
    console.error(`mlsh ${command}: ${error.message}`);
    status = 1;
  }

  if (status) context.logger.warn(`command failed: ${context.logger.redact(args.join(' '))} (exit ${status})`);
  else context.logger.debug(`command ok: ${context.logger.redact(args.join(' '))}`);
  if (!interactive) console.log('\x1b[2m----------------------------------------\x1b[0m');
  return Number(status) || 0;
}
