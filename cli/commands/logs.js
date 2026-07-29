import fs from 'fs';
import os from 'os';
import path from 'path';
import { ask } from '../lib/prompt.js';
import { evaluateBundled } from './eval.js';
import { showHelp } from './help.js';

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function showLogs(context, type = 'error', lines = 50) {
  const logType = type === 'access' ? 'AccessLog' : 'ErrorLog';
  console.log(`Fetching ${type} logs from ${context.environment.host}:${context.environment.port}...`);
  console.log('═══════════════════════════════════════════════════════════');
  const result = await context.client.request(`/manage/v2/logs?log-type=${logType}&limit=${encodeURIComponent(lines)}`, ['-H', 'Accept: application/json']);
  const response = result.body.toString();

  let managementError = !result.ok;
  try {
    managementError ||= Boolean(JSON.parse(response).errorResponse);
  } catch {
    // Successful responses are not guaranteed to be JSON on older servers.
  }
  if (managementError) {
    context.logger.warn(`management log API returned HTTP ${result.status}; falling back to xdmp:get-request-error-log`);
    console.log('Note: Using XQuery to fetch logs (Management API unavailable)\n');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-logs-'));
    const script = path.join(directory, 'logs.xqy');
    fs.writeFileSync(script, `xdmp:get-request-error-log(xdmp:request-timestamp(xdmp:request()) - 300, fn:current-dateTime())[1 to ${Number(lines) || 50}]\n`);
    try {
      return (await evaluateBundled(context, script, context.environment.content_db)).code;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  try {
    console.log(JSON.stringify(JSON.parse(response), null, 2));
  } catch {
    console.log(response);
  }
  console.log('═══════════════════════════════════════════════════════════');
  return 0;
}

async function searchLogs(context, pattern) {
  const selectedPattern = pattern || await ask("Please enter a search pattern (e.g. 'XDMP-AS'): ");
  if (!selectedPattern) throw new Error('A search pattern is required.');
  console.log(`Searching logs for pattern: ${selectedPattern}`);
  console.log('═══════════════════════════════════════════════════════════');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-log-search-'));
  const script = path.join(directory, 'search.xqy');
  const literal = selectedPattern.replace(/'/g, "''");
  fs.writeFileSync(script, `let $logs := xdmp:get-request-error-log(xdmp:request-timestamp(xdmp:request()) - 3600, fn:current-dateTime())\nreturn $logs[contains(., '${literal}')]\n`);
  try {
    return (await evaluateBundled(context, script, context.environment.content_db)).code;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function chooseCommand() {
  console.log(`MarkLogic Log Viewer
====================

1. show-errors   - Display recent error log entries
2. show-access   - Display recent access log entries
3. search        - Search logs for a pattern
4. follow        - Follow logs in real-time
`);
  return ({ 1: 'show-errors', 2: 'show-access', 3: 'search', 4: 'follow' })[await ask('Enter your choice (1-4): ')];
}

export async function runLogs(context, args) {
  let command = args[0];
  if (['-h', '--help'].includes(command)) return showHelp('logs');
  if (!command) command = await chooseCommand();
  if (command === 'show-errors') return showLogs(context, 'error', 50);
  if (command === 'show-access') return showLogs(context, 'access', 50);
  if (command === 'search') {
    const patternIndex = args.indexOf('--pattern');
    return searchLogs(context, patternIndex >= 0 ? args[patternIndex + 1] : args[1]);
  }
  if (command === 'follow') {
    const type = args[1] === 'access' ? 'access' : 'error';
    console.log('Following logs (press Ctrl+C to stop)...');
    while (true) {
      await showLogs(context, type, 20);
      console.log('\nWaiting 5 seconds for new logs...');
      await delay(5000);
    }
  }
  throw new Error(`Unknown logs command: ${command || '(empty)'}`);
}
