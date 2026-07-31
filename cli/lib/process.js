import { spawn } from 'child_process';
import fs from 'fs';

// When options.logFile is set, output is captured to that file in addition
// to whatever options.inherit already sends to the terminal (or to the
// resolved stdout/stderr buffers, if not inherited) - useful for long-running
// commands like mlcp whose output otherwise only lives in terminal
// scrollback, which is easy to lose or confuse with other on-screen content.
export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const capture = Boolean(options.logFile);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.inherit && !capture ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    const logStream = capture ? fs.createWriteStream(options.logFile, { flags: options.appendLogFile ? 'a' : 'w' }) : null;

    if (!options.inherit || capture) {
      const handle = (chunks, streamName) => (chunk) => {
        chunks.push(chunk);
        if (options.inherit) process[streamName].write(chunk);
        if (logStream) logStream.write(chunk);
      };
      child.stdout.on('data', handle(stdout, 'stdout'));
      child.stderr.on('data', handle(stderr, 'stderr'));
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const finish = () => resolve({
        code: code ?? (signal ? 1 : 0),
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr)
      });
      if (logStream) logStream.end(finish);
      else finish();
    });
  });
}

export async function commandExists(command) {
  try {
    const result = await runProcess('which', [command]);
    return result.code === 0;
  } catch {
    return false;
  }
}
