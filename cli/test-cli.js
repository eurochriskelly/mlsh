#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { parseEvalArgs, pairsToJson, resolveScript } from './commands/eval.js';
import { mlcpConnectionArgs } from './commands/external.js';
import { normalisePattern, parseModuleRecord } from './commands/modules.js';
import { createContext } from './main.js';
import {
  activateEnvironment,
  configDirectory,
  defaultEnvironment,
  environmentPath,
  generateShellConfig,
  loadActiveEnvironment,
  listEnvironments,
  parseEnvironment,
  parseShellEnvironment,
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

  test('loads the active environment without sourcing shell code', () => {
    const loaded = loadActiveEnvironment(home, { HOME: home });
    assert.equal(loaded.name, 'dev');
    assert.equal(loaded.content_db, 'content');
  });

  test('reads legacy generated shell environments safely', () => {
    const parsed = parseShellEnvironment('export ML_ENV="test"\nexport ML_HOST="example.test"\nrun-something-dangerous\n');
    assert.deepEqual(parsed, { name: 'test', host: 'example.test' });
  });

  test('quotes generated shell values without executing their contents', () => {
    const marker = path.join(home, 'should-not-exist');
    const config = path.join(home, 'quoted-env.sh');
    const pass = `value$(touch ${marker})$HOME\`uname\`"quoted`;
    fs.writeFileSync(config, generateShellConfig({ ...defaultEnvironment('quoted'), pass }));
    const result = spawnSync('bash', ['-c', 'source "$1"; printf "%s" "$ML_PASS"', 'bash', config], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, pass);
    assert.ok(!fs.existsSync(marker));
  });

  test('parses eval options and variables without losing quoted values', () => {
    assert.deepEqual(parseEvalArgs(['--script', 'a file.xqy', '--database', 'Documents', '--vars', 'one=two&three=four']), {
      script: 'a file.xqy',
      database: 'Documents',
      params: '{"one":"two","three":"four"}',
      help: false
    });
    assert.equal(pairsToJson('message=hello world'), '{"message":"hello world"}');
  });

  test('resolves extensionless eval scripts', () => {
    const script = path.join(home, 'example.xqy');
    fs.writeFileSync(script, '1 + 1');
    assert.equal(resolveScript(path.join(home, 'example')), script);
  });

  test('normalises module patterns and parses server records', () => {
    assert.equal(normalisePattern('customer'), '*customer*');
    assert.equal(normalisePattern('*customer?.xqy'), '*customer?.xqy');
    assert.deepEqual(parseModuleRecord('/a.xqy~%a.xqy~read~apps~EOL'), {
      line: '/a.xqy~%a.xqy~read~apps~EOL',
      uri: '/a.xqy',
      localName: '%a.xqy',
      permissions: 'read',
      collections: 'apps'
    });
  });

  test('uses MLCP copy-specific connection arguments', () => {
    const environment = { host: 'localhost', port: '8000', user: 'admin', pass: 'secret' };
    const args = mlcpConnectionArgs('copy', environment);
    assert.deepEqual(args.slice(0, 8), ['-input_host', 'localhost', '-input_port', '8000', '-input_username', 'admin', '-input_password', 'secret']);
    assert.ok(args.includes('-output_host'));
    assert.equal(mlcpConnectionArgs('help', environment).length, 0);
  });

  test('runs eval through the Node dispatcher and preserves argument boundaries', () => {
    const binDirectory = path.join(home, 'bin');
    fs.mkdirSync(binDirectory);
    const curl = path.join(binDirectory, 'curl');
    const curlArguments = path.join(home, 'curl-arguments');
    fs.writeFileSync(curl, `#!/bin/sh
output=
previous=
printf '%s\n' "$@" > "$FAKE_CURL_ARGUMENTS"
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
done
printf '2' > "$output"
printf '200'
`);
    fs.chmodSync(curl, 0o755);
    const script = path.join(home, 'a script.xqy');
    fs.writeFileSync(script, '1 + 1');
    const result = spawnSync(process.execPath, [path.resolve('bin/mlsh'), 'eval', script, 'Documents'], {
      env: { ...process.env, HOME: home, PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`, FAKE_CURL_ARGUMENTS: curlArguments },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Evaluating: a script\.xqy/);
    assert.match(result.stdout, /Result:[\s\S]*2/);
    const curlArgs = fs.readFileSync(curlArguments, 'utf8').split('\n');
    assert.ok(curlArgs.includes(`xquery@${script}`));
    const diagnosticLog = fs.readFileSync(path.join(home, '.mlsh', 'mlsh.log'), 'utf8');
    assert.doesNotMatch(diagnosticLog, /-u admin:admin/);
    assert.match(diagnosticLog, /-u \*{8}:\*{8}/);
  });

  test('keeps MLSH commands as first-class functions in the interactive shell', () => {
    const result = spawnSync('bash', ['--noprofile', '--rcfile', path.resolve('shell/bashrc'), '-i', '-c', 'printf "types=%s,%s env=%s\\n" "$(type -t eval)" "$(type -t modules)" "$ML_ENV"; env prod >/dev/null; printf "switched=%s\\n" "$ML_ENV"'], {
      env: { ...process.env, HOME: home, MLSH_TOP_DIR: path.resolve('.'), TERM: 'xterm' },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /types=function,function env=dev/);
    assert.match(result.stdout, /switched=prod/);
  });

  test('creates a command context from the selected environment', () => {
    activateEnvironment('dev', directory, home);
    const context = createContext({ topDir: path.resolve('.'), processEnvironment: { HOME: home } });
    assert.equal(context.environment.name, 'dev');
    assert.equal(context.environment.host, 'localhost');
  });
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} passed`);
if (process.exitCode) process.exit(process.exitCode);
