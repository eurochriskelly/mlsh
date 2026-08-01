import fs from 'fs';
import path from 'path';
import { edit } from '../lib/editor.js';
import { isInsecure, loadNamedEnvironment } from '../lib/environment-files.js';
import { confirm } from '../lib/prompt.js';
import { runProcess } from '../lib/process.js';
import { ensureTrustedCertificates } from '../lib/trust.js';

// MlcpTask properties (com.marklogic.gradle.task.MlcpTask), excluding:
//  - command/host/port/username/password/ssl/input_*/output_* connection
//    identity fields, which MLSH always derives from its own environments
//  - options_file/logOutputUri/logClient, which are out of scope for jobs
export const KNOWN_MLCP_PROPERTIES = {
  aggregate_record_element: 'string',
  aggregate_record_namespace: 'string',
  archive_metadata_optional: 'bool',
  batch_size: 'int',
  collection_filter: 'string',
  compress: 'bool',
  conf: 'string',
  content_encoding: 'string',
  copy_collections: 'string',
  copy_metadata: 'string',
  copy_permissions: 'string',
  copy_properties: 'string',
  copy_quality: 'string',
  data_type: 'string',
  database: 'string',
  delimiter: 'string',
  delimited_root_name: 'string',
  directory_filter: 'string',
  document_selector: 'string',
  document_type: 'string',
  fastload: 'bool',
  filename_as_collection: 'string',
  generate_uri: 'bool',
  hadoop_conf_dir: 'string',
  indented: 'bool',
  input_compressed: 'bool',
  input_compression_codec: 'string',
  input_database: 'string',
  input_file_path: 'string',
  input_file_pattern: 'string',
  input_file_type: 'string',
  max_split_size: 'int',
  min_split_size: 'int',
  mode: 'string',
  modules: 'string',
  modules_root: 'string',
  namespace: 'string',
  output_cleandir: 'bool',
  output_collections: 'string',
  output_database: 'string',
  output_directory: 'string',
  output_file_path: 'string',
  output_graph: 'string',
  output_language: 'string',
  output_override_graph: 'string',
  output_partition: 'string',
  output_permissions: 'string',
  output_quality: 'string',
  output_type: 'string',
  output_uri_prefix: 'string',
  output_uri_replace: 'string',
  output_uri_suffix: 'string',
  path_namespace: 'string',
  query_filter: 'string',
  redaction: 'string',
  restrict_hosts: 'bool',
  restrict_input_hosts: 'bool',
  restrict_output_hosts: 'bool',
  sequencefile_key_class: 'string',
  sequencefile_value_class: 'string',
  sequencefile_value_type: 'string',
  snapshot: 'bool',
  split_input: 'bool',
  streaming: 'bool',
  temporal_collection: 'string',
  thread_count: 'int',
  thread_count_per_split: 'int',
  tolerate_errors: 'bool',
  transform_function: 'string',
  transform_module: 'string',
  transform_namespace: 'string',
  transform_param: 'string',
  transaction_size: 'int',
  type_filter: 'string',
  uri_id: 'string',
  xml_repair_level: 'string'
};

// Connection identity fields must always come from MLSH's own environment
// files, never from a job file, so credentials can't leak into a shared
// .jobs/mlcp/*.job file that might get committed to source control.
const FORBIDDEN_KEYS = new Set([
  'host', 'port', 'username', 'password', 'ssl',
  'input_host', 'input_port', 'input_username', 'input_password', 'input_ssl',
  'output_host', 'output_port', 'output_username', 'output_password', 'output_ssl',
  'options_file'
]);

const META_KEYS = new Set(['job', 'env_from', 'env_to']);

const COLLECTIONS_ALIAS_TARGET = { import: 'output_collections', export: 'collection_filter', copy: 'collection_filter' };

export const MLCP_OPERATIONS = ['import', 'export', 'copy'];

export function jobDirectory(cwd = process.cwd(), operation) {
  return path.join(cwd, '.jobs', 'mlcp', operation);
}

export function listJobs(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(file => file.endsWith('.job'))
    .map(file => file.slice(0, -4))
    .sort();
}

export function validateJobName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error('Job names may contain letters, numbers, dashes, and underscores only.');
  }
}

