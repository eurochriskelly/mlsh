import fs from 'fs';
import path from 'path';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, off: 99 };

function normaliseLevel(level) {
  const value = String(level || 'info').toLowerCase();
  if (value === 'warning') return 'warn';
  if (['none', 'silent'].includes(value)) return 'off';
  return LEVELS[value] ? value : 'info';
}

export function prepareLogFile(file, maxBytes = 10 * 1024 * 1024) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
  if (!fs.existsSync(file)) fs.closeSync(fs.openSync(file, 'a', 0o600));
}

export function createLogger({ file, level, scope = 'mlsh', secret = '', debug = false }) {
  const configuredLevel = normaliseLevel(debug ? 'debug' : level);

  function redact(value) {
    const text = String(value ?? '');
    return secret ? text.split(secret).join('********') : text;
  }

  function log(messageLevel, message) {
    const normalised = normaliseLevel(messageLevel);
    if (LEVELS[normalised] < LEVELS[configuredLevel]) return;
    const timestamp = new Date().toISOString().replace('.000Z', 'Z');
    for (const line of redact(message).split(/\r?\n/)) {
      const entry = `${timestamp} ${normalised.toUpperCase().padEnd(5)} [${scope}] ${line}\n`;
      try {
        fs.appendFileSync(file, entry);
        if (debug) process.stderr.write(entry);
      } catch {
        // Logging must never prevent a command from running.
      }
    }
  }

  return {
    redact,
    trace: message => log('trace', message),
    debug: message => log('debug', message),
    info: message => log('info', message),
    warn: message => log('warn', message),
    error: message => log('error', message),
    child(childScope) {
      return createLogger({ file, level: configuredLevel, scope: childScope, secret, debug });
    }
  };
}
