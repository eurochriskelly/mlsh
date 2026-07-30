import { spawnSync } from 'child_process';
import fs from 'fs';

export function editor() {
  if (process.env.EDITOR) return process.env.EDITOR;
  for (const candidate of ['nvim', 'vim', 'vi']) {
    if (spawnSync('which', [candidate], { stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('No editor found. Set $EDITOR or install nvim, vim, or vi.');
}

export function edit(file) {
  const result = spawnSync(editor(), [file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Editor exited with status ${result.status}.`);
}

// Like edit(), but always runs the editor against the real controlling
// terminal (/dev/tty) rather than the current process's inherited stdio.
// This matters when the caller's own stdio has been piped elsewhere (e.g.
// mlsh's interactive shell tees stdout for session logging), which would
// otherwise prevent a full-screen editor like vim/nvim from drawing.
export function editOnTty(file) {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    return edit(file);
  }
  try {
    const result = spawnSync(editor(), [file], { stdio: [fd, fd, fd] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Editor exited with status ${result.status}.`);
  } finally {
    fs.closeSync(fd);
  }
}