export function jobBaseName(name) {
  return name.endsWith('.job') ? name.slice(0, -4) : name;
}

export function resolveJobFile(directory, name) {
  const base = jobBaseName(name);
  validateJobName(base);
  return path.join(directory, `${base}.job`);
}

export function nextJobName(directory) {
  if (!fs.existsSync(directory)) return '001';
  const numbers = fs.readdirSync(directory)
    .filter(file => file.endsWith('.job'))
    .map(file => file.slice(0, -4))
    .filter(name => /^\d+$/.test(name))
    .map(Number);
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return String(next).padStart(3, '0');
}

export function jobTemplate(operation, name) {
  if (operation === 'import') {
    return `# Configure an MLCP import job.
job=${name}

# env_to=local
# database=content
input_file_path=.jobs/mlcp/import/data/${name}
input_file_type=archive

# collections=foo,bar
# output_uri_prefix=/data/
# thread_count=4
`;
  }
  if (operation === 'export') {
    return `# Configure an MLCP export job.
job=${name}

# env_from=local
# database=content
output_file_path=.jobs/mlcp/export/data/${name}
output_type=archive

# collections=foo,bar
# query_filter=...
# compress=true
# thread_count=4
`;
  }
  return `# Configure an MLCP copy job.
job=${name}

# Both default to the active environment.
# env_from=development
# env_to=local

# input_database defaults to env_from's content_db.
# output_database defaults to env_to's content_db.
# input_database=content
# output_database=content

collections=foo,bar

# copy_collections=true
# copy_permissions=true
# copy_properties=true
# thread_count=4
`;
}

export function parseJobFile(content) {
  const fields = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) fields[match[1].toLowerCase()] = match[2].trim();
  }
  return fields;
}

function coerce(key, type, value) {
  if (type === 'bool') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
    throw new Error(`Job option '${key}' must be true or false, got '${value}'.`);
  }
  if (type === 'int') {
    const number = Number(value);
    if (!Number.isInteger(number)) throw new Error(`Job option '${key}' must be a whole number, got '${value}'.`);
    return number;
  }
  return value;
}

function connectionProperties(prefix, environment) {
  const properties = {
    [`${prefix}host`]: environment.host,
    [`${prefix}port`]: Number(environment.port),
    [`${prefix}username`]: environment.user,
    [`${prefix}password`]: environment.pass
  };
  if (String(environment.protocol).toLowerCase() === 'https') properties[`${prefix}ssl`] = true;
  return properties;
}

// Splits job fields into: meta (job/env_from/env_to, consumed by MLSH itself),
// known typed MlcpTask properties, and extraArgs for anything MlcpTask
// doesn't expose as a typed property (forwarded as raw "-key value" pairs).
export function classifyJobFields(operation, fields) {
  const meta = {};
  const rest = {};
  for (const [key, value] of Object.entries(fields)) {
    if (META_KEYS.has(key)) meta[key] = value;
    else rest[key] = value;
  }

  if (rest.collections !== undefined) {
    const target = COLLECTIONS_ALIAS_TARGET[operation];
    if (rest[target] === undefined) rest[target] = rest.collections;
    delete rest.collections;
  }

  for (const key of Object.keys(rest)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`'${key}' can't be set in a job file; connection details always come from the active MLSH environment.`);
    }
  }

  const properties = {};
  const extraArgs = [];
  for (const [key, value] of Object.entries(rest)) {
    const type = KNOWN_MLCP_PROPERTIES[key];
    if (type) properties[key] = coerce(key, type, value);
    else extraArgs.push(`-${key}`, value);
  }

  return { meta, properties, extraArgs };
}

export function resolveEnvironmentsForOperation(operation, meta, context) {
  const load = name => loadNamedEnvironment(name, context.home);
  if (operation === 'import') return { envTo: meta.env_to ? load(meta.env_to) : context.environment };
  if (operation === 'export') return { envFrom: meta.env_from ? load(meta.env_from) : context.environment };
  return {
    envFrom: meta.env_from ? load(meta.env_from) : context.environment,
    envTo: meta.env_to ? load(meta.env_to) : context.environment
  };
}

