import readline from 'readline';

export function ask(question) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => input.question(question, answer => {
    input.close();
    resolve(answer.trim());
  }));
}

export async function confirm(question = 'Continue? (y/n): ') {
  return (await ask(question)).toLowerCase() === 'y';
}
