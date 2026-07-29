#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import {
  activateEnvironment,
  configDirectory,
  currentEnvironment,
  environmentPath,
  listEnvironments,
  parseEnvironment,
  saveEditedEnvironment,
  writeEnvironment
} from './lib/environment-files.js';
import { parseExistingMlshrc } from './lib/parser.js';

const home = process.env.HOME || os.homedir();
const directory = configDirectory(home);

function editor() {
  if (process.env.EDITOR) return process.env.EDITOR;
  for (const candidate of ['nvim', 'vim', 'vi']) {
    if (spawnSync('which', [candidate], { stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('No editor found. Set $EDITOR or install nvim, vim, or vi.');
}

function edit(file) {
  const result = spawnSync(editor(), [file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Editor exited with status ${result.status}.`);
}

function migrateLegacyConfig() {
  if (listEnvironments(directory).length > 0) return;
  const jsonFile = path.join(home, '.mlshrc.json');
  if (fs.existsSync(jsonFile)) {
    const { environments, currentEnv } = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    for (const [name, variables] of Object.entries(environments || {})) {
      writeMigratedEnvironment(name, variables);
    }
    if (currentEnv && environments[currentEnv]) activateEnvironment(currentEnv, directory, home);
    return;
  }
  const legacyFile = path.join(home, '.mlshrc');
  if (!fs.existsSync(legacyFile)) return;
  const { environments, currentEnv } = parseExistingMlshrc(fs.readFileSync(legacyFile, 'utf8'));
  for (const [name, variables] of Object.entries(environments)) {
    writeMigratedEnvironment(name, variables);
  }
  if (currentEnv && environments[currentEnv]) activateEnvironment(currentEnv, directory, home);
}

function writeMigratedEnvironment(name, variables) {
  const file = writeEnvironment(name, directory);
  const content = Object.entries({
    name,
    protocol: variables.ML_PROTOCOL || 'http',
    host: variables.ML_HOST || 'localhost',
    port: variables.ML_PORT || '8000',
    user: variables.ML_USER || 'admin',
    pass: variables.ML_PASS || 'admin',
    modules_db: variables.ML_MODULES_DB || 'modules',
    content_db: variables.ML_CONTENT_DB || 'content',
    triggers_db: variables.ML_TRIGGERS_DB || 'triggers',
    schemas_db: variables.ML_SCHEMAS_DB || 'schemas'
  }).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.writeFileSync(file, `${content}\n`, { mode: 0o600 });
}

function prompt(question) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => input.question(question, answer => {
    input.close();
    resolve(answer.trim());
  }));
}

async function chooseEnvironment(environments) {
  const current = currentEnvironment(home);
  console.log('\nMLSH environments:\n');
  environments.forEach((name, index) => {
    const details = parseEnvironment(fs.readFileSync(environmentPath(name, directory), 'utf8'));
    const marker = name === current ? ' (current)' : '';
    console.log(`  ${index + 1}. ${name} - ${details.protocol || 'http'}://${details.host || 'localhost'}:${details.port || '8000'}${marker}`);
  });
  console.log('\n  n. Create a new environment (set name= in the editor)');
  console.log('  q. Quit\n');
  const choice = await prompt('Select an environment to edit: ');
  if (choice.toLowerCase() === 'q' || choice === '') return null;
  if (choice.toLowerCase() === 'n') return 'new';
  const index = Number(choice) - 1;
  if (!Number.isInteger(index) || !environments[index]) throw new Error('Please enter a listed number, n, or q.');
  return environments[index];
}

function printEnvironments(environments) {
  const current = currentEnvironment(home);
  if (environments.length === 0) {
    console.log('No MLSH environments found.');
    return;
  }
  for (const name of environments) {
    const details = parseEnvironment(fs.readFileSync(environmentPath(name, directory), 'utf8'));
    const marker = name === current ? '*' : ' ';
    console.log(`${marker} ${name.padEnd(16)} ${details.protocol || 'http'}://${details.host || 'localhost'}:${details.port || '8000'}`);
  }
}

export async function runEnvironmentManager(args = []) {
  migrateLegacyConfig();
  let environments = listEnvironments(directory);
  const requested = args[0];

  if (requested === 'list' || requested === 'ls') {
    printEnvironments(environments);
    return;
  }
  if (requested === 'current') {
    console.log(currentEnvironment(home) || 'none');
    return;
  }
  if (requested && requested !== 'edit' && requested !== 'new') {
    if (!environments.includes(requested)) throw new Error(`Environment '${requested}' does not exist.`);
    const settings = activateEnvironment(requested, directory, home);
    console.log(`Active environment: ${settings.name} (${settings.protocol}://${settings.host}:${settings.port})`);
    return;
  }

  let name;
  if (environments.length === 0) {
    name = 'dev';
    console.log(`No environments found. Creating ${environmentPath(name, directory)}.`);
  } else {
    name = await chooseEnvironment(environments);
    if (!name) return;
  }
  const file = writeEnvironment(name, directory);
  edit(file);
  const saved = saveEditedEnvironment(file, directory);
  const settings = activateEnvironment(saved.name, directory, home);
  console.log(`\nActive environment: ${settings.name} (${settings.protocol}://${settings.host}:${settings.port})`);
  console.log(`Edit it again with: mlsh env`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runEnvironmentManager(process.argv.slice(2)).catch(error => {
    console.error(`mlsh env: ${error.message}`);
    process.exit(1);
  });
}
