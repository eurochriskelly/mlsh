import fs from 'fs';
import path from 'path';
import { ask, confirm } from '../lib/prompt.js';
import { commandExists, runProcess } from '../lib/process.js';

function firstExisting(candidates) {
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

function splitOptions(value) {
  return String(value || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(part => part.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')) || [];
}

async function corbMenu() {
  console.log(`MarkLogic CoRB (Content Operations for MarkLogic)
==================================================

1. Run a CoRB task
2. Help
`);
  const choice = await ask('Enter your choice (1-2) or command: ');
  if (choice === '2') return ['-h'];
  if (choice !== '1') return splitOptions(choice);
  const options = splitOptions(await ask('CoRB options: '));
  return await confirm() ? options : [];
}

export async function runCorb(context, args) {
  let commandArgs = args;
  if (!commandArgs.length) commandArgs = await corbMenu();
  if (!commandArgs.length) return 0;

  const corb = firstExisting([
    process.env.CORB_JAR,
    path.join(context.home, '.mlsh.d', 'dependencies', 'corb.jar'),
    path.join(context.topDir, 'dependencies', 'corb.jar')
  ]);
  if (!corb) throw new Error('CoRB JAR not found. Set CORB_JAR or install it under ~/.mlsh.d/dependencies/.');
  if (!await commandExists('java')) throw new Error('Java is required to run CoRB.');
  const xcc = firstExisting([
    process.env.XCC_JAR,
    path.join(context.home, '.mlsh.d', 'dependencies', 'xcc.jar'),
    path.join(context.topDir, 'dependencies', 'xcc.jar')
  ]);
  if (!xcc) throw new Error('XCC JAR not found. Set XCC_JAR or install it under ~/.mlsh.d/dependencies/.');

  const informational = ['help', '-h', '--help'].includes(String(commandArgs[0]).toLowerCase());
  const finalArgs = ['-cp', `${corb}${path.delimiter}${xcc}`, 'com.marklogic.developer.corb.Manager'];
  if (!informational) finalArgs.push(`-Dml.connectionuri=xcc://${encodeURIComponent(context.environment.user)}:${encodeURIComponent(context.environment.pass)}@${context.environment.host}:${context.environment.port}/`);
  finalArgs.push(...commandArgs);
  context.logger.info(`corb command: java ${context.logger.redact(finalArgs.join(' '))}`);
  console.log('Running CoRB');
  console.log('═══════════════════════════════════════════════════════════');
  const result = await runProcess('java', finalArgs, { inherit: true });
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`CoRB completed with exit code: ${result.code}`);
  return result.code;
}
