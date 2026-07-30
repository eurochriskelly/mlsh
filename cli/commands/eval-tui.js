import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { editOnTty } from '../lib/editor.js';
import {
  ansi,
  enterAltScreen,
  exitAltScreen,
  hideCursor,
  paintRow,
  renderFrame,
  showCursor,
  size,
  startKeypresses,
  visibleLength
} from '../lib/tui.js';
import { databaseOverride, formatDisplay, listScripts, performEval, prepareScript } from './eval.js';

const COLOR = {
  sidebarBg: 235,
  sidebarHeader: 141,
  sidebarActiveBg: 24,
  sidebarActiveFg: 231,
  sidebarFile: 253,
  headerBg: 235,
  headerAccent: 116,
  headerDim: 244,
  resultBg: 234,
  resultOk: 253,
  resultError: 203,
  statusBg: 235,
  statusDim: 244,
  statusAccent: 116
};

const MIN_SIDEBAR_WIDTH = 18;
const MAX_SIDEBAR_FRACTION = 0.35;

export function sidebarWidthFor(scripts, columns) {
  const longest = scripts.reduce((max, file) => Math.max(max, file.length), 0);
  const desired = longest + 6; // marker + spacing + filename
  const cap = Math.max(MIN_SIDEBAR_WIDTH, Math.floor(columns * MAX_SIDEBAR_FRACTION));
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(desired, cap));
}