// MlcpTask/mlcp options that accept filesystem paths. mlcp's own working
// directory is the bundled Gradle runner's directory (gradle/mlcp/), not
// wherever the user ran `mlsh mlcp` from - so relative paths here must be
// resolved against baseDirectory before being handed to mlcp, or they'd
// silently be looked up in the wrong place.
const PATH_OPTION_KEYS = ['input_file_path', 'output_file_path', 'output_directory', 'conf', 'hadoop_conf_dir'];

// Pure: resolves any relative filesystem-path options against baseDirectory,
// leaving absolute paths untouched.
export function resolvePathOptions(properties, baseDirectory) {
  const resolved = { ...properties };
  for (const key of PATH_OPTION_KEYS) {
    if (typeof resolved[key] === 'string' && !path.isAbsolute(resolved[key])) {
      resolved[key] = path.resolve(baseDirectory, resolved[key]);
    }
  }
  return resolved;
}

// Pure: combines classified job fields and resolved environments into the
// final MlcpTask property map, extra args, and mlcp command name. Relative
// path options are resolved against baseDirectory (defaulting to the
// current working directory, i.e. wherever `mlsh mlcp` was run from).
export function buildMlcpInvocation(operation, fields, environments, baseDirectory = process.cwd()) {
  const { meta, properties, extraArgs } = classifyJobFields(operation, fields);

  let finalProperties;
  if (operation === 'import') {
    finalProperties = { database: environments.envTo.content_db, ...properties, ...connectionProperties('', environments.envTo) };
    if (!finalProperties.input_file_path) throw new Error("Import jobs must set 'input_file_path'.");
  } else if (operation === 'export') {
    finalProperties = { database: environments.envFrom.content_db, ...properties, ...connectionProperties('', environments.envFrom) };
    if (!finalProperties.output_file_path) throw new Error("Export jobs must set 'output_file_path'.");
  } else {
    finalProperties = {
      input_database: environments.envFrom.content_db,
      output_database: environments.envTo.content_db,
      ...properties,
      ...connectionProperties('input_', environments.envFrom),
      ...connectionProperties('output_', environments.envTo)
    };
  }

  return { command: operation.toUpperCase(), properties: resolvePathOptions(finalProperties, baseDirectory), extraArgs, meta };
}

export function redactedSummary({ command, properties }) {
  const safe = { ...properties };
  for (const key of Object.keys(safe)) {
    if (/password$/.test(key)) safe[key] = '********';
  }
  return `${command} ${JSON.stringify(safe)}`;
}

// editFn defaults to edit(), which always prefers the real controlling
// terminal (/dev/tty) over whatever stdio the current process happens to
// have - see lib/editor.js. The editFn parameter mainly exists for tests.
export function createAndEditJob(directory, operation, name, { temporary = false, editFn = edit } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const workingFile = temporary ? path.join(directory, `.new-${process.pid}.job`) : resolveJobFile(directory, name);
  fs.writeFileSync(workingFile, jobTemplate(operation, name));
  editFn(workingFile);
  const fields = parseJobFile(fs.readFileSync(workingFile, 'utf8'));
  const finalName = jobBaseName(fields.job || name);
  validateJobName(finalName);
  const destination = resolveJobFile(directory, finalName);
  if (destination !== workingFile) {
    if (fs.existsSync(destination)) {
      fs.unlinkSync(workingFile);
      throw new Error(`Job '${finalName}' already exists at ${destination}.`);
    }
    fs.renameSync(workingFile, destination);
  }
  return { fields, name: finalName };
}

function gradleRunnerDirectory(context) {
  return context.processEnvironment?.MLSH_MLCP_RUNNER_DIR || path.join(context.topDir, 'gradle', 'mlcp');
}

