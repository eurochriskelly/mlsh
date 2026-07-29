import fs from 'fs';
import os from 'os';
import path from 'path';
import { ask } from '../lib/prompt.js';
import { evalErrorDetail } from '../lib/marklogic.js';
import { showHelp } from './help.js';

export function pairsToJson(value) {
  if (!value) return '{}';
  if (value.trim().startsWith('{')) return value;
  const entries = value.split(/[&,]/).filter(Boolean).map(pair => {
    const separator = pair.indexOf('=');
    return separator === -1 ? [pair, ''] : [pair.slice(0, separator), pair.slice(separator + 1)];
  });
  return JSON.stringify(Object.fromEntries(entries));
}

export function parseEvalArgs(args) {
  const options = { script: '', database: '', params: '', help: false };
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (['-h', '--help'].includes(argument)) options.help = true;
    else if (['-s', '--script'].includes(argument)) options.script = requiredValue(args, ++index, argument);
    else if (['-d', '--database'].includes(argument)) options.database = requiredValue(args, ++index, argument);
    else if (['-p', '--params'].includes(argument)) options.params = requiredValue(args, ++index, argument);
    else if (['-v', '--vars'].includes(argument)) options.params = pairsToJson(requiredValue(args, ++index, argument));
    else positional.push(argument);
  }
  if (!options.script) options.script = positional.shift() || '';
  if (!options.database) options.database = positional.shift() || '';
  if (!options.params) options.params = positional.shift() || '';
  if (positional.length) throw new Error(`Unexpected eval argument: ${positional[0]}`);
  return options;
}

function requiredValue(args, index, option) {
  if (index >= args.length) throw new Error(`${option} requires a value.`);
  return args[index];
}

export function resolveScript(file, cwd = process.cwd()) {
  if (!file) return null;
  const supplied = path.resolve(cwd, file);
  const candidates = [supplied];
  if (!path.extname(supplied)) candidates.push(`${supplied}.xqy`, `${supplied}.sjs`, `${supplied}.js`);
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function databaseOverride(script, fallback) {
  const firstLines = fs.readFileSync(script, 'utf8').split(/\r?\n/).slice(0, 10).join('\n');
  return firstLines.match(/@DEFAULTS:database=([^\s]+)/)?.[1] || fallback;
}

async function evaluateFile(context, script, database, params, { quiet = false, capture = false } = {}) {
  const targetDatabase = database || context.environment.content_db;
  context.logger.info(`eval script=${script} database=${targetDatabase} params=${params || 'none'} target=${context.environment.host}:${context.environment.port}`);
  context.logger.trace(`eval source | ${fs.readFileSync(script, 'utf8').replace(/\r?\n/g, '\neval source | ')}`);

  if (!quiet) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Evaluating: ${path.basename(script)}`);
    console.log(`Database: ${targetDatabase}`);
    console.log(`Server: ${context.environment.host}:${context.environment.port}`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  const result = await context.client.evaluate(script, targetDatabase, params);
  const response = result.body.toString();
  if (result.code === 28) {
    console.error(`Error: eval of ${path.basename(script)} against '${targetDatabase}' did not respond within ${context.client.timeout}s and was aborted.`);
    console.error('This is a client-side cutoff. Check MarkLogic Query Monitor for the server-side request.');
    console.error(`See ${context.logFile} for heartbeat timestamps.`);
    return { code: 1, response };
  }
  if (result.code !== 0 || !result.status.startsWith('2')) {
    console.error(`Error: eval of ${path.basename(script)} failed against '${targetDatabase}' (HTTP ${result.status || 'transport-error'})`);
    console.error(evalErrorDetail(result.body));
    console.error(`See ${context.logFile} for the full request and response.`);
    return { code: 1, response };
  }

  if (quiet && !capture) console.log(response);
  else {
    const display = response.split(/\r?\n/).filter(line => line && !line.startsWith('--') && !line.startsWith('Content-Type:') && !line.startsWith('X-Primitive:')).join('\n');
    console.log('Result:');
    console.log('───────────────────────────────────────────────────────────');
    console.log(display);
    console.log('───────────────────────────────────────────────────────────');
    console.log(`Execution time: ${result.elapsed}s\n`);
  }
  return { code: 0, response };
}

async function interactiveEval(context) {
  let database = (await ask(`Select a database or press ENTER for default [${context.environment.content_db}]: `)) || context.environment.content_db;
  const modules = (await ask(`Select a modules db or press ENTER for default [${context.environment.modules_db}]: `)) || context.environment.modules_db;
  let lastScript = '';
  let lastParams = '';

  while (true) {
    const scripts = fs.readdirSync(process.cwd()).filter(file => /\.(xqy|s?js)$/i.test(file)).sort();
    console.log(`\nMLSH: ML EVAL DB [${database}] MODB [${modules}]`);
    console.log('Scripts in current directory:');
    scripts.forEach((file, index) => console.log(`  ${index + 1}. ${file}`));
    const extra = lastScript ? `press ENTER to re-run (${lastScript}), ` : '';
    const choice = await ask(`Select a script, ${extra}or eXit: `);
    if (choice.toLowerCase() === 'x') return 0;

    let script;
    if (!choice) script = lastScript;
    else {
      const [number, ...paramParts] = choice.split(/\s+/);
      script = scripts[Number(number) - 1];
      lastParams = paramParts.length ? pairsToJson(paramParts.join(' ')) : '';
    }
    if (!script) {
      console.log('Nothing selected.');
      continue;
    }
    lastScript = script;
    database = databaseOverride(script, database);

    let prepared = path.resolve(script);
    let temporaryDirectory;
    if (path.extname(script).toLowerCase() === '.xqy') {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-eval-'));
      prepared = path.join(temporaryDirectory, path.basename(script));
      const source = fs.readFileSync(script, 'utf8');
      const xqueryString = value => String(value).replace(/"/g, '""');
      fs.writeFileSync(prepared, `xquery version "1.0-ml";\nxdmp:eval(<root><![CDATA[\n${source}\n]]></root>//text(), (), <options xmlns="xdmp:eval">\n  <database>{xdmp:database("${xqueryString(database)}")}</database>\n  <modules>{xdmp:database("${xqueryString(modules)}")}</modules>\n</options>)\n`);
    }
    try {
      const result = await evaluateFile(context, prepared, database, lastParams);
      fs.writeFileSync(path.join(os.tmpdir(), 'mlsh-eval.out'), result.response);
    } finally {
      if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export async function runEval(context, args, options = {}) {
  const parsed = parseEvalArgs(args);
  if (parsed.help) return showHelp('eval');
  if (!parsed.script) return interactiveEval(context);
  const script = resolveScript(parsed.script);
  if (!script) throw new Error(`Script file not found: ${parsed.script}`);
  return (await evaluateFile(context, script, parsed.database, parsed.params, options)).code;
}

export async function evaluateBundled(context, script, database, params = '', options = {}) {
  const result = await evaluateFile(context, script, database, params, { quiet: true, ...options });
  return result;
}
