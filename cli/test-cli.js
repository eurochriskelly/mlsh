#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { parseEvalArgs, pairsToJson, resolveScript } from './commands/eval.js';
import {
  buildContentBody,
  buildHeaderRow,
  buildSidebarBody,
  buildStatusLine,
  clampCursor,
  combineColumns,
  sidebarWidthFor,
  sidebarWindow
} from './commands/eval-tui.js';
import { openControllingTty, paintRow, padTo, truncateVisible, visibleLength } from './lib/tui.js';
import { mlcpConnectionArgs } from './commands/external.js';
import { normalisePattern, parseModuleRecord, resolveModuleWorkspace } from './commands/modules.js';
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

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

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

  test('tui: visibleLength ignores ANSI escape codes', () => {
    assert.equal(visibleLength('plain'), 5);
    assert.equal(visibleLength('\x1b[38;5;1mred\x1b[0m'), 3);
    assert.equal(visibleLength(''), 0);
  });

  test('tui: padTo pads styled text to the visible width', () => {
    const styled = '\x1b[38;5;1mhi\x1b[0m';
    const padded = padTo(styled, 5, (fill) => fill);
    assert.equal(visibleLength(padded), 5);
    assert.ok(padded.startsWith(styled));
  });

  test('tui: truncateVisible shortens overlong text and adds an ellipsis', () => {
    assert.equal(truncateVisible('hello world', 5), 'hell…');
    assert.equal(truncateVisible('short', 10), 'short');
  });

  test('tui: paintRow keeps a single background across the whole row and pads to width', () => {
    const row = paintRow(236, 10, (segment) => segment(255, 'hi'));
    assert.equal(visibleLength(row), 10);
    assert.match(stripAnsi(row), /^hi {8}$/);
    assert.match(row, /48;5;236/);
  });

  test('tui: openControllingTty degrades gracefully with no controlling terminal', () => {
    // In CI/sandboxed environments (and under `npm test`), there is typically
    // no controlling terminal available, so this must return null rather than
    // throwing - that's exactly the fallback path non-interactive usage relies on.
    assert.doesNotThrow(() => openControllingTty());
  });

  test('eval-tui: clampCursor keeps the cursor within bounds', () => {
    assert.equal(clampCursor(-1, 3), 0);
    assert.equal(clampCursor(5, 3), 2);
    assert.equal(clampCursor(1, 3), 1);
    assert.equal(clampCursor(0, 0), 0);
  });

  test('eval-tui: sidebarWindow returns the full list when it fits, otherwise scrolls to keep the cursor visible', () => {
    const scripts = Array.from({ length: 5 }, (_, index) => `s${index + 1}.xqy`);
    assert.deepEqual(sidebarWindow(scripts, 0, 10), { start: 0, items: scripts });

    const windowed = sidebarWindow(scripts, 4, 3);
    assert.equal(windowed.start, 2);
    assert.deepEqual(windowed.items, ['s3.xqy', 's4.xqy', 's5.xqy']);

    const atStart = sidebarWindow(scripts, 0, 3);
    assert.equal(atStart.start, 0);
    assert.deepEqual(atStart.items, ['s1.xqy', 's2.xqy', 's3.xqy']);
  });

  test('eval-tui: combineColumns concatenates matching rows from two columns', () => {
    assert.deepEqual(combineColumns(['a', 'b'], ['1', '2']), ['a1', 'b2']);
    assert.deepEqual(combineColumns(['a'], []), ['a']);
  });

  test('eval-tui: buildSidebarBody highlights the cursor row and shows a placeholder when empty', () => {
    const body = buildSidebarBody(['clear.xqy', 'stats.sjs'], { cursorIndex: 1, width: 30, height: 4 });
    assert.equal(body.length, 4);
    const plain = body.map(stripAnsi);
    assert.match(plain[0], /clear\.xqy/);
    assert.match(plain[1], /›.*stats\.sjs/);
    body.forEach((row) => assert.equal(visibleLength(row), 30));

    const empty = buildSidebarBody([], { width: 20, height: 2 });
    assert.match(stripAnsi(empty[0]), /no scripts/);
  });

  test('eval-tui: buildContentBody shows a navigation hint, a preview, or a result depending on mode', () => {
    const empty = buildContentBody({ width: 40, height: 3, mode: 'empty' });
    assert.match(stripAnsi(empty[0]), /Navigate with/);

    const preview = buildContentBody({ width: 40, height: 3, mode: 'preview', previewText: 'xquery version "1.0-ml";\n1 + 1' });
    assert.match(stripAnsi(preview[0]), /xquery version/);
    assert.match(stripAnsi(preview[1]), /1 \+ 1/);

    const okResult = buildContentBody({ width: 40, height: 3, mode: 'result', result: { ok: true, response: '2' } });
    assert.match(stripAnsi(okResult[0]), /2/);

    const errorResult = buildContentBody({ width: 40, height: 3, mode: 'result', result: { ok: false, message: 'boom' } });
    assert.match(stripAnsi(errorResult[0]), /boom/);
    assert.match(errorResult[0], new RegExp(`38;5;203`));

    const running = buildContentBody({ width: 40, height: 3, mode: 'result', running: true });
    assert.match(stripAnsi(running[0]), /Running/);
  });

  test('eval-tui: buildHeaderRow shows SCRIPTS plus the selected script and mode', () => {
    const header = buildHeaderRow({ totalWidth: 60, sidebarWidth: 20, selectedScript: 'clear.xqy', mode: 'preview' });
    const plain = stripAnsi(header);
    assert.match(plain, /SCRIPTS/);
    assert.match(plain, /clear\.xqy · preview/);
    assert.equal(visibleLength(header), 60);

    const none = buildHeaderRow({ totalWidth: 60, sidebarWidth: 20, selectedScript: '', mode: 'empty' });
    assert.match(stripAnsi(none), /Select a script/);
  });

  test('eval-tui: buildStatusLine shows different hints for select vs view mode', () => {
    const selectLine = buildStatusLine({ width: 90, mode: 'select', lastScript: '', database: 'FS-content' });
    assert.match(stripAnsi(selectLine), /navigate/);
    assert.match(stripAnsi(selectLine), /ENTER.*view/);

    const viewLine = buildStatusLine({ width: 90, mode: 'view', lastScript: 'clear.xqy', database: 'FS-content', elapsed: '0.42' });
    const plain = stripAnsi(viewLine);
    assert.match(plain, /run/);
    assert.match(plain, /edit/);
    assert.match(plain, /clear\.xqy/);
    assert.match(plain, /db:FS-content/);
    assert.match(plain, /0\.42s/);
    assert.equal(visibleLength(viewLine), 90);
  });

  test('eval-tui: sidebarWidthFor grows with the longest filename but stays capped', () => {
    const narrow = sidebarWidthFor(['a.xqy'], 100);
    assert.ok(narrow >= 18);
    const wide = sidebarWidthFor(['a-very-long-descriptive-script-name-indeed.xqy'], 100);
    assert.ok(wide <= Math.floor(100 * 0.35));
  });

  test('reuses the newest valid module workspace when today has none', () => {
    const workspaceRoot = path.join(home, 'module-workspaces');
    const older = path.join(workspaceRoot, 'modules_20260728');
    const newer = path.join(workspaceRoot, 'modules_20260729');
    fs.mkdirSync(older, { recursive: true });
    fs.mkdirSync(newer, { recursive: true });
    fs.writeFileSync(path.join(older, 'module-info.txt'), '/old.xqy~old.xqy~~~EOL\n');
    fs.writeFileSync(path.join(newer, 'module-info.txt'), '/new.xqy~new.xqy~~~EOL\n');
    fs.utimesSync(path.join(older, 'module-info.txt'), new Date(1000), new Date(1000));
    fs.utimesSync(path.join(newer, 'module-info.txt'), new Date(2000), new Date(2000));

    const selected = resolveModuleWorkspace({ cwd: workspaceRoot, date: '20990101' });
    assert.equal(selected.directory, newer);
    assert.equal(selected.reason, 'latest');
    assert.equal(resolveModuleWorkspace({ cwd: workspaceRoot, requested: 'modules_20260728' }).directory, older);
    assert.equal(resolveModuleWorkspace({ cwd: newer }).reason, 'current-directory');
  });

  test('reports where module workspaces were searched without logging a stack at debug level', () => {
    const emptyWorkspace = path.join(home, 'empty-module-workspace');
    fs.mkdirSync(emptyWorkspace);
    const result = spawnSync(process.execPath, [path.resolve('bin/mlsh'), 'modules', 'load'], {
      cwd: emptyWorkspace,
      env: { ...process.env, HOME: home, MLSH_INTERACTIVE: '1', MLSH_LOG_LEVEL: 'debug' },
      encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`No module workspace found in ${fs.realpathSync(emptyWorkspace).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(result.stderr, /modules load --workspace <directory>/);
    const diagnosticLog = fs.readFileSync(path.join(home, '.mlsh', 'mlsh.log'), 'utf8');
    assert.doesNotMatch(diagnosticLog, /at resolveModuleWorkspace/);
  });

  test('loads from a previous-day module workspace through the Node command', () => {
    const root = path.join(home, 'previous-day-load');
    const workspace = path.join(root, 'modules_20260729');
    const edited = path.join(workspace, 'edited');
    const fakeBin = path.join(root, 'bin');
    fs.mkdirSync(edited, { recursive: true });
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(workspace, 'module-info.txt'), '/old.xqy~old.xqy~~~EOL\n');
    fs.writeFileSync(path.join(edited, 'old.xqy'), 'xquery version "1.0-ml"; 1');
    const curl = path.join(fakeBin, 'curl');
    fs.writeFileSync(curl, `#!/bin/sh
output=
previous=
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
done
: > "$output"
printf '200'
`);
    fs.chmodSync(curl, 0o755);
    const result = spawnSync(process.execPath, [path.resolve('bin/mlsh'), 'modules', 'load'], {
      cwd: root,
      env: { ...process.env, HOME: home, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, MLSH_INTERACTIVE: '1' },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
     assert.match(result.stdout, /Using latest module workspace: modules_20260729/);
     assert.match(result.stdout, /Module load complete: 1 loaded, 0 skipped, 0 failed/);
   });

   test('modules find reuses the most recent existing workspace instead of creating today\'s dated folder', () => {
     const root = path.join(home, 'find-reuse-test');
     const workspaceRoot = path.join(root, 'workspaces');
     const older = path.join(workspaceRoot, 'modules_20260728');
     const newer = path.join(workspaceRoot, 'modules_20260729');
     const fakeBin = path.join(root, 'bin');
     const mlshHome = path.join(root, 'mlsh-home');
     fs.mkdirSync(older, { recursive: true });
     fs.mkdirSync(newer, { recursive: true });
     fs.mkdirSync(fakeBin);
     fs.writeFileSync(path.join(older, 'module-info.txt'), '');
     fs.writeFileSync(path.join(newer, 'module-info.txt'), '');
     fs.utimesSync(path.join(older, 'module-info.txt'), new Date(1000), new Date(1000));
     fs.utimesSync(path.join(newer, 'module-info.txt'), new Date(2000), new Date(2000));
     
     // Create and activate an environment with modules_db configured
     const envDir = configDirectory(mlshHome);
     writeEnvironment('test', envDir);
     activateEnvironment('test', envDir, mlshHome);
     
     // Create a fake curl that returns a mock module record
     const curl = path.join(fakeBin, 'curl');
     fs.writeFileSync(curl, `#!/bin/sh
output=
previous=
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
done
cat > "$output" << 'CURL_EOF'
/test.xqy~test.xqy~read~apps~EOL
CURL_EOF
printf '200'
`);
     fs.chmodSync(curl, 0o755);

     // Run modules find from the workspace directory (should reuse the newest workspace)
     const result = spawnSync(process.execPath, [path.resolve('bin/mlsh'), 'modules', 'find', 'test'], {
       cwd: workspaceRoot,
       input: '1\n', // Select module 1 to download
       env: { ...process.env, HOME: mlshHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, MLSH_INTERACTIVE: '1' },
       encoding: 'utf8'
     });
     assert.equal(result.status, 0, `stderr: ${result.stderr}`);
     assert.match(result.stdout, /Reusing latest module workspace: modules_20260729/, `stdout: ${result.stdout}`);
     // Verify no new modules_<today> folder was created
     const todayName = `modules_${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
     assert.ok(!fs.existsSync(path.join(workspaceRoot, todayName)), `Should not create ${todayName} when existing workspace available`);
   });

   test('modules new always creates a fresh dated folder even when an existing workspace is present', () => {
     const root = path.join(home, 'new-force-test');
     const workspaceRoot = path.join(root, 'workspaces');
     const existing = path.join(workspaceRoot, 'modules_20260729');
     const fakeBin = path.join(root, 'bin');
     const mlshHome = path.join(root, 'mlsh-home');
     fs.mkdirSync(existing, { recursive: true });
     fs.mkdirSync(fakeBin);
     fs.writeFileSync(path.join(existing, 'module-info.txt'), '');
     
     // Create and activate an environment with modules_db configured
     const envDir = configDirectory(mlshHome);
     writeEnvironment('test', envDir);
     activateEnvironment('test', envDir, mlshHome);
     
     // Create a fake curl that returns a mock module record
     const curl = path.join(fakeBin, 'curl');
     fs.writeFileSync(curl, `#!/bin/sh
output=
previous=
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
done
cat > "$output" << 'CURL_EOF'
/test.xqy~test.xqy~read~apps~EOL
CURL_EOF
printf '200'
`);
     fs.chmodSync(curl, 0o755);

     // Run modules new from the workspace directory (should force creation of a new dated folder)
     const result = spawnSync(process.execPath, [path.resolve('bin/mlsh'), 'modules', 'new', 'test'], {
       cwd: workspaceRoot,
       input: '1\n', // Select module 1 to download
       env: { ...process.env, HOME: mlshHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, MLSH_INTERACTIVE: '1' },
       encoding: 'utf8'
     });
     assert.equal(result.status, 0, `stderr: ${result.stderr}`);
     assert.match(result.stdout, /Creating new module workspace: modules_/, `stdout: ${result.stdout}`);
     // Verify a new modules_<today> folder was created
     const todayName = `modules_${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
     assert.ok(fs.existsSync(path.join(workspaceRoot, todayName)), `Should create ${todayName}`);
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
