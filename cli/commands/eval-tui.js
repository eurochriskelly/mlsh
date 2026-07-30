import fs from 'fs';
import os from 'os';
import path from 'path';
import { ask } from '../lib/prompt.js';
import { edit } from '../lib/editor.js';
import {
  ansi,
  dim,
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
  barBg: 236,
  barNumber: 220,
  barDivider: 240,
  barFile: 253,
  barSelectedFile: 82,
  resultBg: 234,
  resultOk: 253,
  resultError: 203,
  statusBg: 235,
  statusDim: 244,
  statusAccent: 116
};

// Builds the compact "1:foo.xqy│2:bar.js" bar. Pure function so it's testable
// without a real terminal. `width` is the visible column budget (bar background
// fills the rest); `selected` is the currently-selected/last-run script name.
export function buildScriptBar(scripts, { width = 80, selected } = {}) {
  return paintRow(COLOR.barBg, width, (segment, literal) => {
    if (!scripts.length) return segment(COLOR.statusDim, ' No .xqy/.js/.sjs scripts in this directory ');
    const parts = [literal(' ')];
    scripts.forEach((file, index) => {
      if (index > 0) parts.push(segment(COLOR.barDivider, '│'));
      const fileColor = file === selected ? COLOR.barSelectedFile : COLOR.barFile;
      parts.push(segment(COLOR.barNumber, String(index + 1)));
      parts.push(segment(COLOR.barDivider, ':'));
      parts.push(segment(fileColor, file));
    });
    parts.push(literal(' '));
    return parts.join('');
  });
}

// Resolves a digit-buffer string (e.g. "12") to a script name, or null if the
// buffer is empty/out of range. Pure + testable.
export function resolveSelection(buffer, scripts) {
  if (!buffer) return null;
  const index = Number(buffer) - 1;
  return scripts[index] || null;
}

export function buildStatusLine({ width = 80, editArmed, buffer, lastScript, database, elapsed }) {
  return paintRow(COLOR.statusBg, width, (segment, literal) => {
    const modeText = editArmed ? 'EDIT' : 'RUN';
    const modeColor = editArmed ? COLOR.resultError : COLOR.statusAccent;
    const bufferLabel = buffer ? ` #${buffer}` : '';
    const left = [
      literal(' '),
      segment(modeColor, modeText),
      segment(COLOR.statusDim, bufferLabel),
      literal('  '),
      segment(COLOR.statusDim, '[1-9] run  [e] edit  [p] params  [q] quit')
    ].join('');

    const rightParts = [];
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

function buildResultLines({ width, height, result, placeholder }) {
  let bodyLines;
  if (!result) bodyLines = [placeholder];
  else if (!result.ok) bodyLines = result.message.split(/\r?\n/);
  else {
    const display = formatDisplay(result.response);
    bodyLines = display ? display.split(/\r?\n/) : ['(empty result)'];
  }

  const truncated = bodyLines.length > height;
  const visible = bodyLines.slice(0, height - (truncated ? 1 : 0));
  const isError = result && !result.ok;
  const fgColor = isError ? COLOR.resultError : COLOR.resultOk;

  const lines = visible.map((raw) => paintRow(COLOR.resultBg, width, (segment, literal) => `${literal(' ')}${segment(fgColor, raw)}`));
  if (truncated) {
    lines.push(paintRow(COLOR.resultBg, width, (segment, literal) => `${literal(' ')}${segment(COLOR.statusDim, `[+${bodyLines.length - visible.length} more lines]`)}`));
  }
  while (lines.length < height) lines.push(paintRow(COLOR.resultBg, width, () => ''));
  return lines;
}

export async function runEvalTui(context) {
  let database = (await ask(`Select a database or press ENTER for default [${context.environment.content_db}]: `)) || context.environment.content_db;
  const modules = (await ask(`Select a modules db or press ENTER for default [${context.environment.modules_db}]: `)) || context.environment.modules_db;

  let scripts = listScripts();
  let lastScript = '';
  let lastParams = '';
  let lastResult = null;
  let buffer = '';
  let editArmed = false;
  let running = false;

  enterAltScreen();
  hideCursor();
  process.stdout.write(ansi.clearScreen);

  const draw = () => {
    const { columns, rows } = size();
    const resultHeight = Math.max(1, rows - 2);
    const bar = buildScriptBar(scripts, { width: columns, selected: lastScript });
    const result = buildResultLines({
      width: columns,
      height: resultHeight,
      result: lastResult,
      placeholder: running ? 'Running…' : 'Press a number to run a script.'
    });
    const status = buildStatusLine({
      width: columns,
      editArmed,
      buffer,
      lastScript,
      database,
      elapsed: lastResult?.elapsed
    });
    renderFrame([bar, ...result, status]);
  };

  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });

  const runScript = async (script) => {
    lastScript = script;
    database = databaseOverride(script, database);
    running = true;
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
    showCursor();
    exitAltScreen();
  };

  const resumeTui = () => {
    enterAltScreen();
    hideCursor();
    process.stdout.write(ansi.clearScreen);
    startInput();
  };

  const promptForParams = async () => {
    suspendForExternalIO();
    const input = await ask('Params (key=value&key2=value2), ENTER to clear: ');
    lastParams = input || '';
    resumeTui();
    draw();
  };

  const editScript = async (script) => {
    suspendForExternalIO();
    try {
      edit(script);
    } catch {
      // Editor failures aren't fatal to the TUI session; the user can retry.
    }
    scripts = listScripts();
    resumeTui();
    draw();
  };

  let stopKeys = () => {};

  function startInput() {
    stopKeys = startKeypresses(async (chunk, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') return finish();
      if (key.name === 'q' && !editArmed) return finish();
      if (key.name === 'e') { editArmed = true; buffer = ''; draw(); return; }
      if (key.name === 'p') { await promptForParams(); return; }
      if (key.name === 'backspace') { buffer = buffer.slice(0, -1); draw(); return; }
      if (key.name === 'escape') { buffer = ''; editArmed = false; draw(); return; }
      if (key.name >= '0' && key.name <= '9') { buffer += key.name; draw(); return; }
      if (key.name === 'return' || key.name === 'enter') {
        if (!buffer) {
          if (!editArmed && lastScript) await runScript(lastScript);
          draw();
          return;
        }
        const script = resolveSelection(buffer, scripts);
        buffer = '';
        if (!script) { draw(); return; }
        if (editArmed) {
          editArmed = false;
          await editScript(script);
          return;
        }
        await runScript(script);
        return;
      }
    });
  }

  function finish() {
    stopKeys();
    showCursor();
    exitAltScreen();
    resolveExit(0);
  }

  process.stdout.on('resize', draw);
  startInput();
  draw();

  const code = await exitPromise;
  process.stdout.off('resize', draw);
  return code;
}
