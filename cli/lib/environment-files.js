import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULTS = {
  name: 'dev',
  protocol: 'http',
  host: 'localhost',
  port: '8000',
  user: 'admin',
  pass: 'admin',
  modules_db: 'modules',
  content_db: 'content',
  triggers_db: 'triggers',
  schemas_db: 'schemas',
  insecure: 'false'
};

const PROCESS_KEYS = {
  ML_ENV: 'name',
  ML_PROTOCOL: 'protocol',
  ML_HOST: 'host',
  ML_PORT: 'port',
  ML_USER: 'user',
  ML_PASS: 'pass',
  ML_MODULES_DB: 'modules_db',
  ML_CONTENT_DB: 'content_db',
  ML_TRIGGERS_DB: 'triggers_db',
  ML_SCHEMAS_DB: 'schemas_db',
  ML_INSECURE: 'insecure'
};

// True if this environment's protocol/insecure settings mean TLS certificate
// verification should be skipped (self-signed or internally-issued certs).
export function isInsecure(environment) {
  return String(environment?.insecure).toLowerCase() === 'true';
}

export function configDirectory(home = os.homedir()) {
  return path.join(home, '.mlsh', 'environments');
}

export function environmentPath(name, directory) {
  validateEnvironmentName(name);
  return path.join(directory, `${name}.env`);
}

export function validateEnvironmentName(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error('Environment names may contain letters, numbers, dashes, and underscores only.');
  }
}

export function defaultEnvironment(name = 'dev') {
  return { ...DEFAULTS, name };
}

export function parseEnvironment(content) {
  const environment = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z_]+)\s*=\s*(.*)\s*$/i);
    if (match) environment[match[1].toLowerCase()] = match[2];
  }
  return environment;
}

export function parseShellEnvironment(content) {
  const environment = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*export\s+([A-Z][A-Z0-9_]*)=(?:"((?:\\.|[^"])*)"|'([^']*)'|(.*))\s*$/);
    if (!match || !PROCESS_KEYS[match[1]]) continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    environment[PROCESS_KEYS[match[1]]] = raw.replace(/\\(["\\$`])/g, '$1');
  }
  return environment;
}

export function environmentFromProcess(processEnvironment = process.env) {
  const environment = {};
  for (const [variable, key] of Object.entries(PROCESS_KEYS)) {
    if (processEnvironment[variable] !== undefined && processEnvironment[variable] !== '') {
      environment[key] = processEnvironment[variable];
    }
  }
  return environment;
}

export function loadActiveEnvironment(home = os.homedir(), processEnvironment = process.env) {
  const fromProcess = environmentFromProcess(processEnvironment);
  const directory = configDirectory(home);
  const selected = fromProcess.name || currentEnvironment(home);
  let stored = {};

  if (selected) {
    const file = environmentPath(selected, directory);
    if (fs.existsSync(file)) stored = parseEnvironment(fs.readFileSync(file, 'utf8'));
  }

  if (Object.keys(stored).length === 0) {
    const generated = path.join(home, '.mlshrc-gen');
    if (fs.existsSync(generated)) stored = parseShellEnvironment(fs.readFileSync(generated, 'utf8'));
  }

  if (!selected && !fromProcess.name && !stored.name) return null;
  return { ...DEFAULTS, ...stored, ...fromProcess, name: fromProcess.name || stored.name || selected };
}

export function loadNamedEnvironment(name, home = os.homedir()) {
  validateEnvironmentName(name);
  const directory = configDirectory(home);
  const file = environmentPath(name, directory);
  if (!fs.existsSync(file)) throw new Error(`Environment '${name}' does not exist. Run 'mlsh env' to create it.`);
  return { ...defaultEnvironment(name), ...parseEnvironment(fs.readFileSync(file, 'utf8')), name };
}

export function environmentVariables(environment) {
  if (!environment) return {};
  return Object.fromEntries(Object.entries(PROCESS_KEYS).map(([variable, key]) => [variable, String(environment[key] ?? '')]));
}

export function environmentTemplate(name = 'dev') {
  const env = defaultEnvironment(name);
  return `# ENV SETTINGS\n# Change these values for your MarkLogic environment.\n# The file name and name value should match.\nname=${env.name}\nprotocol=${env.protocol}\nhost=${env.host}\nport=${env.port}\nuser=${env.user}\npass=${env.pass}\n\n# Set to true to trust this server's TLS certificate without a known CA\n# (e.g. self-signed or internally-issued certs). Used by eval/logs/qc/backup\n# (via curl) and by mlcp (via a per-environment Java trust store).\ninsecure=${env.insecure}\n\n# Database names\nmodules_db=${env.modules_db}\ncontent_db=${env.content_db}\ntriggers_db=${env.triggers_db}\nschemas_db=${env.schemas_db}\n`;
}

export function writeEnvironment(name, directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = environmentPath(name, directory);
  if (!fs.existsSync(file)) fs.writeFileSync(file, environmentTemplate(name), { mode: 0o600 });
  return file;
}

export function saveEditedEnvironment(file, directory) {
  const environment = parseEnvironment(fs.readFileSync(file, 'utf8'));
  const name = environment.name;
  validateEnvironmentName(name);
  const destination = environmentPath(name, directory);
  if (file !== destination && fs.existsSync(destination)) {
    throw new Error(`Environment '${name}' already exists. Choose another name in ${file}.`);
  }
  if (file !== destination) fs.renameSync(file, destination);
  return { name, file: destination };
}

export function listEnvironments(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(file => file.endsWith('.env'))
    .map(file => file.slice(0, -4))
    .sort();
}

export function generateShellConfig(environment) {
  const env = { ...DEFAULTS, ...environment };
  const value = key => String(env[key] ?? '').replace(/[\\`"$]/g, character => `\\${character}`);
  return `#!/bin/bash\n# Generated by mlsh env. Edit ~/.mlsh/environments/${value('name')}.env instead.\nexport ML_ENV="${value('name')}"\nexport ML_PROTOCOL="${value('protocol')}"\nexport ML_HOST="${value('host')}"\nexport ML_PORT="${value('port')}"\nexport ML_USER="${value('user')}"\nexport ML_PASS="${value('pass')}"\nexport ML_INSECURE="${value('insecure')}"\nexport ML_MODULES_DB="${value('modules_db')}"\nexport ML_CONTENT_DB="${value('content_db')}"\nexport ML_TRIGGERS_DB="${value('triggers_db')}"\nexport ML_SCHEMAS_DB="${value('schemas_db')}"\n`;
}

export function activateEnvironment(name, directory, home = os.homedir()) {
  const file = environmentPath(name, directory);
  if (!fs.existsSync(file)) throw new Error(`Environment '${name}' does not exist.`);
  const environment = { ...defaultEnvironment(name), ...parseEnvironment(fs.readFileSync(file, 'utf8')), name };
  fs.writeFileSync(path.join(home, '.mlshrc-gen'), generateShellConfig(environment), { mode: 0o600 });
  fs.writeFileSync(path.join(home, '.mlsh', 'current-env'), `${name}\n`, { mode: 0o600 });
  return environment;
}

export function currentEnvironment(home = os.homedir()) {
  const file = path.join(home, '.mlsh', 'current-env');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}