function gradlewExecutable(context) {
  const directory = gradleRunnerDirectory(context);
  return path.join(directory, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
}

// Pure: which host:port pairs need trust-on-first-use certificate handling,
// based on which resolved environments (if any) are marked insecure=true.
export function insecureEntries(operation, environments) {
  const entries = [];
  if (operation === 'import' || operation === 'copy') {
    const environment = environments.envTo;
    if (environment && isInsecure(environment)) entries.push({ host: environment.host, port: environment.port });
  }
  if (operation === 'export' || operation === 'copy') {
    const environment = environments.envFrom;
    if (environment && isInsecure(environment)) entries.push({ host: environment.host, port: environment.port });
  }
  return entries;
}

// Deterministic-ish (timestamped) path for a job run's captured MLCP/Gradle
// output. Exported so callers that want to reference the exact same log file
// afterward (e.g. the TUI's "view in less" prompt) can compute it up front
// and pass it into executeInvocation via the logFile option.
export function mlcpLogPath(home, operation, name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(home, '.mlsh', 'mlcp-logs', `${operation}-${name}-${timestamp}.log`);
}

// Resolves environments, builds the MlcpTask invocation, and runs it via the
// bundled ml-gradle wrapper. Shared by the direct CLI path and the TUI's
// 'r' (run) key, so both behave identically.
export async function executeInvocation(context, operation, name, fields, directory, { logFile } = {}) {
  const environments = resolveEnvironmentsForOperation(operation, { env_from: fields.env_from, env_to: fields.env_to }, context);
  const invocation = buildMlcpInvocation(operation, fields, environments);
  context.logger.info(`mlcp job: ${name} ${redactedSummary(invocation)}`);

  const gradlew = gradlewExecutable(context);
  if (!fs.existsSync(gradlew)) throw new Error(`Bundled MLCP runner not found at ${gradlew}.`);

  const untrustedEntries = insecureEntries(operation, environments);
  let jvmArgs = [];
  let trust = null;
  if (untrustedEntries.length) {
    trust = await ensureTrustedCertificates(untrustedEntries, context.home);
    if (trust) {
      jvmArgs = [
        `-Djavax.net.ssl.trustStore=${trust.trustStorePath}`,
        `-Djavax.net.ssl.trustStorePassword=${trust.trustStorePassword}`,
        `-Djavax.net.ssl.trustStoreType=${trust.trustStoreType}`
      ];
    }
  }

  const resolvedLogFile = logFile || mlcpLogPath(context.home, operation, name);
  fs.mkdirSync(path.dirname(resolvedLogFile), { recursive: true });

  const header = diagnosticsHeader({ name, directory, invocation, environments, untrustedEntries, trust, jvmArgs, logFile: resolvedLogFile });
  console.log(header);
  fs.writeFileSync(resolvedLogFile, `${header}\n${'═'.repeat(63)}\n`);

  const gradleArgs = [
    '--no-daemon', '--quiet', '--console=plain',
    `-Pmlsh.mlcp.command=${invocation.command}`,
    `-Pmlsh.mlcp.options=${JSON.stringify(invocation.properties)}`,
    `-Pmlsh.mlcp.extraArgs=${JSON.stringify(invocation.extraArgs)}`,
    `-Pmlsh.mlcp.jvmArgs=${JSON.stringify(jvmArgs)}`,
    'mlshMlcp'
  ];

  const result = await runProcess(gradlew, gradleArgs, {
    cwd: gradleRunnerDirectory(context),
    env: context.processEnvironment,
    inherit: true,
    logFile: resolvedLogFile,
    appendLogFile: true
  });
  console.log(`\nMLCP completed with exit code: ${result.code}`);
  console.log(`Full output saved to: ${resolvedLogFile}`);
  if (result.code !== 0) printLogTail(resolvedLogFile);
  return result.code;
}

// Prints the last handful of lines of a failed run's log directly to the
// console, so a failure is readable without opening the file separately -
// this is deliberately printed to normal (non-alt-screen) stdout so it's
// easy to select/copy from a terminal.
function printLogTail(logFile, maxLines = 60) {
  try {
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
    const tail = lines.slice(-maxLines).join('\n');
    console.log(`\n----- last ${Math.min(maxLines, lines.length)} lines of ${logFile} -----`);
    console.log(tail);
    console.log('----- end of log excerpt -----');
  } catch {
    // Best-effort only; the caller already has the log file path to check manually.
  }
}

// Builds the plain-text diagnostics block written to the top of every job's
// log file (and printed to the console) - resolved environment(s), exactly
// where each came from, whether insecure=true was actually detected (and if
// not, why), and the trust store state. This exists so a failure can be
// diagnosed from the log alone, without guessing or re-running.
export function diagnosticsHeader({ name, directory, invocation, environments, untrustedEntries, trust, jvmArgs, logFile }) {
  const lines = [];
  lines.push(`MLSH MLCP job: ${name} (${directory})`);
  lines.push(`Command: ${invocation.command}`);
  lines.push(`Log file: ${logFile}`);
  lines.push('');
  for (const [role, environment] of Object.entries(environments)) {
    if (!environment) continue;
    const source = environment._file ? environment._file : '(active environment / process env vars)';
    const insecureSource = environment._insecureExplicit ? `explicitly set in ${source}` : `not set - defaulted to false`;
    lines.push(`${role}: '${environment.name}' -> ${environment.protocol}://${environment.host}:${environment.port}`);
    lines.push(`  source: ${source}`);
    lines.push(`  insecure=${isInsecure(environment)} (${insecureSource})`);
    if (String(environment.protocol).toLowerCase() === 'https' && !isInsecure(environment)) {
      lines.push(`  WARNING: protocol is https but insecure is not true - the JVM will require this`);
      lines.push(`           certificate to validate against the system's default CA trust store.`);
      lines.push(`           If this server uses a self-signed or internal certificate, add`);
      lines.push(`           'insecure=true' to ${source === '(active environment / process env vars)' ? "this environment's file" : source}.`);
    }
  }
  lines.push('');
  if (untrustedEntries.length) {
    lines.push(`Trust-on-first-use requested for: ${untrustedEntries.map(entry => `${entry.host}:${entry.port}`).join(', ')}`);
    if (trust) {
      lines.push(`Trust store: ${trust.trustStorePath} (${trust.trustStoreType})`);
      for (const entry of trust.imported) lines.push(`  imported alias '${entry.alias}': ${entry.subject}`);
    } else {
      lines.push('Trust store: not built (see errors above, if any).');
    }
  } else {
    lines.push('No environment in this job requested insecure=true; using the default JVM trust store.');
  }
  lines.push(`JVM args: ${jvmArgs.length ? jvmArgs.join(' ') : '(none)'}`);
  return lines.join('\n');
}

const USAGE = `Usage: mlsh mlcp [import|export|copy] [job]

Runs MLCP (via ml-gradle) using a job file under .jobs/mlcp/<operation>/<job>.job
in the current directory. If [job] is omitted, or doesn't exist yet, an editor
opens a template with sensible defaults for the chosen operation.

Run 'mlsh mlcp' with no arguments for an interactive job browser.`;

export async function runMlcp(context, args) {
  const operation = args[0];

  if (!operation) {
    const { openControllingTty } = await import('../lib/tui.js');
    const controllingTty = openControllingTty();
    if (controllingTty) {
      const { runMlcpTui } = await import('./mlcp-tui.js');
      return runMlcpTui(context, controllingTty);
    }
    const { lineBasedInteractiveMlcp } = await import('./mlcp-line.js');
    return lineBasedInteractiveMlcp(context);
  }
  if (['help', '-h', '--help'].includes(operation)) {
    console.log(USAGE);
    return 0;
  }
  if (!MLCP_OPERATIONS.includes(operation)) {
    throw new Error(`Unknown mlcp command: ${operation}. Use import, export, or copy.`);
  }

  const directory = jobDirectory(process.cwd(), operation);
  const jobArgument = args[1];
  let fields;
  let name;
  let created = false;

  if (jobArgument) {
    const file = resolveJobFile(directory, jobArgument);
    if (fs.existsSync(file)) {
      name = jobBaseName(jobArgument);
      fields = parseJobFile(fs.readFileSync(file, 'utf8'));
    } else {
      ({ fields, name } = createAndEditJob(directory, operation, jobBaseName(jobArgument)));
      created = true;
    }
  } else {
    const generatedName = nextJobName(directory);
    ({ fields, name } = createAndEditJob(directory, operation, generatedName, { temporary: true }));
    created = true;
  }

  if (created && !(await confirm(`Run this ${operation} job now? (y/n): `))) return 0;
  return executeInvocation(context, operation, name, fields, directory);
}
