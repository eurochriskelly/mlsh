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

async function mlcpMenu() {
  console.log(`MarkLogic Content Pump (MLCP)
==============================

1. Import
2. Export
3. Copy
4. Help
`);
  const choice = await ask('Enter your choice (1-4) or command: ');
  if (choice === '4') return ['help'];
  if (!['1', '2', '3'].includes(choice)) return splitOptions(choice);
  if (choice === '1') {
    const input = await ask('Input file path: ');
    const type = await ask('Input format (json/xml/text/binary): ');
    const collections = await ask('Output collections (csv): ');
    const prefix = await ask('Output URI prefix (e.g. /data/): ');
    if (!await confirm()) return [];
    return ['import', '-input_file_path', input, '-input_file_type', type, '-output_collections', collections, '-output_uri_prefix', prefix];
  }
  if (choice === '2') {
    const output = await ask('Output file path: ');
    const type = await ask('Output format (json/xml/text/binary): ');
    const collection = await ask('Collection (leave blank for all): ');
    const query = await ask('Query filter (XPath or leave blank): ');
    if (!await confirm()) return [];
    return ['export', '-output_file_path', output, '-output_type', type, ...(collection ? ['-collection_filter', collection] : []), ...(query ? ['-query_filter', query] : [])];
  }
  const source = await ask('Source database: ');
  const target = await ask('Target database: ');
  const collection = await ask('Collection (leave blank for all): ');
  if (!await confirm()) return [];
  return ['copy', '-input_database', source, '-output_database', target, ...(collection ? ['-collection_filter', collection] : [])];
}

export function mlcpConnectionArgs(command, environment) {
  if (['help', 'version', '-help', '--help', '-h'].includes(String(command).toLowerCase())) return [];
  if (String(command).toLowerCase() === 'copy') {
    return [
      '-input_host', environment.host,
      '-input_port', environment.port,
      '-input_username', environment.user,
      '-input_password', environment.pass,
      '-output_host', environment.host,
      '-output_port', environment.port,
      '-output_username', environment.user,
      '-output_password', environment.pass
    ];
  }
  return ['-host', environment.host, '-port', environment.port, '-username', environment.user, '-password', environment.pass];
}

export async function runMlcp(context, args) {
  let commandArgs = args;
  if (!commandArgs.length) commandArgs = await mlcpMenu();
  if (!commandArgs.length) return 0;

  const executable = firstExisting([
    process.env.MLCP_PATH,
    path.join(context.home, '.mlsh.d', 'dependencies', 'mlcp', 'bin', 'mlcp.sh'),
    path.join(context.topDir, 'dependencies', 'mlcp', 'bin', 'mlcp.sh')
  ]);
  if (!executable) throw new Error(`MLCP not found. Set MLCP_PATH or install it under ${path.join(context.home, '.mlsh.d', 'dependencies', 'mlcp')}.`);

  const command = commandArgs[0];
  const connection = mlcpConnectionArgs(command, context.environment);
  const finalArgs = [command, ...connection, ...commandArgs.slice(1)];
  context.logger.info(`mlcp command: ${executable} ${context.logger.redact(finalArgs.join(' '))}`);
  console.log(`Running MLCP: ${command}`);
  console.log('═══════════════════════════════════════════════════════════');
  const result = await runProcess(executable, finalArgs, { inherit: true });
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`MLCP completed with exit code: ${result.code}`);
  return result.code;
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
