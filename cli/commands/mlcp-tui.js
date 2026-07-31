import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
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
  visibleLength,
  watchResize
} from '../lib/tui.js';
import { buildContentBody, buildSidebarBody, clampCursor, combineColumns, sidebarWidthFor } from './eval-tui.js';
import {
  createAndEditJob,
  executeInvocation,
  jobDirectory,
  listJobs,
  mlcpLogPath,
  MLCP_OPERATIONS,
  nextJobName,
  parseJobFile,
  resolveJobFile
} from './mlcp.js';

const COLOR = { sidebarBg: 235, sidebarHeader: 141, headerBg: 235, headerAccent: 116, statusBg: 235, statusDim: 244 };

const TYPE_LABELS = { import: 'Import', export: 'Export', copy: 'Copy' };

// Builds the single top header row, split between the sidebar column and the
// content column. Pure function returning one full-width painted string.
// (A local variant of eval-tui's buildHeaderRow with a configurable sidebar
// title, since "SCRIPTS" doesn't fit a job-type/job-list browser.)
export function buildHeaderRow({ totalWidth, sidebarWidth, sidebarTitle, contentTitle }) {
  const sidebarHeader = paintRow(COLOR.sidebarBg, sidebarWidth, (segment) => segment(COLOR.sidebarHeader, ` ${sidebarTitle}`));
  const contentWidth = Math.max(0, totalWidth - sidebarWidth);
  const contentHeader = paintRow(COLOR.headerBg, contentWidth, (segment) => segment(COLOR.headerAccent, ` ${contentTitle}`));
  return sidebarHeader + contentHeader;
}

const STAGE_HINTS = {
  types: '[\u2191/\u2193 j/k] navigate   [ENTER] select   [q] quit',
  jobList: '[\u2191/\u2193 j/k] navigate   [ENTER] open   [n] new job   [ESC] back   [q] quit',
  jobView: '[r] run   [e] edit   [l] view last log   [ESC] back   [q] quit'
};

// Pure: single full-width status row with per-stage key hints on the left
// and context (selected type, last exit code) on the right.
export function buildStatusLine({ width = 80, stage, selectedType, lastRunCode }) {
  return paintRow(COLOR.statusBg, width, (segment, literal) => {
    const left = `${literal(' ')}${segment(COLOR.statusDim, STAGE_HINTS[stage] || '')}`;

    const rightParts = [];
    if (selectedType) rightParts.push(TYPE_LABELS[selectedType]);
    if (lastRunCode !== null && lastRunCode !== undefined) rightParts.push(`last exit: ${lastRunCode}`);
    const rightText = rightParts.length ? `${rightParts.join(' \u00b7 ')} ` : '';
    const right = segment(COLOR.statusDim, rightText);

    const gap = Math.max(1, width - visibleLength(left) - visibleLength(right));
    return left + literal(' '.repeat(gap)) + right;
  });
}

