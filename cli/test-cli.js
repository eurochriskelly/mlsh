#!/usr/bin/env node

import assert from 'assert/strict';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import tls from 'tls';
import { isSupportedScriptFile, listScripts, parseEvalArgs, pairsToJson, resolveScript, SCRIPT_EXTENSIONS } from './commands/eval.js';
import {
  buildContentBody,
  buildHeaderRow,
  buildSidebarBody,
  buildStatusLine,
  clampCursor,
  combineColumns,
  formatDuration,
  sidebarWidthFor,
  sidebarWindow
} from './commands/eval-tui.js';
import { openControllingTty, paintRow, padTo, truncateVisible, visibleLength, watchResize } from './lib/tui.js';
import { runProcess } from './lib/process.js';
import { normalisePattern, parseModuleRecord, resolveModuleWorkspace } from './commands/modules.js';
import {
  buildMlcpInvocation,
  classifyJobFields,
  diagnosticsHeader,
  insecureEntries,
  jobBaseName,
  jobDirectory,
  jobTemplate,
  listJobs,
  MLCP_OPERATIONS,
  nextJobName,
  parseJobFile,
  redactedSummary,
  resolveEnvironmentsForOperation,
  resolveJobFile,
  resolvePathOptions,
  validateJobName
} from './commands/mlcp.js';
import { buildHeaderRow as buildMlcpHeaderRow, buildStatusLine as buildMlcpStatusLine } from './commands/mlcp-tui.js';
import { createContext } from './main.js';
import {
  activateEnvironment,
  configDirectory,
  defaultEnvironment,
  environmentPath,
  generateShellConfig,
  isInsecure,
  loadActiveEnvironment,
  loadNamedEnvironment,
  listEnvironments,
  parseEnvironment,
  parseShellEnvironment,
  saveEditedEnvironment,
  writeEnvironment
} from './lib/environment-files.js';
import { certificateAlias, ensureTrustedCertificates, trustStorePath } from './lib/trust.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-test-'));
let passed = 0;

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