// Clamps a cursor index into [0, length-1] (or 0 for an empty list). Pure + testable.
export function clampCursor(index, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

// Computes the scrolling window of scripts to show so the cursor stays
// visible within `visibleCount` rows. Pure + testable.
export function sidebarWindow(scripts, cursorIndex, visibleCount) {
  if (scripts.length <= visibleCount) return { start: 0, items: scripts };
  let start = 0;
  if (cursorIndex >= visibleCount) start = cursorIndex - visibleCount + 1;
  start = Math.min(start, scripts.length - visibleCount);
  return { start, items: scripts.slice(start, start + visibleCount) };
}

// Renders the sidebar's scrollable list body (not including its header row).
// Pure function returning `height` full-width painted strings.
export function buildSidebarBody(scripts, { cursorIndex = 0, width = 24, height = 10 } = {}) {
  const rows = [];
  if (!scripts.length) {
    rows.push(paintRow(COLOR.sidebarBg, width, (segment) => segment(COLOR.statusDim, ' (no scripts here) ')));
  } else {
    const { start, items } = sidebarWindow(scripts, cursorIndex, height);
    items.forEach((file, offset) => {
      const actualIndex = start + offset;
      const isCursor = actualIndex === cursorIndex;
      const bg = isCursor ? COLOR.sidebarActiveBg : COLOR.sidebarBg;
      const fg = isCursor ? COLOR.sidebarActiveFg : COLOR.sidebarFile;
      rows.push(paintRow(bg, width, (segment, literal) => `${literal(' ')}${segment(fg, `${isCursor ? '›' : ' '} ${file}`)}`));
    });
  }
  while (rows.length < height) rows.push(paintRow(COLOR.sidebarBg, width, () => ''));
  return rows.slice(0, height);
}

// Renders the content pane's body (not including its header row): either a
// navigation placeholder, a script source preview, or the last run's result.
// Pure function returning `height` full-width painted strings.
export function buildContentBody({ width, height, mode, previewText, result, running }) {
  let bodyLines;
  let isError = false;
  if (running) bodyLines = ['Running…'];
  else if (mode === 'result') {
    if (!result) bodyLines = ['No result yet. Press r to run.'];
    else if (!result.ok) { bodyLines = result.message.split(/\r?\n/); isError = true; }
    else {
      const display = formatDisplay(result.response);
      bodyLines = display ? display.split(/\r?\n/) : ['(empty result)'];
    }
  } else if (mode === 'preview') {
    bodyLines = previewText ? previewText.split(/\r?\n/) : ['(empty file)'];
  } else {
    bodyLines = ['Navigate with \u2191/\u2193 or j/k, press ENTER to view a script.'];
  }

  const truncated = bodyLines.length > height;
  const visible = bodyLines.slice(0, height - (truncated ? 1 : 0));
  const fgColor = isError ? COLOR.resultError : COLOR.resultOk;

  const lines = visible.map((raw) => paintRow(COLOR.resultBg, width, (segment, literal) => `${literal(' ')}${segment(fgColor, raw)}`));
  if (truncated) {
    lines.push(paintRow(COLOR.resultBg, width, (segment, literal) => `${literal(' ')}${segment(COLOR.statusDim, `[+${bodyLines.length - visible.length} more lines]`)}`));
  }
  while (lines.length < height) lines.push(paintRow(COLOR.resultBg, width, () => ''));
  return lines;
}

// Builds the single top header row, split between the sidebar column
// ("SCRIPTS") and the content column (current script + mode, or a hint).
// Pure function returning one full-width painted string.
export function buildHeaderRow({ totalWidth, sidebarWidth, selectedScript, mode }) {
  const sidebarHeader = paintRow(COLOR.sidebarBg, sidebarWidth, (segment) => segment(COLOR.sidebarHeader, ' SCRIPTS'));
  const contentWidth = Math.max(0, totalWidth - sidebarWidth);
  const label = selectedScript ? `${selectedScript}${mode === 'result' ? ' · result' : ' · preview'}` : 'Select a script';
  const contentHeader = paintRow(COLOR.headerBg, contentWidth, (segment) => segment(COLOR.headerAccent, ` ${label}`));
  return sidebarHeader + contentHeader;
}

// Concatenates two equal-length arrays of same-height painted rows into full
// combined rows (sidebar column beside content column). Pure + testable.
export function combineColumns(leftRows, rightRows) {
  return leftRows.map((left, index) => left + (rightRows[index] || ''));
}

export function buildStatusLine({ width = 80, mode, lastScript, database, elapsed, running }) {
  return paintRow(COLOR.statusBg, width, (segment, literal) => {
    const hint = mode === 'view'
      ? '[r] run  [e] edit  [s] select  [p] params  [q] quit'
      : '[\u2191/\u2193 j/k] navigate  [ENTER] view  [p] params  [q] quit';
    const left = `${literal(' ')}${segment(COLOR.statusDim, hint)}`;

    const rightParts = [];
    if (running) rightParts.push('running…');
    if (lastScript) rightParts.push(lastScript);
    if (database) rightParts.push(`db:${database}`);
    if (elapsed !== undefined && elapsed !== null) rightParts.push(`${elapsed}s`);
    const rightText = rightParts.length ? `${rightParts.join(' · ')} ` : '';
    const right = segment(COLOR.statusDim, rightText);

    const leftVisible = visibleLength(left);
    const rightVisible = visibleLength(right);
    const gap = Math.max(1, width - leftVisible - rightVisible);
    return left + literal(' '.repeat(gap)) + right;
  });
}

// A plain question prompt against the controlling terminal directly, so it
// works correctly regardless of how the parent process's own stdio is wired
// (mlsh's interactive shell pipes stdout through `tee` for session logging).
function askOnTty({ input, output }, question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runEvalTui(context, ttyHandle) {
  const { input, output } = ttyHandle;
  let database = (await askOnTty(ttyHandle, `Select a database or press ENTER for default [${context.environment.content_db}]: `)) || context.environment.content_db;
  const modules = (await askOnTty(ttyHandle, `Select a modules db or press ENTER for default [${context.environment.modules_db}]: `)) || context.environment.modules_db;

  let scripts = listScripts();
  let cursorIndex = 0;
  let mode = 'select'; // 'select' (sidebar navigation) | 'view' (script chosen: preview/result)
  let contentMode = 'empty'; // 'empty' | 'preview' | 'result'
  let selectedScript = '';
  let lastParams = '';
  let lastResult = null;
  let running = false;

  enterAltScreen(output);
  hideCursor(output);
  output.write(ansi.clearScreen);

  const draw = () => {
    const { columns, rows } = size(output);
    const sidebarWidth = sidebarWidthFor(scripts, columns);
    const contentWidth = Math.max(1, columns - sidebarWidth);
    const bodyHeight = Math.max(1, rows - 2);

    const header = buildHeaderRow({ totalWidth: columns, sidebarWidth, selectedScript, mode: contentMode });
    const sidebarBody = buildSidebarBody(scripts, { cursorIndex, width: sidebarWidth, height: bodyHeight });
    const contentBody = buildContentBody({
      width: contentWidth,
      height: bodyHeight,
      mode: contentMode,
      previewText: contentMode === 'preview' && selectedScript ? readPreview(selectedScript) : '',
      result: lastResult,
      running
    });
    const bodyRows = combineColumns(sidebarBody, contentBody);
    const status = buildStatusLine({
      width: columns,
      mode,
      lastScript: selectedScript,
      database,
      elapsed: lastResult?.elapsed,
      running
    });
    renderFrame([header, ...bodyRows, status], output);
  };

  function readPreview(script) {
    try {
      return fs.readFileSync(script, 'utf8');
    } catch (error) {
      return `Could not read ${script}: ${error.message}`;
    }
  }

  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });

  const runScript = async (script) => {
    database = databaseOverride(script, database);
    running = true;
    contentMode = 'result';
    draw();
    const { prepared, cleanup } = prepareScript(script, database, modules);
    try {
      const result = await performEval(context, prepared, database, lastParams);
      lastResult = result;
      fs.writeFileSync(path.join(os.tmpdir(), 'mlsh-eval.out'), result.response);
    } finally {
      cleanup();
      running = false;
      draw();
    }
  };

  const suspendForExternalIO = () => {
    stopKeys();
    showCursor(output);
    exitAltScreen(output);
  };

  const resumeTui = () => {
    enterAltScreen(output);
    hideCursor(output);
    output.write(ansi.clearScreen);
    startInput();
  };

  const promptForParams = async () => {
    suspendForExternalIO();
    const answer = await askOnTty(ttyHandle, 'Params (key=value&key2=value2), ENTER to clear: ');
    lastParams = answer || '';
    resumeTui();
    draw();
  };

  const editScript = async (script) => {
    suspendForExternalIO();
    try {
      editOnTty(script);
    } catch {
      // Editor failures aren't fatal to the TUI session; the user can retry.
    }
    scripts = listScripts();
    cursorIndex = clampCursor(cursorIndex, scripts.length);
    resumeTui();
    draw();
  };

  let stopKeys = () => {};

  function startInput() {
    stopKeys = startKeypresses(async (chunk, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') return finish();
      if (key.name === 'q') return finish();
      if (key.name === 'p') { await promptForParams(); return; }

      if (mode === 'select') {
        if (key.name === 'up' || key.name === 'k') { cursorIndex = clampCursor(cursorIndex - 1, scripts.length); draw(); return; }
        if (key.name === 'down' || key.name === 'j') { cursorIndex = clampCursor(cursorIndex + 1, scripts.length); draw(); return; }
        if (key.name === 'return' || key.name === 'enter') {
          if (!scripts.length) return;
          selectedScript = scripts[cursorIndex];
          contentMode = 'preview';
          lastResult = null;
          mode = 'view';
          draw();
          return;
        }
        return;
      }

      // mode === 'view'
      if (key.name === 's' || key.name === 'escape') { mode = 'select'; draw(); return; }
      if (key.name === 'r') { if (selectedScript) await runScript(selectedScript); return; }
      if (key.name === 'e') { if (selectedScript) await editScript(selectedScript); return; }
    }, input);
  }

  function finish() {
    stopKeys();
    showCursor(output);
    exitAltScreen(output);
    resolveExit(0);
  }

  output.on('resize', draw);
  startInput();
  draw();

  const code = await exitPromise;
  output.off('resize', draw);
  return code;
}
