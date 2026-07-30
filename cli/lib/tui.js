import readline from 'readline';

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

export function enterAltScreen() {
  process.stdout.write(ansi.altScreenOn);
}

export function exitAltScreen() {
  process.stdout.write(ansi.altScreenOff);
}

export function hideCursor() {
  process.stdout.write(ansi.cursorHide);
}

export function showCursor() {
  process.stdout.write(ansi.cursorShow);
}

export function size() {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24
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
  if (width && visible > width) content = truncateVisible(content, width) ;
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

let keypressActive = false;

export function startKeypresses(onKey) {
  if (keypressActive) throw new Error('Keypress handling already active.');
  keypressActive = true;
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  const listener = (chunk, key) => onKey(chunk, key);
  process.stdin.on('keypress', listener);
  return () => {
    process.stdin.off('keypress', listener);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    keypressActive = false;
  };
}

// Writes a full frame (array of lines) in one write, homing the cursor first
// to avoid flicker/partial redraws.
export function renderFrame(lines) {
  process.stdout.write(ansi.cursorHome + lines.join('\r\n'));
}
