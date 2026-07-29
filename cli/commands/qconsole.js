import fs from 'fs';
import path from 'path';
import { evaluateBundled } from './eval.js';
import { showHelp } from './help.js';

export async function runQconsole(context, args) {
  const command = args[0];
  const scripts = path.join(context.topDir, 'scripts', 'eval');
  if (['-h', '--help'].includes(command) || !command) return showHelp('qc');
  if (command === 'list') return (await evaluateBundled(context, path.join(scripts, 'getWorkspaces.xqy'), 'App-Services')).code;
  if (['pull', 'download'].includes(command)) {
    console.log(`Pulling Query Console workspace: ${args[1] || path.basename(process.cwd())}`);
    return (await evaluateBundled(context, path.join(scripts, 'prepWorkspaces.xqy'), 'App-Services')).code;
  }
  if (['push', 'upload'].includes(command)) {
    if (!fs.existsSync(path.resolve('_workspace.xml'))) throw new Error('No _workspace.xml found in the current directory.');
    console.log(`Uploading Query Console workspace: ${path.basename(process.cwd())}`);
    return (await evaluateBundled(context, path.join(scripts, 'updateWorkspaces.xqy'), 'App-Services')).code;
  }
  throw new Error(`Unknown Query Console command: ${command}`);
}
