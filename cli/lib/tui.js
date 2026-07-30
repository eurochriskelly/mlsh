import fs from 'fs';
import readline from 'readline';
import tty from 'tty';

const ESC = '\x1b';

export const ansi = {
  altScreenOn: `${ESC}[?1049h`,
  altScreenOff: `${ESC}[?1049l`,
  cursorHide: `${ESC}[?25l`,
  cursorShow: `${ESC}[?25h`,
  cursorHome: `${ESC}[H`,
  clearScreen: `${ESC}[2J`,
  reset: `${ESC}[0m`
};

// Commands like `mlsh eval` are usually invoked through the interactive
// shell's `mlsh_run` wrapper, which pipes stdout through `tee` for session
// logging (see shell/bashrc). That makes `process.stdout.isTTY` false even
// though a real terminal is right there. To get full-screen control
// regardless of any such piping, open the controlling terminal directly via
// /dev/tty and use that for both input and output. Returns null if no
// controlling terminal is available (e.g. fully non-interactive/CI usage).
export function openControllingTty() {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
  try {
    const input = new tty.ReadStream(fd);
    const output = new tty.WriteStream(fd);
    if (!input.isTTY || !output.isTTY) return null;
    return { input, output };
  } catch {
    return null;
  }
}

export function enterAltScreen(output = process.stdout) {
  output.write(ansi.altScreenOn);
}

export function exitAltScreen(output = process.stdout) {
  output.write(ansi.altScreenOff);
}

export function hideCursor(output = process.stdout) {
  output.write(ansi.cursorHide);
}

export function showCursor(output = process.stdout) {
  output.write(ansi.cursorShow);
}

export function clearScreen(output = process.stdout) {
  output.write(ansi.clearScreen);
}

export function size(output = process.stdout) {
  return {
    columns: output.columns || 80,
    rows: output.rows || 24
  };
}

export function fg(code, text) {
  return `${ESC}[38;5;${code}m${text}${ansi.reset}`;
}

export function bg(code, text) {
  return `${ESC}[48;5;${code}m${text}${ansi.reset}`;
}

export function bgFg(bgCode, fgCode, text) {
  return `${ESC}[48;5;${bgCode}m${ESC}[38;5;${fgCode}m${text}${ansi.reset}`;
}

export function dim(text) {
  return `${ESC}[2m${text}${ansi.reset}`;
}

export function bold(text) {
  return `${ESC}[1m${text}${ansi.reset}`;
}

// Builds a full-width "themed row": a single background color maintained
// across the entire line, with only the foreground switching between
// segments (no per-segment reset, so the background never gets clobbered).
// `build(segment)` receives a `segment(fgCode, text)` helper and should
// return the plain concatenation of segments plus any literal text; the
// whole row is padded to `width` and reset exactly once at the end.
export function paintRow(bgCode, width, build) {
  const segment = (fgCode, text) => `${ESC}[48;5;${bgCode}m${ESC}[38;5;${fgCode}m${text}`;
  const literal = (text) => `${ESC}[48;5;${bgCode}m${text}`;
  let content = build(segment, literal);
  const visible = visibleLength(content);
  if (width && visible > width) content = truncateVisible(content, width);
  const padded = visible < width ? content + ' '.repeat(width - visible) : content;
  return `${ESC}[48;5;${bgCode}m${padded}${ansi.reset}`;
}

// Strips ANSI escape sequences so we can measure/pad the *visible* width of a string.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function visibleLength(text) {
  return text.replace(ANSI_PATTERN, '').length;
}

export function truncateVisible(text, width) {
  if (visibleLength(text) <= width) return text;
  // Simple approach: strip ANSI, truncate, and re-wrap with a reset. Good enough
  // for single-styled segments; callers should truncate before combining styles
  // for anything that needs to preserve inner color runs precisely.
  const plain = text.replace(ANSI_PATTERN, '');
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

// Pads a (possibly ANSI-styled) string with `fill` background/foreground so the
// *visible* width equals `width`, appending spaces styled with `padStyle` (a
// function taking a string and returning a styled string) so background color
// extends across the full row.
export function padTo(text, width, padStyle = (value) => value) {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  return text + padStyle(' '.repeat(width - visible));
}

const activeKeypressStreams = new Set();

export function startKeypresses(onKey, input = process.stdin) {
  if (activeKeypressStreams.has(input)) throw new Error('Keypress handling already active for this stream.');
  activeKeypressStreams.add(input);
  readline.emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);
  input.resume();
  const listener = (chunk, key) => onKey(chunk, key);
  input.on('keypress', listener);
  return () => {
    input.off('keypress', listener);
    if (input.isTTY) input.setRawMode(false);
    input.pause();
    activeKeypressStreams.delete(input);
  };
}

// Writes a full frame (array of lines) in one write, homing the cursor first
// to avoid flicker/partial redraws.
export function renderFrame(lines, output = process.stdout) {
  output.write(ansi.cursorHome + lines.join('\r\n'));
}
