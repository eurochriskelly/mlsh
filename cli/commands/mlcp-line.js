import fs from 'fs';
import { ask, confirm } from '../lib/prompt.js';
import {
  createAndEditJob,
  executeInvocation,
  jobBaseName,
  jobDirectory,
  listJobs,
  MLCP_OPERATIONS,
  nextJobName,
  parseJobFile,
  resolveJobFile
} from './mlcp.js';

// Plain-text fallback for `mlsh mlcp` with no arguments when there's no
// controlling terminal available for the full-screen TUI (e.g. piped
// stdio, CI). Mirrors eval.js's lineBasedInteractiveEval.
export async function lineBasedInteractiveMlcp(context) {
  while (true) {
    console.log('\nMLSH MLCP');
    MLCP_OPERATIONS.forEach((operation, index) => console.log(`  ${index + 1}. ${operation}`));
    const typeChoice = await ask('Select a job type, or eXit: ');
    if (typeChoice.toLowerCase() === 'x') return 0;
    const operation = MLCP_OPERATIONS[Number(typeChoice) - 1];
    if (!operation) {
      console.log('Nothing selected.');
      continue;
    }

    const directory = jobDirectory(process.cwd(), operation);
    while (true) {
      const jobs = listJobs(directory);
      console.log(`\n${operation.toUpperCase()} jobs:`);
      jobs.forEach((name, index) => console.log(`  ${index + 1}. ${name}`));
      const jobChoice = await ask('Select a job, [n] for a new job, or Back: ');
      if (!jobChoice || jobChoice.toLowerCase() === 'b') break;

      let fields;
      let name;
      if (jobChoice.toLowerCase() === 'n') {
        ({ fields, name } = createAndEditJob(directory, operation, nextJobName(directory), { temporary: true }));
      } else {
        name = jobs[Number(jobChoice) - 1];
        if (!name) {
          console.log('Nothing selected.');
          continue;
        }
        fields = parseJobFile(fs.readFileSync(resolveJobFile(directory, name), 'utf8'));
      }

      console.log(`\n--- ${name}.job ---`);
      console.log(fs.readFileSync(resolveJobFile(directory, jobBaseName(name)), 'utf8'));
      if (await confirm(`Run this ${operation} job now? (y/n): `)) {
        await executeInvocation(context, operation, name, fields, directory);
      }
    }
  }
}
