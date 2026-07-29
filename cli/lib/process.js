import { spawn } from 'child_process';

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];

    if (!options.inherit) {
      child.stdout.on('data', chunk => stdout.push(chunk));
      child.stderr.on('data', chunk => stderr.push(chunk));
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({
      code: code ?? (signal ? 1 : 0),
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr)
    }));
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
