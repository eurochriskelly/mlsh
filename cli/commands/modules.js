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

function deriveLocalName(uri) {
  return uri.replace(/\//g, '%');
}

export function parseModuleRecord(line) {
  const parsed = JSON.parse(line);
  if (!parsed.uri) throw new Error(`Module record is missing "uri": ${line}`);
  const record = {
    uri: parsed.uri,
    localName: parsed.localName || deriveLocalName(parsed.uri),
    permissions: parsed.permissions || [],
    collections: parsed.collections || []
  };
  record.line = JSON.stringify(record);
  return record;
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

function datedModuleDirectory(cwd = process.cwd()) {
  return path.resolve(cwd, `modules_${today()}`);
}

function hasModuleList(directory) {
  return fs.existsSync(path.join(directory, 'module-info.jsonl'));
}

function tryResolveModuleWorkspace(options) {
  try {
    return resolveModuleWorkspace(options);
  } catch {
    return null;
  }
}

export function resolveModuleWorkspace({ cwd = process.cwd(), requested, date = today() } = {}) {
  const currentDirectory = path.resolve(cwd);
  if (requested) {
    const directory = path.resolve(currentDirectory, requested);
    if (!hasModuleList(directory)) {
      throw new Error([
        `Module workspace is missing its module list: ${directory}`,
        `Expected: ${path.join(directory, 'module-info.jsonl')}`,
        "Choose a workspace created by 'modules find'."
      ].join('\n'));
    }
    return { directory, reason: 'requested' };
  }

  if (/^modules_/.test(path.basename(currentDirectory)) && hasModuleList(currentDirectory)) {
    return { directory: currentDirectory, reason: 'current-directory' };
  }

  const expected = path.join(currentDirectory, `modules_${date}`);
  if (hasModuleList(expected)) return { directory: expected, reason: 'today' };

  const discovered = fs.readdirSync(currentDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^modules_/.test(entry.name))
    .map(entry => path.join(currentDirectory, entry.name));
  const candidates = discovered
    .filter(hasModuleList)
    .map(directory => ({ directory, modified: fs.statSync(path.join(directory, 'module-info.jsonl')).mtimeMs }))
    .sort((left, right) => right.modified - left.modified || right.directory.localeCompare(left.directory));
  if (candidates.length) return { directory: candidates[0].directory, reason: 'latest', candidates: candidates.map(candidate => candidate.directory) };

  const details = [
    `No module workspace found in ${currentDirectory}.`,
    `Expected: ${path.join(expected, 'module-info.jsonl')}`
  ];
  if (discovered.length) {
    details.push('Found directories without module-info.jsonl:');
    details.push(...discovered.map(directory => `  ${directory}`));
  }
  details.push("Run 'modules find <pattern>' first, or use 'modules load --workspace <directory>'.");
  throw new Error(details.join('\n'));
}

function parseModuleArgs(args) {
  const positional = [];
  let workspace;
  for (let index = 0; index < args.length; index++) {
    if (['-w', '--workspace', '--directory'].includes(args[index])) {
      if (!args[index + 1]) throw new Error(`${args[index]} requires a directory.`);
      workspace = args[++index];
    } else positional.push(args[index]);
  }
  return { positional, workspace };
}

async function findModules(context, suppliedPattern, requestedWorkspace, forceNew = false) {
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
   const records = lines.filter(line => line.startsWith('{')).map(parseModuleRecord);
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

   let directory;
   let workspaceReason = 'new';
   if (requestedWorkspace) {
     directory = path.resolve(requestedWorkspace);
   } else if (forceNew) {
     directory = datedModuleDirectory();
   } else {
     const resolved = tryResolveModuleWorkspace({});
     if (resolved) {
       directory = resolved.directory;
       workspaceReason = resolved.reason;
     } else {
       directory = datedModuleDirectory();
     }
   }
   if (workspaceReason === 'latest') {
     console.log(`Reusing latest module workspace: ${path.relative(process.cwd(), directory) || directory}`);
   } else if (workspaceReason === 'today') {
     console.log(`Reusing today's module workspace: ${path.relative(process.cwd(), directory) || directory}`);
   } else if (workspaceReason === 'current-directory') {
     console.log(`Reusing current module workspace: ${path.relative(process.cwd(), directory) || '.'}`);
   } else if (workspaceReason === 'new') {
     console.log(`Creating new module workspace: ${path.relative(process.cwd(), directory) || directory}`);
   }
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
  if (successes.length) fs.appendFileSync(path.join(directory, 'module-info.jsonl'), `${successes.join('\n')}\n`);
  if (failures.length) {
    console.error(`Some modules failed to download:\n${failures.map(({ record, result }) => `  ${record.uri}: ${result?.error?.message || 'unknown error'}`).join('\n')}`);
  }
  console.log(`Edit files in ${path.basename(directory)}/edited, then run: mlsh modules load`);
  return failures.length ? 1 : 0;
}

function readModuleEntries(directory) {
  const info = path.join(directory, 'module-info.jsonl');
  return fs.readFileSync(info, 'utf8').split(/\r?\n/).filter(Boolean).map(parseModuleRecord);
}

async function loadModules(context, mode = '', requestedWorkspace) {
  const workspace = resolveModuleWorkspace({ requested: requestedWorkspace });
  const directory = workspace.directory;
  if (workspace.reason === 'latest') {
    console.log(`Using latest module workspace: ${path.relative(process.cwd(), directory) || directory}`);
    if (workspace.candidates.length > 1) console.log(`Other workspaces are available; select one with --workspace <directory>.`);
  } else if (workspace.reason === 'requested' || workspace.reason === 'current-directory') {
    console.log(`Using module workspace: ${path.relative(process.cwd(), directory) || '.'}`);
  }
  context.logger.info(`module workspace=${directory} selection=${workspace.reason} cwd=${process.cwd()}`);
  let records = readModuleEntries(directory);
  if (!records.length) throw new Error(`No modules found in ${path.join(directory, 'module-info.jsonl')}.`);
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
  const sourceDirectory = mode === 'reset' ? 'originals' : 'edited';
  console.log(`Loading ${records.length} module${records.length === 1 ? '' : 's'} from ${path.join(path.basename(directory), sourceDirectory)}`);
  console.log(`Target: ${context.environment.protocol}://${context.environment.host}:${context.environment.port} database=${context.environment.modules_db}`);
  const results = await mapLimit(records, concurrency, async record => {
    const source = path.join(directory, sourceDirectory, record.localName);
    if (!fs.existsSync(source)) {
      console.log(`Skipping ${record.uri}: ${source} not found.`);
      return { ok: true, skipped: true };
    }
    const endpoint = `/v1/documents?uri=${encodeURIComponent(record.uri)}&database=${encodeURIComponent(context.environment.modules_db)}`;
    const response = await context.client.request(endpoint, ['-X', 'PUT', '-T', source]);
    if (!response.ok) {
      const detail = response.body.toString().replace(/\s+/g, ' ').trim().slice(0, 500);
      throw new Error(`HTTP ${response.status || 'transport-error'}${detail ? ` — ${detail}` : ''}`);
    }
    console.log(`Loaded ${record.uri}`);
    return { ok: true };
  });
  const failures = results.map((result, index) => ({ result, record: records[index] })).filter(({ result }) => !result?.ok);
  const skipped = results.filter(result => result?.skipped).length;
  const loaded = results.length - failures.length - skipped;
  if (failures.length) console.error(`Some modules failed to load:\n${failures.map(({ record, result }) => `  ${record.uri}\n    ${result?.error?.message || 'unknown error'}`).join('\n')}`);
  console.log(`Module load complete: ${loaded} loaded, ${skipped} skipped, ${failures.length} failed.`);
  if (failures.length) console.log(`Full request and response details: ${context.logFile}`);
  return failures.length ? 1 : 0;
}

async function cloneModule(requestedWorkspace) {
  const { directory } = resolveModuleWorkspace({ requested: requestedWorkspace });
  readModuleEntries(directory);
  const source = await ask('Module file name to clone: ');
  const target = await ask('New module file name: ');
  if (!source || !target) return 0;
  for (const subdirectory of ['originals', 'edited']) {
    fs.copyFileSync(path.join(directory, subdirectory, source), path.join(directory, subdirectory, target));
  }
  console.log(`Cloned ${source} to ${target}. Add its destination URI to ${path.join(path.basename(directory), 'module-info.jsonl')} before loading.`);
  return 0;
}

export async function runModules(context, args) {
  const { positional, workspace } = parseModuleArgs(args);
  const command = positional[0];
  if (['-h', '--help'].includes(command) || !command) return showHelp('modules');
  if (['find', 'retrieve', 'match', 'search'].includes(command)) return findModules(context, positional[1], workspace, false);
  if (['new'].includes(command)) return findModules(context, positional[1], workspace, true);
  const selectedWorkspace = workspace || positional[1];
  if (['load', 'update'].includes(command)) return loadModules(context, '', selectedWorkspace);
  if (['loadOne', 'load-one'].includes(command)) return loadModules(context, 'one', selectedWorkspace);
  if (command === 'reset') return loadModules(context, 'reset', selectedWorkspace);
  if (command === 'clone') return cloneModule(selectedWorkspace);
  throw new Error(`Unknown modules command: ${command}`);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