// A plain question prompt against the controlling terminal directly (see
// eval-tui.js's askOnTty for why this doesn't just use readline on process.stdin/stdout).
function askOnTty({ input, output }, question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Opens a log file in $PAGER (or less) against the real controlling terminal,
// independent of whichever stdio this process itself was started with.
function viewInPager(logFile) {
  return new Promise((resolve) => {
    let fd;
    try {
      fd = fs.openSync('/dev/tty', 'r+');
    } catch {
      resolve();
      return;
    }
    const pager = spawn(process.env.PAGER || 'less', ['-R', logFile], { stdio: [fd, fd, fd] });
    const done = () => { fs.closeSync(fd); resolve(); };
    pager.on('exit', done);
    pager.on('error', done);
  });
}

export async function runMlcpTui(context, ttyHandle) {
  const { input, output } = ttyHandle;

  let stage = 'types'; // 'types' | 'jobList' | 'jobView'
  let typeIndex = 0;
  let selectedType = null;
  let jobs = [];
  let jobIndex = 0;
  let selectedJob = null;
  let jobContent = '';
  let lastRunCode = null;
  let lastLogFile = null;

  enterAltScreen(output);
  hideCursor(output);
  output.write(ansi.clearScreen);

  const currentDirectory = () => jobDirectory(process.cwd(), selectedType);

  const draw = () => {
    const { columns, rows } = size(output);
    const sidebarItems = stage === 'types' ? MLCP_OPERATIONS.map(operation => TYPE_LABELS[operation]) : jobs;
    const cursorIndex = stage === 'types' ? typeIndex : jobIndex;
    const sidebarWidth = sidebarWidthFor(sidebarItems, columns);
    const contentWidth = Math.max(1, columns - sidebarWidth);
    const bodyHeight = Math.max(1, rows - 2);

    const sidebarTitle = stage === 'types' ? 'JOB TYPES' : `${TYPE_LABELS[selectedType].toUpperCase()} JOBS`;
    const contentTitle = stage === 'jobView' ? `${selectedJob}.job` : (stage === 'jobList' ? 'Select a job' : 'Select a job type');
    const header = buildHeaderRow({ totalWidth: columns, sidebarWidth, sidebarTitle, contentTitle });
    const sidebarBody = buildSidebarBody(sidebarItems, { cursorIndex, width: sidebarWidth, height: bodyHeight });
    const contentBody = buildContentBody({
      width: contentWidth,
      height: bodyHeight,
      mode: stage === 'jobView' ? 'preview' : 'empty',
      previewText: jobContent
    });
    const bodyRows = combineColumns(sidebarBody, contentBody);
    const status = buildStatusLine({ width: columns, stage, selectedType, lastRunCode });
    renderFrame([header, ...bodyRows, status], output);
  };

  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });

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

  const openJob = (name) => {
    selectedJob = name;
    jobContent = fs.readFileSync(resolveJobFile(currentDirectory(), name), 'utf8');
    lastLogFile = null;
    lastRunCode = null;
    stage = 'jobView';
  };

  const enterJobList = () => {
    selectedType = MLCP_OPERATIONS[typeIndex];
    jobs = listJobs(currentDirectory());
    jobIndex = 0;
    stage = 'jobList';
  };

  const createNewJob = async () => {
    suspendForExternalIO();
    try {
      const { name } = createAndEditJob(currentDirectory(), selectedType, nextJobName(currentDirectory()), { temporary: true, editFn: editOnTty });
      jobs = listJobs(currentDirectory());
      jobIndex = clampCursor(jobs.indexOf(name), jobs.length);
      openJob(name);
    } catch (error) {
      output.write(`${error.message}\n`);
      await askOnTty(ttyHandle, 'Press ENTER to continue: ');
    }
    resumeTui();
    draw();
  };

  const editJob = async () => {
    suspendForExternalIO();
    try {
      editOnTty(resolveJobFile(currentDirectory(), selectedJob));
    } catch {
      // Editor failures aren't fatal to the TUI session; the user can retry.
    }
    jobContent = fs.readFileSync(resolveJobFile(currentDirectory(), selectedJob), 'utf8');
    resumeTui();
    draw();
  };

  const runJob = async () => {
    suspendForExternalIO();
    const fields = parseJobFile(jobContent);
    const logFile = mlcpLogPath(context.home, selectedType, selectedJob);
    try {
      lastRunCode = await executeInvocation(context, selectedType, selectedJob, fields, currentDirectory(), { logFile });
      lastLogFile = logFile;
    } catch (error) {
      output.write(`mlcp: ${error.message}\n`);
      lastRunCode = 1;
      lastLogFile = fs.existsSync(logFile) ? logFile : null;
    }
    const answer = await askOnTty(ttyHandle, 'Press ENTER to return, or type L to view the full log in less: ');
    if (answer.toLowerCase() === 'l' && lastLogFile) await viewInPager(lastLogFile);
    resumeTui();
    draw();
  };

  let stopKeys = () => {};

  function startInput() {
    stopKeys = startKeypresses(async (chunk, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') return finish();
      if (key.name === 'q') return finish();

      if (stage === 'types') {
        if (key.name === 'up' || key.name === 'k') { typeIndex = clampCursor(typeIndex - 1, MLCP_OPERATIONS.length); draw(); return; }
        if (key.name === 'down' || key.name === 'j') { typeIndex = clampCursor(typeIndex + 1, MLCP_OPERATIONS.length); draw(); return; }
        if (key.name === 'return' || key.name === 'enter') { enterJobList(); draw(); return; }
        return;
      }

      if (stage === 'jobList') {
        if (key.name === 'up' || key.name === 'k') { jobIndex = clampCursor(jobIndex - 1, jobs.length); draw(); return; }
        if (key.name === 'down' || key.name === 'j') { jobIndex = clampCursor(jobIndex + 1, jobs.length); draw(); return; }
        if (key.name === 'return' || key.name === 'enter') { if (jobs.length) { openJob(jobs[jobIndex]); draw(); } return; }
        if (key.name === 'n') { await createNewJob(); return; }
        if (key.name === 'escape' || key.name === 'backspace' || key.name === 'left') { stage = 'types'; draw(); return; }
        return;
      }

      // stage === 'jobView'
      if (key.name === 'r') { await runJob(); return; }
      if (key.name === 'e') { await editJob(); return; }
      if (key.name === 'l' && lastLogFile) { suspendForExternalIO(); await viewInPager(lastLogFile); resumeTui(); draw(); return; }
      if (key.name === 's' || key.name === 'escape' || key.name === 'backspace' || key.name === 'left') { stage = 'jobList'; draw(); return; }
    }, input);
  }

  function finish() {
    stopKeys();
    showCursor(output);
    exitAltScreen(output);
    output.write(`${ansi.reset}\nMLCP session done.\n`);
    resolveExit(0);
  }

  const stopResizeWatch = watchResize(output, draw);
  startInput();
  draw();

  const code = await exitPromise;
  stopResizeWatch();
  return code;
}
