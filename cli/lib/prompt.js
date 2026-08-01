import readline from 'readline';

export function ask(question) {
  return new Promise((resolve, reject) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
    let answered = false;
    input.once('error', (error) => {
      if (answered) return;
      answered = true;
      input.close();
      reject(new Error(`Reading input failed: ${error.message}`));
    });
    // Without this, stdin closing before an answer (no controlling terminal,
    // a broken upstream pipe, etc.) leaves this promise pending forever with
    // nothing else keeping Node's event loop alive - which makes the whole
    // process exit silently, indistinguishable from the command "just
    // closing" with no explanation at all.
    input.once('close', () => {
      if (answered) return;
      answered = true;
      reject(new Error('No input available to answer the prompt (stdin closed before a response was given). Is a real terminal attached?'));
    });
    input.question(question, (answer) => {
      if (answered) return;
      answered = true;
      input.close();
      resolve(answer.trim());
    });
  });
}

export async function confirm(question = 'Continue? (y/n): ') {
  return (await ask(question)).toLowerCase() === 'y';
}
