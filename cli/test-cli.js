#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  activateEnvironment,
  configDirectory,
  defaultEnvironment,
  environmentPath,
  listEnvironments,
  parseEnvironment,
  saveEditedEnvironment,
  writeEnvironment
} from './lib/environment-files.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-test-'));
let passed = 0;

function test(name, run) {
  try {
    run();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}

try {
  const directory = configDirectory(home);

  test('creates a default editable environment', () => {
    const file = writeEnvironment('dev', directory);
    const settings = parseEnvironment(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(settings, defaultEnvironment('dev'));
  });

  test('lists environment files alphabetically', () => {
    writeEnvironment('prod', directory);
    assert.deepEqual(listEnvironments(directory), ['dev', 'prod']);
  });

  test('uses the name in the file when saving an environment', () => {
    const file = writeEnvironment('new', directory);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('name=new', 'name=staging'));
    const saved = saveEditedEnvironment(file, directory);
    assert.equal(saved.name, 'staging');
    assert.ok(fs.existsSync(environmentPath('staging', directory)));
    assert.ok(!fs.existsSync(file));
  });

  test('rejects unsafe environment names', () => {
    assert.throws(() => environmentPath('../prod', directory), /letters, numbers/);
  });

  test('activates an environment in shell-compatible form', () => {
    const settings = activateEnvironment('dev', directory, home);
    const generated = fs.readFileSync(path.join(home, '.mlshrc-gen'), 'utf8');
    assert.equal(settings.host, 'localhost');
    assert.match(generated, /export ML_ENV="dev"/);
    assert.match(generated, /export ML_CONTENT_DB="content"/);
  });

  test('preserves quoted glob arguments in the command dispatcher', () => {
    const script = path.resolve('scripts/mlsh.sh');
    const result = spawnSync('bash', ['-c', `source "${script}"; mlsh_command modules '*tran*'`], {
      cwd: home,
      env: { ...process.env, HOME: home, MLSH_TOP_DIR: path.resolve('.'), ML_ENV: 'test' },
      encoding: 'utf8'
    });
    assert.match(result.stdout, /No modules match '\*tran\*'/);
  });
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} passed`);
if (process.exitCode) process.exit(process.exitCode);
