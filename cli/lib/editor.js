import { spawnSync } from 'child_process';

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
