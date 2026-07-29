import fs from 'fs';
import path from 'path';
import { ask } from '../lib/prompt.js';
import { evaluateBundled } from './eval.js';
import { showHelp } from './help.js';

function today() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function normalisePattern(pattern) {
  return /[*?]/.test(pattern) ? pattern : `*${pattern}*`;
}

export function parseModuleRecord(line) {
  const [uri, localName, permissions, collections] = line.split('~');
  return { line, uri, localName, permissions, collections };
}

function selectedItems(items, choice) {
  if (choice.trim().toUpperCase() === 'ALL') return items;
  const indices = new Set(choice.split(/[\s,]+/).filter(Boolean).map(Number));
  return items.filter((_, index) => indices.has(index + 1));
}

async function mapLimit(items, limit, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await operation(items[index], index);
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function moduleDirectory() {
  return path.resolve(`modules_${today()}`);
}

async function findModules(context, suppliedPattern) {
  const pattern = suppliedPattern || await ask('Pattern to match (for example, *foo.xqy): ');
  if (!pattern) throw new Error('No pattern given.');
  const search = normalisePattern(pattern);
  const limit = Number(process.env.MLSH_MODULE_FIND_LIMIT || 200);
  const timeoutSeconds = Number(process.env.MLSH_MODULE_FIND_TIMEOUT || 90);
  const concurrency = positiveInteger(process.env.MLSH_MODULE_CONCURRENCY, 4);
  const modulesDatabase = context.environment.modules_db;
  if (!modulesDatabase) throw new Error("No modules database configured. Run 'mlsh env' and set modules_db.");

  const variables = JSON.stringify({ pattern: search, limit: String(limit), timeoutSeconds: String(timeoutSeconds), targetDatabase: modulesDatabase });
  context.logger.info(`find pattern='${pattern}' normalised='${search}' target-db='${modulesDatabase}' eval-db='${context.environment.content_db}' limit=${limit} timeout=${timeoutSeconds}s`);
  const evaluated = await evaluateBundled(
    context,
    path.join(context.topDir, 'scripts', 'eval', 'moduleLister.xqy'),
    context.environment.content_db,
    variables,
    { capture: true }
  );
  if (evaluated.code !== 0) return evaluated.code;

  const lines = evaluated.response.replace(/\r/g, '').split('\n');
  const diagnostics = lines.filter(line => line.startsWith('MLSH-DIAG:')).map(line => line.slice('MLSH-DIAG:'.length));
  diagnostics.forEach(line => context.logger.info(`server: ${line}`));
  const records = lines.filter(line => line.includes('~') && line.endsWith('~EOL')).map(parseModuleRecord);
  if (!records.length) {
    console.log(`No modules match '${search}' in ${modulesDatabase}.`);
    if (diagnostics.length) console.log(`Server diagnostics:\n${diagnostics.map(line => `  ${line}`).join('\n')}`);
    console.log(`Details in ${context.logFile} (run 'debug on' for the full request/response).`);
    return 0;
  }

  console.log('Matching modules:');
  records.forEach((record, index) => console.log(`  ${index + 1}. ${record.uri}`));
  const choice = await ask('Numbers to download (for example, 1,3), ALL, or Enter to cancel: ');
  if (!choice) return 0;
  const selected = selectedItems(records, choice);
  if (!selected.length) throw new Error('No valid module numbers selected.');

  const directory = moduleDirectory();
  fs.mkdirSync(path.join(directory, 'originals'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'edited'), { recursive: true });
  const results = await mapLimit(selected, concurrency, async record => {
    const endpoint = `/v1/documents?uri=${encodeURIComponent(record.uri)}&database=${encodeURIComponent(modulesDatabase)}`;
    const response = await context.client.request(endpoint, ['-X', 'GET']);
    if (!response.ok) throw new Error(`HTTP ${response.status || 'transport-error'}`);
    fs.writeFileSync(path.join(directory, 'originals', record.localName), response.body);
    fs.copyFileSync(path.join(directory, 'originals', record.localName), path.join(directory, 'edited', record.localName));
    console.log(`Downloaded ${record.uri}`);
    return { ok: true, record };
  });
  const successes = results.filter(result => result?.ok).map(result => result.record.line);
  const failures = results.map((result, index) => ({ result, record: selected[index] })).filter(({ result }) => !result?.ok);
  if (successes.length) fs.appendFileSync(path.join(directory, 'module-info.txt'), `${successes.join('\n')}\n`);
  if (failures.length) {
    console.error(`Some modules failed to download:\n${failures.map(({ record, result }) => `  ${record.uri}: ${result?.error?.message || 'unknown error'}`).join('\n')}`);
  }
  console.log(`Edit files in ${path.basename(directory)}/edited, then run: mlsh modules load`);
  return failures.length ? 1 : 0;
}

function readModuleEntries(directory) {
  const info = path.join(directory, 'module-info.txt');
  if (!fs.existsSync(info)) throw new Error("No module list found. Run 'mlsh modules find' first.");
  return fs.readFileSync(info, 'utf8').split(/\r?\n/).filter(Boolean).map(parseModuleRecord);
}

async function loadModules(context, mode = '') {
  const directory = moduleDirectory();
  let records = readModuleEntries(directory);
  if (!records.length) throw new Error(`No modules found in ${path.join(directory, 'module-info.txt')}.`);
  if (mode === 'one') {
    console.log('Modules available to load:');
    records.forEach((record, index) => console.log(`  ${index + 1}. ${record.uri}`));
    const choice = await ask('Numbers to load (for example, 1,3), ALL, or Enter to cancel: ');
    if (!choice) {
      console.log('Cancelled.');
      return 0;
    }
    records = selectedItems(records, choice);
  }

  const concurrency = positiveInteger(process.env.MLSH_MODULE_CONCURRENCY, 4);
  const results = await mapLimit(records, concurrency, async record => {
    const source = path.join(directory, mode === 'reset' ? 'originals' : 'edited', record.localName);
    if (!fs.existsSync(source)) {
      console.log(`Skipping ${record.uri}: ${source} not found.`);
      return { ok: true, skipped: true };
    }
    const endpoint = `/v1/documents?uri=${encodeURIComponent(record.uri)}&database=${encodeURIComponent(context.environment.modules_db)}`;
    const response = await context.client.request(endpoint, ['-X', 'PUT', '-T', source]);
    if (!response.ok) throw new Error(`HTTP ${response.status || 'transport-error'} ${response.body.toString()}`.trim());
    console.log(`Loaded ${record.uri}`);
    return { ok: true };
  });
  const failures = results.map((result, index) => ({ result, record: records[index] })).filter(({ result }) => !result?.ok);
  if (failures.length) console.error(`Some modules failed to load:\n${failures.map(({ record, result }) => `  ${record.uri}: ${result?.error?.message || 'unknown error'}`).join('\n')}`);
  return failures.length ? 1 : 0;
}

async function cloneModule() {
  const directory = moduleDirectory();
  readModuleEntries(directory);
  const source = await ask('Module file name to clone: ');
  const target = await ask('New module file name: ');
  if (!source || !target) return 0;
  for (const subdirectory of ['originals', 'edited']) {
    fs.copyFileSync(path.join(directory, subdirectory, source), path.join(directory, subdirectory, target));
  }
  console.log(`Cloned ${source} to ${target}. Add its destination URI to ${path.join(path.basename(directory), 'module-info.txt')} before loading.`);
  return 0;
}

export async function runModules(context, args) {
  const command = args[0];
  if (['-h', '--help'].includes(command) || !command) return showHelp('modules');
  if (['find', 'retrieve', 'match', 'search'].includes(command)) return findModules(context, args[1]);
  if (['load', 'update'].includes(command)) return loadModules(context);
  if (['loadOne', 'load-one'].includes(command)) return loadModules(context, 'one');
  if (command === 'reset') return loadModules(context, 'reset');
  if (command === 'clone') return cloneModule();
  throw new Error(`Unknown modules command: ${command}`);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
