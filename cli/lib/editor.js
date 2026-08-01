import { spawnSync } from 'child_process';
import fs from 'fs';

export function editor() {
  if (process.env.EDITOR) return process.env.EDITOR;
  for (const candidate of ['nvim', 'vim', 'vi']) {
    if (spawnSync('which', [candidate], { stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('No editor found. Set $EDITOR or install nvim, vim, or vi.');
}

function runEditor(file, stdio) {
  const result = spawnSync(editor(), [file], { stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Editor exited with status ${result.status}.`);
}

// Edits a file, always against the real controlling terminal (/dev/tty)
// rather than whatever stdio the current process happens to have.
//
// This matters for every command that can be run inside MLSH's interactive
// shell (env, mlcp, and anything else that opens an editor): `mlsh_run`
// pipes stdout through `tee` for session logging (see shell/bashrc), so
// process.stdout is a pipe even when a perfectly good terminal is right
// there. Inheriting that piped stdio doesn't just stop a full-screen editor
// from drawing - once the editor manipulates terminal modes on it, it can
// break the pipe outright ("tee: stdout: Resource temporarily unavailable"),
// crashing the whole interactive session.
//
// Falls back to inherited stdio only if there's truly no controlling
// terminal at all (fully non-interactive/CI usage).
export function edit(file) {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    runEditor(file, 'inherit');
    return;
  }
  try {
    runEditor(file, [fd, fd, fd]);
  } finally {
    fs.closeSync(fd);
  }
}

// Historical alias - edit() itself now always prefers the controlling
// terminal, so every existing call site already gets this behavior. Kept so
// call sites that want to be explicit about needing tty-safety (e.g. inside
// a TUI's alt-screen session) don't need to change.
export const editOnTty = edit;
