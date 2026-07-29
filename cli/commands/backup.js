import path from 'path';
import { evaluateBundled } from './eval.js';
import { showHelp } from './help.js';

const SCRIPTS = { list: 'folders.js', create: 'backup.js', delete: 'delete.js' };

export async function runBackup(context, args) {
  const command = args[0];
  if (['-h', '--help'].includes(command) || !command) return showHelp('backup');
  if (!SCRIPTS[command]) throw new Error(`Unknown backup command: ${command}`);
  const script = path.join(context.topDir, 'scripts', 'backup', SCRIPTS[command]);
  return (await evaluateBundled(context, script, 'Security')).code;
}