async function test(name, run) {
  try {
    await run();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}

try {
  const directory = configDirectory(home);

  await test('creates a default editable environment', () => {
    const file = writeEnvironment('dev', directory);
    const settings = parseEnvironment(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(settings, defaultEnvironment('dev'));
  });

  await test('lists environment files alphabetically', () => {
    writeEnvironment('prod', directory);
    assert.deepEqual(listEnvironments(directory), ['dev', 'prod']);
  });

  await test('uses the name in the file when saving an environment', () => {
    const file = writeEnvironment('new', directory);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('name=new', 'name=staging'));
    const saved = saveEditedEnvironment(file, directory);
    assert.equal(saved.name, 'staging');
    assert.ok(fs.existsSync(environmentPath('staging', directory)));
    assert.ok(!fs.existsSync(file));
  });

  await test('rejects unsafe environment names', () => {
    assert.throws(() => environmentPath('../prod', directory), /letters, numbers/);
  });

  await test('activates an environment in shell-compatible form', () => {
    const settings = activateEnvironment('dev', directory, home);
    const generated = fs.readFileSync(path.join(home, '.mlshrc-gen'), 'utf8');
    assert.equal(settings.host, 'localhost');
    assert.match(generated, /export ML_ENV="dev"/);
    assert.match(generated, /export ML_CONTENT_DB="content"/);
  });

  await test('loads the active environment without sourcing shell code', () => {
    const loaded = loadActiveEnvironment(home, { HOME: home });
    assert.equal(loaded.name, 'dev');
    assert.equal(loaded.content_db, 'content');
  });

  await test('reads legacy generated shell environments safely', () => {
    const parsed = parseShellEnvironment('export ML_ENV="test"\nexport ML_HOST="example.test"\nrun-something-dangerous\n');
    assert.deepEqual(parsed, { name: 'test', host: 'example.test' });
  });

  await test('quotes generated shell values without executing their contents', () => {
    const marker = path.join(home, 'should-not-exist');
    const config = path.join(home, 'quoted-env.sh');
    const pass = `value$(touch ${marker})$HOME\`uname\`"quoted`;
    fs.writeFileSync(config, generateShellConfig({ ...defaultEnvironment('quoted'), pass }));
    const result = spawnSync('bash', ['-c', 'source "$1"; printf "%s" "$ML_PASS"', 'bash', config], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, pass);
    assert.ok(!fs.existsSync(marker));
  });

  await test('isInsecure recognises the insecure=true environment flag case-insensitively', () => {
    assert.equal(isInsecure({ insecure: 'true' }), true);
    assert.equal(isInsecure({ insecure: 'TRUE' }), true);
    assert.equal(isInsecure({ insecure: 'false' }), false);
    assert.equal(isInsecure({}), false);
    assert.equal(isInsecure(undefined), false);
  });

  await test('loadNamedEnvironment reports the source file and whether insecure was explicitly set (vs. defaulted)', () => {
    const envHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-env-explicit-'));
    const directory = configDirectory(envHome);
    fs.mkdirSync(directory, { recursive: true });

    // An environment file predating the insecure= feature: no such line at all.
    const legacyFile = environmentPath('legacy', directory);
    fs.writeFileSync(legacyFile, 'name=legacy\nprotocol=https\nhost=old.example.com\nport=8000\nuser=admin\npass=admin\n');
    const legacy = loadNamedEnvironment('legacy', envHome);
    assert.equal(legacy._file, legacyFile);
    assert.equal(legacy._insecureExplicit, false);
    assert.equal(isInsecure(legacy), false);

    // An environment file that explicitly opts in.
    const explicitFile = environmentPath('explicit', directory);
    fs.writeFileSync(explicitFile, 'name=explicit\nprotocol=https\nhost=new.example.com\nport=8000\nuser=admin\npass=admin\ninsecure=true\n');
    const explicit = loadNamedEnvironment('explicit', envHome);
    assert.equal(explicit._insecureExplicit, true);
    assert.equal(isInsecure(explicit), true);

    fs.rmSync(envHome, { recursive: true, force: true });
  });

  await test('process: runProcess with logFile tees inherited output to a file as well as the terminal', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-process-log-'));
    const logFile = path.join(directory, 'out.log');
    const result = await runProcess('sh', ['-c', 'echo out-line; echo err-line 1>&2'], { inherit: true, logFile });
    assert.equal(result.code, 0);
    const contents = fs.readFileSync(logFile, 'utf8');
    assert.match(contents, /out-line/);
    assert.match(contents, /err-line/);
    assert.match(result.stdout.toString(), /out-line/);
    assert.match(result.stderr.toString(), /err-line/);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await test('parses eval options and variables without losing quoted values', () => {
    assert.deepEqual(parseEvalArgs(['--script', 'a file.xqy', '--database', 'Documents', '--vars', 'one=two&three=four']), {
      script: 'a file.xqy',
      database: 'Documents',
      params: '{"one":"two","three":"four"}',
      help: false
    });
    assert.equal(pairsToJson('message=hello world'), '{"message":"hello world"}');
  });

  await test('resolves extensionless eval scripts', () => {
    const script = path.join(home, 'example.xqy');
    fs.writeFileSync(script, '1 + 1');
    assert.equal(resolveScript(path.join(home, 'example')), script);
  });

  await test('isSupportedScriptFile/listScripts recognise .xqy, .js, .sjs, .sql, and .spl', () => {
    assert.ok(isSupportedScriptFile('a.xqy'));
    assert.ok(isSupportedScriptFile('a.js'));
    assert.ok(isSupportedScriptFile('a.sjs'));
    assert.ok(isSupportedScriptFile('a.sql'));
    assert.ok(isSupportedScriptFile('a.spl'));
    assert.ok(isSupportedScriptFile('A.XQY'));
    assert.ok(!isSupportedScriptFile('a.txt'));
    assert.deepEqual(SCRIPT_EXTENSIONS, ['xqy', 'js', 'sjs', 'sql', 'spl']);

    const directory = fs.mkdtempSync(path.join(home, 'scripts-'));
    for (const file of ['one.xqy', 'two.js', 'three.sjs', 'four.sql', 'five.spl', 'ignored.txt']) {
      fs.writeFileSync(path.join(directory, file), '');
    }
    assert.deepEqual(listScripts(directory), ['five.spl', 'four.sql', 'one.xqy', 'three.sjs', 'two.js']);
  });

  await test('normalises module patterns and parses server records', () => {
    assert.equal(normalisePattern('customer'), '*customer*');
    assert.equal(normalisePattern('*customer?.xqy'), '*customer?.xqy');
    const record = parseModuleRecord('{"uri":"/a.xqy","permissions":["read=apps"],"collections":["apps"]}');
    assert.equal(record.uri, '/a.xqy');
    assert.equal(record.localName, '%a.xqy');
    assert.deepEqual(record.permissions, ['read=apps']);
    assert.deepEqual(record.collections, ['apps']);
    const derived = parseModuleRecord('{"uri":"/b.xqy"}');
    assert.equal(derived.localName, '%b.xqy');
    assert.deepEqual(derived.permissions, []);
    assert.deepEqual(derived.collections, []);
  });

  await test('tui: visibleLength ignores ANSI escape codes', () => {
    assert.equal(visibleLength('plain'), 5);
    assert.equal(visibleLength('\x1b[38;5;1mred\x1b[0m'), 3);
    assert.equal(visibleLength(''), 0);
  });

  await test('tui: padTo pads styled text to the visible width', () => {
    const styled = '\x1b[38;5;1mhi\x1b[0m';
    const padded = padTo(styled, 5, (fill) => fill);
    assert.equal(visibleLength(padded), 5);
    assert.ok(padded.startsWith(styled));
  });

  await test('tui: truncateVisible shortens overlong text and adds an ellipsis', () => {
    assert.equal(truncateVisible('hello world', 5), 'hell…');
    assert.equal(truncateVisible('short', 10), 'short');
  });

  await test('tui: paintRow keeps a single background across the whole row and pads to width', () => {
    const row = paintRow(236, 10, (segment) => segment(255, 'hi'));
    assert.equal(visibleLength(row), 10);
    assert.match(stripAnsi(row), /^hi {8}$/);
    assert.match(row, /48;5;236/);
  });

  await test('tui: openControllingTty degrades gracefully with no controlling terminal', () => {
    // In CI/sandboxed environments (and under `npm test`), there is typically
    // no controlling terminal available, so this must return null rather than
    // throwing - that's exactly the fallback path non-interactive usage relies on.
    assert.doesNotThrow(() => openControllingTty());
  });

  await test('tui: watchResize refreshes a custom tty stream on SIGWINCH and redraws when size changes', () => {
    // A tty.WriteStream built from a raw fd (as openControllingTty() does)
    // never auto-updates its .columns/.rows on resize - unlike process.stdout,
    // nothing wires SIGWINCH to it. watchResize must do that wiring itself by
    // calling the stream's own _refreshSize(), which re-queries the size and
    // emits 'resize' only if it actually changed.
    let redraws = 0;
    const fakeOutput = new EventEmitter();
    fakeOutput.columns = 80;
    fakeOutput.rows = 24;
    fakeOutput._refreshSize = () => {
      fakeOutput.columns = 120;
      fakeOutput.rows = 40;
      fakeOutput.emit('resize');
    };

    const stop = watchResize(fakeOutput, () => { redraws++; });
    process.emit('SIGWINCH');
    assert.equal(redraws, 1);
    assert.equal(fakeOutput.columns, 120);
    assert.equal(fakeOutput.rows, 40);

    stop();
    process.emit('SIGWINCH');
    assert.equal(redraws, 1, 'stop() should remove the SIGWINCH listener');
  });

  await test('tui: watchResize falls back to calling onResize directly when the stream has no _refreshSize', () => {
    let redraws = 0;
    const fakeOutput = new EventEmitter();
    const stop = watchResize(fakeOutput, () => { redraws++; });
    process.emit('SIGWINCH');
    assert.equal(redraws, 1);
    stop();
  });

  await test('eval-tui: clampCursor keeps the cursor within bounds', () => {
    assert.equal(clampCursor(-1, 3), 0);
    assert.equal(clampCursor(5, 3), 2);
    assert.equal(clampCursor(1, 3), 1);
    assert.equal(clampCursor(0, 0), 0);
  });

  await test('eval-tui: sidebarWindow returns the full list when it fits, otherwise scrolls to keep the cursor visible', () => {
    const scripts = Array.from({ length: 5 }, (_, index) => `s${index + 1}.xqy`);
    assert.deepEqual(sidebarWindow(scripts, 0, 10), { start: 0, items: scripts });

    const windowed = sidebarWindow(scripts, 4, 3);
    assert.equal(windowed.start, 2);
    assert.deepEqual(windowed.items, ['s3.xqy', 's4.xqy', 's5.xqy']);

    const atStart = sidebarWindow(scripts, 0, 3);
    assert.equal(atStart.start, 0);
    assert.deepEqual(atStart.items, ['s1.xqy', 's2.xqy', 's3.xqy']);
  });

  await test('eval-tui: combineColumns concatenates matching rows from two columns', () => {
    assert.deepEqual(combineColumns(['a', 'b'], ['1', '2']), ['a1', 'b2']);
    assert.deepEqual(combineColumns(['a'], []), ['a']);
  });

  await test('eval-tui: buildSidebarBody highlights the cursor row and shows a placeholder when empty', () => {
    const body = buildSidebarBody(['clear.xqy', 'stats.sjs'], { cursorIndex: 1, width: 30, height: 4 });
    assert.equal(body.length, 4);
    const plain = body.map(stripAnsi);
    assert.match(plain[0], /clear\.xqy/);
    assert.match(plain[1], /›.*stats\.sjs/);
    body.forEach((row) => assert.equal(visibleLength(row), 30));

    const empty = buildSidebarBody([], { width: 20, height: 2 });
    assert.match(stripAnsi(empty[0]), /no scripts/);
  });

  await test('eval-tui: buildContentBody shows a navigation hint, a preview, or a result depending on mode', () => {
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

  await test('eval-tui: buildHeaderRow shows SCRIPTS plus the selected script and mode', () => {
    const header = buildHeaderRow({ totalWidth: 60, sidebarWidth: 20, selectedScript: 'clear.xqy', mode: 'preview' });
    const plain = stripAnsi(header);
    assert.match(plain, /SCRIPTS/);
    assert.match(plain, /clear\.xqy · preview/);
    assert.equal(visibleLength(header), 60);

    const none = buildHeaderRow({ totalWidth: 60, sidebarWidth: 20, selectedScript: '', mode: 'empty' });
    assert.match(stripAnsi(none), /Select a script/);
  });

  await test('eval-tui: buildStatusLine shows different hints for select vs view mode', () => {
    const selectLine = buildStatusLine({ width: 90, mode: 'select', lastScript: '', database: 'FS-content' });
    assert.match(stripAnsi(selectLine), /navigate/);
    assert.match(stripAnsi(selectLine), /ENTER.*view/);

    const viewLine = buildStatusLine({ width: 120, mode: 'view', lastScript: 'clear.xqy', database: 'FS-content', elapsed: '0.42' });
    const plain = stripAnsi(viewLine);
    assert.match(plain, /run/);
    assert.match(plain, /edit/);
    assert.match(plain, /clear\.xqy/);
    assert.match(plain, /db:FS-content/);
    assert.match(plain, /0\.42s/);
    assert.equal(visibleLength(viewLine), 120);
  });

  await test('eval-tui: sidebarWidthFor grows with the longest filename but stays capped', () => {
    const narrow = sidebarWidthFor(['a.xqy'], 100);
    assert.ok(narrow >= 18);
    const wide = sidebarWidthFor(['a-very-long-descriptive-script-name-indeed.xqy'], 100);
    assert.ok(wide <= Math.floor(100 * 0.35));
  });

  await test('eval-tui: formatDuration renders seconds, minutes, and hours appropriately', () => {
    assert.equal(formatDuration(45000), '45s');
    assert.equal(formatDuration(1392000), '23m12s');
    assert.equal(formatDuration(3723000), '1h2m3s');
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(-500), '0s');
  });

  await test('reuses the newest valid module workspace when today has none', () => {
    const workspaceRoot = path.join(home, 'module-workspaces');
    const older = path.join(workspaceRoot, 'modules_20260728');
    const newer = path.join(workspaceRoot, 'modules_20260729');
    fs.mkdirSync(older, { recursive: true });
    fs.mkdirSync(newer, { recursive: true });
    fs.writeFileSync(path.join(older, 'module-info.jsonl'), '{"uri":"/old.xqy"}\n');
    fs.writeFileSync(path.join(newer, 'module-info.jsonl'), '{"uri":"/new.xqy"}\n');
    fs.utimesSync(path.join(older, 'module-info.jsonl'), new Date(1000), new Date(1000));
    fs.utimesSync(path.join(newer, 'module-info.jsonl'), new Date(2000), new Date(2000));

    const selected = resolveModuleWorkspace({ cwd: workspaceRoot, date: '20990101' });
    assert.equal(selected.directory, newer);
    assert.equal(selected.reason, 'latest');
    assert.equal(resolveModuleWorkspace({ cwd: workspaceRoot, requested: 'modules_20260728' }).directory, older);
    assert.equal(resolveModuleWorkspace({ cwd: newer }).reason, 'current-directory');
  });

  await test('reports where module workspaces were searched without logging a stack at debug level', () => {
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

  await test('loads from a previous-day module workspace through the Node command', () => {
    const root = path.join(home, 'previous-day-load');
    const workspace = path.join(root, 'modules_20260729');
    const edited = path.join(workspace, 'edited');
    const fakeBin = path.join(root, 'bin');
    fs.mkdirSync(edited, { recursive: true });
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(workspace, 'module-info.jsonl'), '{"uri":"/old.xqy"}\n');
    fs.writeFileSync(path.join(edited, '%old.xqy'), 'xquery version "1.0-ml"; 1');
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

   await test('modules find reuses the most recent existing workspace instead of creating today\'s dated folder', () => {
     const root = path.join(home, 'find-reuse-test');
     const workspaceRoot = path.join(root, 'workspaces');
     const older = path.join(workspaceRoot, 'modules_20260728');
     const newer = path.join(workspaceRoot, 'modules_20260729');
     const fakeBin = path.join(root, 'bin');
     const mlshHome = path.join(root, 'mlsh-home');
     fs.mkdirSync(older, { recursive: true });
     fs.mkdirSync(newer, { recursive: true });
     fs.mkdirSync(fakeBin);
     fs.writeFileSync(path.join(older, 'module-info.jsonl'), '');
     fs.writeFileSync(path.join(newer, 'module-info.jsonl'), '');
     fs.utimesSync(path.join(older, 'module-info.jsonl'), new Date(1000), new Date(1000));
     fs.utimesSync(path.join(newer, 'module-info.jsonl'), new Date(2000), new Date(2000));
     
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
{"uri":"/test.xqy","permissions":["read=apps"],"collections":["apps"]}
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

   await test('modules new always creates a fresh dated folder even when an existing workspace is present', () => {
     const root = path.join(home, 'new-force-test');
     const workspaceRoot = path.join(root, 'workspaces');
     const existing = path.join(workspaceRoot, 'modules_20260729');
     const fakeBin = path.join(root, 'bin');
     const mlshHome = path.join(root, 'mlsh-home');
     fs.mkdirSync(existing, { recursive: true });
     fs.mkdirSync(fakeBin);
     fs.writeFileSync(path.join(existing, 'module-info.jsonl'), '');
     
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
{"uri":"/test.xqy","permissions":["read=apps"],"collections":["apps"]}
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

  await test('runs eval through the Node dispatcher and preserves argument boundaries', () => {
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

  await test('keeps MLSH commands as first-class functions in the interactive shell', () => {
    const result = spawnSync('bash', ['--noprofile', '--rcfile', path.resolve('shell/bashrc'), '-i', '-c', 'printf "types=%s,%s env=%s\\n" "$(type -t eval)" "$(type -t modules)" "$ML_ENV"; env prod >/dev/null; printf "switched=%s\\n" "$ML_ENV"'], {
      env: { ...process.env, HOME: home, MLSH_TOP_DIR: path.resolve('.'), TERM: 'xterm' },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /types=function,function env=dev/);
    assert.match(result.stdout, /switched=prod/);
  });

  await test('creates a command context from the selected environment', () => {
    activateEnvironment('dev', directory, home);
    const context = createContext({ topDir: path.resolve('.'), processEnvironment: { HOME: home } });
    assert.equal(context.environment.name, 'dev');
    assert.equal(context.environment.host, 'localhost');
  });

  await test('mlcp: validateJobName accepts safe names and rejects unsafe ones', () => {
    assert.doesNotThrow(() => validateJobName('123'));
    assert.doesNotThrow(() => validateJobName('nightly-export_2'));
    assert.throws(() => validateJobName('../etc'), /letters, numbers/);
    assert.throws(() => validateJobName(''), /letters, numbers/);
  });

  await test('mlcp: jobBaseName and resolveJobFile normalise the .job suffix', () => {
    assert.equal(jobBaseName('123.job'), '123');
    assert.equal(jobBaseName('123'), '123');
    const mlcpDirectory = jobDirectory(home, 'import');
    assert.equal(resolveJobFile(mlcpDirectory, '123'), path.join(mlcpDirectory, '123.job'));
    assert.equal(resolveJobFile(mlcpDirectory, '123.job'), path.join(mlcpDirectory, '123.job'));
  });

  await test('mlcp: jobDirectory resolves under .jobs/mlcp/<operation> relative to the given directory', () => {
    assert.equal(jobDirectory('/tmp/project', 'import'), path.join('/tmp/project', '.jobs', 'mlcp', 'import'));
    assert.equal(jobDirectory('/tmp/project', 'copy'), path.join('/tmp/project', '.jobs', 'mlcp', 'copy'));
  });

  await test('mlcp: nextJobName finds the next unused numeric name', () => {
    const mlcpDirectory = path.join(home, 'jobnames-test', '.jobs', 'mlcp', 'import');
    assert.equal(nextJobName(mlcpDirectory), '001');
    fs.mkdirSync(mlcpDirectory, { recursive: true });
    fs.writeFileSync(path.join(mlcpDirectory, '001.job'), '');
    fs.writeFileSync(path.join(mlcpDirectory, '007.job'), '');
    fs.writeFileSync(path.join(mlcpDirectory, 'nightly.job'), '');
    assert.equal(nextJobName(mlcpDirectory), '008');
  });

  await test('mlcp: listJobs lists .job files without their extension, sorted, and empty when missing', () => {
    const mlcpDirectory = path.join(home, 'listjobs-test', '.jobs', 'mlcp', 'export');
    assert.deepEqual(listJobs(mlcpDirectory), []);
    fs.mkdirSync(mlcpDirectory, { recursive: true });
    fs.writeFileSync(path.join(mlcpDirectory, '002.job'), '');
    fs.writeFileSync(path.join(mlcpDirectory, '001.job'), '');
    fs.writeFileSync(path.join(mlcpDirectory, 'notes.txt'), '');
    assert.deepEqual(listJobs(mlcpDirectory), ['001', '002']);
  });

  await test('mlcp: MLCP_OPERATIONS lists the three supported operations', () => {
    assert.deepEqual(MLCP_OPERATIONS, ['import', 'export', 'copy']);
  });

  await test('mlcp: jobTemplate produces operation-specific templates with the job name filled in', () => {
    assert.match(jobTemplate('import', '001'), /job=001[\s\S]*input_file_path=\.jobs\/mlcp\/import\/data\/001/);
    assert.match(jobTemplate('export', '002'), /job=002[\s\S]*output_file_path=\.jobs\/mlcp\/export\/data\/002/);
    assert.match(jobTemplate('copy', '003'), /job=003[\s\S]*collections=foo,bar/);
  });

  await test('mlcp: parseJobFile ignores comments and blank lines, lowercases keys', () => {
    const fields = parseJobFile(`# a comment\njob=001\n\nInput_File_Type=archive\n  thread_count = 4  \n`);
    assert.deepEqual(fields, { job: '001', input_file_type: 'archive', thread_count: '4' });
  });

  await test('mlcp: classifyJobFields separates meta, typed properties, and extra args, and applies the collections alias', () => {
    const importResult = classifyJobFields('import', { job: '001', env_to: 'prod', collections: 'foo,bar', thread_count: '4', some_future_option: 'x' });
    assert.deepEqual(importResult.meta, { job: '001', env_to: 'prod' });
    assert.deepEqual(importResult.properties, { output_collections: 'foo,bar', thread_count: 4 });
    assert.deepEqual(importResult.extraArgs, ['-some_future_option', 'x']);

    const exportResult = classifyJobFields('export', { collections: 'foo' });
    assert.equal(exportResult.properties.collection_filter, 'foo');

    const copyResult = classifyJobFields('copy', { collections: 'foo' });
    assert.equal(copyResult.properties.collection_filter, 'foo');
  });

  await test('mlcp: classifyJobFields rejects connection identity fields', () => {
    assert.throws(() => classifyJobFields('import', { host: 'evil.example.com' }), /connection details always come from/);
    assert.throws(() => classifyJobFields('copy', { output_password: 'hunter2' }), /connection details always come from/);
    assert.throws(() => classifyJobFields('import', { options_file: 'x.txt' }), /connection details always come from/);
  });

  await test('mlcp: classifyJobFields rejects malformed booleans and integers', () => {
    assert.throws(() => classifyJobFields('import', { compress: 'yes' }), /must be true or false/);
    assert.throws(() => classifyJobFields('import', { thread_count: 'four' }), /must be a whole number/);
  });

  await test('mlcp: buildMlcpInvocation fills in import connection details and database default', () => {
    const envTo = { host: 'localhost', port: '8000', user: 'admin', pass: 'admin', protocol: 'http', content_db: 'content' };
    const invocation = buildMlcpInvocation('import', { input_file_path: 'data/import' }, { envTo }, '/project');
    assert.equal(invocation.command, 'IMPORT');
    assert.deepEqual(invocation.properties, {
      database: 'content',
      input_file_path: path.join('/project', 'data/import'),
      host: 'localhost',
      port: 8000,
      username: 'admin',
      password: 'admin'
    });
  });

  await test('mlcp: buildMlcpInvocation requires input_file_path for import and output_file_path for export', () => {
    const env = { host: 'localhost', port: '8000', user: 'admin', pass: 'admin', protocol: 'http', content_db: 'content' };
    assert.throws(() => buildMlcpInvocation('import', {}, { envTo: env }, '/project'), /input_file_path/);
    assert.throws(() => buildMlcpInvocation('export', {}, { envFrom: env }, '/project'), /output_file_path/);
  });

  await test('mlcp: buildMlcpInvocation sets ssl for https environments', () => {
    const envTo = { host: 'ml.example.com', port: '8000', user: 'admin', pass: 'admin', protocol: 'https', content_db: 'content' };
    const invocation = buildMlcpInvocation('import', { input_file_path: 'x' }, { envTo }, '/project');
    assert.equal(invocation.properties.ssl, true);
  });

  await test('mlcp: buildMlcpInvocation resolves relative path options against baseDirectory, leaving absolute paths untouched', () => {
    const envTo = { host: 'localhost', port: '8000', user: 'admin', pass: 'admin', protocol: 'http', content_db: 'content' };
    const relative = buildMlcpInvocation('import', { input_file_path: 'data/import' }, { envTo }, '/project');
    assert.equal(relative.properties.input_file_path, path.join('/project', 'data/import'));

    const absolute = buildMlcpInvocation('import', { input_file_path: '/absolute/data/import' }, { envTo }, '/project');
    assert.equal(absolute.properties.input_file_path, '/absolute/data/import');

    const envFrom = { host: 'localhost', port: '8000', user: 'admin', pass: 'admin', protocol: 'http', content_db: 'content' };
    const exported = buildMlcpInvocation('export', { output_file_path: 'data/export' }, { envFrom }, '/project');
    assert.equal(exported.properties.output_file_path, path.join('/project', 'data/export'));
  });

  await test('mlcp: resolvePathOptions only touches known path-like keys and leaves everything else untouched', () => {
    const resolved = resolvePathOptions({
      input_file_path: 'data/import',
      output_directory: '/already/absolute',
      thread_count: 4,
      output_uri_prefix: '/data/'
    }, '/project');
    assert.equal(resolved.input_file_path, path.join('/project', 'data/import'));
    assert.equal(resolved.output_directory, '/already/absolute');
    assert.equal(resolved.thread_count, 4);
    assert.equal(resolved.output_uri_prefix, '/data/');
  });

  await test('mlcp: buildMlcpInvocation builds distinct input_/output_ connection details for copy', () => {
    const envFrom = { host: 'dev.example.com', port: '8000', user: 'admin', pass: 'admin', protocol: 'http', content_db: 'dev-content' };
    const envTo = { host: 'localhost', port: '8010', user: 'admin', pass: 'admin', protocol: 'http', content_db: 'local-content' };
    const invocation = buildMlcpInvocation('copy', { collections: 'foo' }, { envFrom, envTo });
    assert.equal(invocation.command, 'COPY');
    assert.equal(invocation.properties.input_host, 'dev.example.com');
    assert.equal(invocation.properties.output_host, 'localhost');
    assert.equal(invocation.properties.input_database, 'dev-content');
    assert.equal(invocation.properties.output_database, 'local-content');
    assert.equal(invocation.properties.collection_filter, 'foo');
  });

  await test('mlcp: insecureEntries reports only the hosts that need trust-on-first-use, per operation', () => {
    const secure = { host: 'a.example.com', port: '8000', insecure: 'false' };
    const insecure = { host: 'b.example.com', port: '8001', insecure: 'true' };

    assert.deepEqual(insecureEntries('import', { envTo: secure }), []);
    assert.deepEqual(insecureEntries('import', { envTo: insecure }), [{ host: 'b.example.com', port: '8001' }]);
    assert.deepEqual(insecureEntries('export', { envFrom: insecure }), [{ host: 'b.example.com', port: '8001' }]);
    assert.deepEqual(insecureEntries('copy', { envFrom: insecure, envTo: secure }), [{ host: 'b.example.com', port: '8001' }]);
    assert.deepEqual(insecureEntries('copy', { envFrom: insecure, envTo: insecure }), [
      { host: 'b.example.com', port: '8001' },
      { host: 'b.example.com', port: '8001' }
    ]);
  });

  await test('mlcp: resolveEnvironmentsForOperation defaults to the active environment and honors env_from/env_to', () => {
    const mlcpEnvHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-mlcp-env-'));
    const mlcpEnvDirectory = configDirectory(mlcpEnvHome);
    writeEnvironment('active', mlcpEnvDirectory);
    writeEnvironment('other', mlcpEnvDirectory);
    fs.writeFileSync(path.join(mlcpEnvDirectory, 'other.env'), 'name=other\nhost=other.example.com\nport=8000\nuser=admin\npass=admin\ncontent_db=other-content\n');
    const context = { home: mlcpEnvHome, environment: { name: 'active', host: 'localhost', content_db: 'content' } };

    const defaulted = resolveEnvironmentsForOperation('import', {}, context);
    assert.equal(defaulted.envTo.name, 'active');

    const overridden = resolveEnvironmentsForOperation('import', { env_to: 'other' }, context);
    assert.equal(overridden.envTo.host, 'other.example.com');

    fs.rmSync(mlcpEnvHome, { recursive: true, force: true });
  });

  await test('trust: trustStorePath and certificateAlias are pure and stable', () => {
    assert.equal(trustStorePath('/home/user'), path.join('/home/user', '.mlsh', 'trust-store.jks'));
    assert.equal(certificateAlias('ml.example.com', '8000'), 'ml.example.com_8000');
    assert.equal(certificateAlias('ml.example.com', 8000), 'ml.example.com_8000');
    // keytool aliases can't contain characters like ':'; anything unsafe is replaced.
    assert.equal(certificateAlias('::1', '8000'), '__1_8000');
  });

  await test('trust: ensureTrustedCertificates is a no-op for an empty list and does not touch the filesystem', async () => {
    const trustHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-trust-'));
    const result = await ensureTrustedCertificates([], trustHome);
    assert.equal(result, null);
    assert.ok(!fs.existsSync(trustStorePath(trustHome)));
    fs.rmSync(trustHome, { recursive: true, force: true });
  });

  if (spawnSync('which', ['openssl']).status === 0 && spawnSync('which', ['keytool']).status === 0) {
    await (async () => {
      const trustHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-trust-tls-'));
      const certDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-trust-cert-'));
      const keyPath = path.join(certDirectory, 'key.pem');
      const certPath = path.join(certDirectory, 'cert.pem');
      spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1']);

      const server = tls.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (socket) => socket.end());
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        await test('trust: ensureTrustedCertificates fetches and imports a real self-signed certificate (trust-on-first-use)', async () => {
          const trust = await ensureTrustedCertificates([{ host: '127.0.0.1', port }], trustHome);
          assert.equal(trust.trustStorePath, trustStorePath(trustHome));
          assert.ok(fs.existsSync(trust.trustStorePath));
          assert.equal(trust.imported.length, 1);
          assert.equal(trust.imported[0].alias, certificateAlias('127.0.0.1', port));

          const listing = spawnSync('keytool', ['-list', '-keystore', trust.trustStorePath, '-storepass', trust.trustStorePassword, '-alias', certificateAlias('127.0.0.1', port)]);
          assert.equal(listing.status, 0, listing.stderr?.toString());

          // Re-running (e.g. a second job against the same host) must not throw
          // or leave duplicate/stale entries behind.
          const second = await ensureTrustedCertificates([{ host: '127.0.0.1', port }], trustHome);
          assert.equal(second.imported.length, 1);
        });
      } finally {
        server.close();
        fs.rmSync(trustHome, { recursive: true, force: true });
        fs.rmSync(certDirectory, { recursive: true, force: true });
      }
    })();
  } else {
    console.log('- (skipped) trust: ensureTrustedCertificates fetches and imports a real self-signed certificate (openssl/keytool not found)');
  }

  await test('mlcp: redactedSummary masks password-like properties', () => {
    const summary = redactedSummary({ command: 'IMPORT', properties: { password: 'secret', output_password: 'secret2', input_file_path: 'x' } });
    assert.doesNotMatch(summary, /secret/);
    assert.match(summary, /\*{8}/);
  });

  await test('mlcp: diagnosticsHeader warns when https is used without insecure=true, and shows exactly where insecure came from', () => {
    const noWarning = diagnosticsHeader({
      name: '001',
      directory: '/project/.jobs/mlcp/import',
      invocation: { command: 'IMPORT' },
      environments: { envTo: { name: 'dev', protocol: 'https', host: 'ml.example.com', port: '8000', _file: '/home/.mlsh/environments/dev.env', _insecureExplicit: true, insecure: 'true' } },
      untrustedEntries: [{ host: 'ml.example.com', port: '8000' }],
      trust: { trustStorePath: '/home/.mlsh/trust-store.jks', trustStoreType: 'PKCS12', imported: [{ alias: 'ml.example.com_8000', subject: 'subject=CN=ml.example.com' }] },
      jvmArgs: ['-Djavax.net.ssl.trustStore=/home/.mlsh/trust-store.jks'],
      logFile: '/home/.mlsh/mlcp-logs/import-001.log'
    });
    assert.doesNotMatch(noWarning, /WARNING/);
    assert.match(noWarning, /insecure=true \(explicitly set in \/home\/\.mlsh\/environments\/dev\.env\)/);
    assert.match(noWarning, /imported alias 'ml\.example\.com_8000': subject=CN=ml\.example\.com/);

    const warned = diagnosticsHeader({
      name: '001',
      directory: '/project/.jobs/mlcp/import',
      invocation: { command: 'IMPORT' },
      environments: { envTo: { name: 'dev_fs', protocol: 'https', host: 'old.example.com', port: '8000', _file: '/home/.mlsh/environments/dev_fs.env', _insecureExplicit: false, insecure: 'false' } },
      untrustedEntries: [],
      trust: null,
      jvmArgs: [],
      logFile: '/home/.mlsh/mlcp-logs/import-001.log'
    });
    assert.match(warned, /WARNING: protocol is https but insecure is not true/);
    assert.match(warned, /insecure=false \(not set - defaulted to false\)/);
    assert.match(warned, /add\s*\n\s*'insecure=true' to \/home\/\.mlsh\/environments\/dev_fs\.env/);
  });

  await test('mlcp-tui: buildHeaderRow renders the sidebar and content titles at the requested widths', () => {
    const header = buildMlcpHeaderRow({ totalWidth: 60, sidebarWidth: 20, sidebarTitle: 'JOB TYPES', contentTitle: 'Select a job type' });
    const plain = stripAnsi(header);
    assert.match(plain, /JOB TYPES/);
    assert.match(plain, /Select a job type/);
    assert.equal(visibleLength(header), 60);
  });

  await test('mlcp-tui: buildStatusLine shows per-stage hints and right-aligned context', () => {
    const typesLine = stripAnsi(buildMlcpStatusLine({ width: 90, stage: 'types' }));
    assert.match(typesLine, /navigate/);
    assert.match(typesLine, /ENTER.*select/);

    const jobListLine = stripAnsi(buildMlcpStatusLine({ width: 90, stage: 'jobList', selectedType: 'import' }));
    assert.match(jobListLine, /new job/);
    assert.match(jobListLine, /Import/);

    const jobViewLine = stripAnsi(buildMlcpStatusLine({ width: 90, stage: 'jobView', selectedType: 'copy', lastRunCode: 0 }));
    assert.match(jobViewLine, /\[r\] run/);
    assert.match(jobViewLine, /last exit: 0/);
  });

  await test('mlcp: runs an existing job through the Node dispatcher without prompting, passing options via environment variables', () => {
    const mlcpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-mlcp-cli-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-mlcp-project-'));
    const gradleRunnerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-mlcp-runner-'));
    try {
      const envDirectory = configDirectory(mlcpHome);
      writeEnvironment('dev', envDirectory);
      activateEnvironment('dev', envDirectory, mlcpHome);

      const jobsDirectory = path.join(project, '.jobs', 'mlcp', 'import');
      fs.mkdirSync(jobsDirectory, { recursive: true });
      fs.writeFileSync(path.join(jobsDirectory, '123.job'), 'job=123\ninput_file_path=data/import\ninput_file_type=archive\ncollections=foo,bar\n');

      const capturedEnvPath = path.join(gradleRunnerDir, 'captured-env.json');
      const fakeGradlew = path.join(gradleRunnerDir, 'gradlew');
      fs.writeFileSync(fakeGradlew, `#!/bin/sh
node -e "
const fs = require('fs');
const prop = (name) => {
  const prefix = '-P' + name + '=';
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};
fs.writeFileSync(process.argv[1], JSON.stringify({
  command: prop('mlsh.mlcp.command'),
  options: JSON.parse(prop('mlsh.mlcp.options')),
  extra: JSON.parse(prop('mlsh.mlcp.extraArgs'))
}));
" "${capturedEnvPath}" "$@"
echo "mlcp fake stdout line"
`);
      fs.chmodSync(fakeGradlew, 0o755);

      const result = spawnSync(process.execPath, [path.resolve('bin/mlsh'), 'mlcp', 'import', '123'], {
        cwd: project,
        env: { ...process.env, HOME: mlcpHome, MLSH_MLCP_RUNNER_DIR: gradleRunnerDir },
        encoding: 'utf8'
      });
      assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
      assert.match(result.stdout, /MLSH MLCP job: 123/);
      assert.match(result.stdout, /mlcp fake stdout line/);
      const captured = JSON.parse(fs.readFileSync(capturedEnvPath, 'utf8'));
      assert.equal(captured.command, 'IMPORT');
      assert.equal(captured.options.input_file_path, path.join(fs.realpathSync(project), 'data/import'));
      assert.equal(captured.options.output_collections, 'foo,bar');
      assert.equal(captured.options.host, 'localhost');
      assert.equal(captured.options.username, 'admin');
      assert.equal(captured.options.password, 'admin');
      assert.deepEqual(captured.extra, []);

      // The output is also captured to a stable log file (not just terminal
      // scrollback), and the CLI prints exactly where.
      const logMatch = result.stdout.match(/Full output saved to: (.*mlcp-logs.*\.log)/);
      assert.ok(logMatch, `expected a "Full output saved to" line in:\n${result.stdout}`);
      const logFile = logMatch[1].trim();
      assert.ok(fs.existsSync(logFile), `log file should exist at ${logFile}`);
      assert.match(fs.readFileSync(logFile, 'utf8'), /mlcp fake stdout line/);
    } finally {
      fs.rmSync(mlcpHome, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(gradleRunnerDir, { recursive: true, force: true });
    }
  });

} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} passed`);
if (process.exitCode) process.exit(process.exitCode);
