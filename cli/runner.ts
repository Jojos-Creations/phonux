import { cpSync, createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import spawn from 'cross-spawn';
import type { Job, Step } from './plan.js';

/** The command line as printed to the log. Steps carry no secrets: passwords travel by environment variable. */
export function describeStep(step: Extract<Step, { kind: 'run' }>): string {
  return [step.command, ...step.args].join(' ');
}

function runStep(step: Extract<Step, { kind: 'run' }>, env: Record<string, string>, log: NodeJS.WritableStream): Promise<boolean> {
  return new Promise((resolve) => {
    log.write(`\n$ ${describeStep(step)}\n`);
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...env },
      // npm, npx and gradlew.bat are .cmd or .bat files on Windows; cross-spawn starts them with each argument escaped,
      // where `shell: true` would join the arguments unquoted into one command line.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.on('error', (err) => {
      log.write(`\n${err.message}\n`);
      resolve(false);
    });
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Where a job's full output is written. */
export function logPath(root: string, job: Job): string {
  return join(root, '.phonux', 'build', 'logs', `${job.id}.log`);
}

/** Runs a job's steps in order into its log file, stopping at the first failure. */
export async function runJob(root: string, job: Job): Promise<boolean> {
  const path = logPath(root, job);
  mkdirSync(dirname(path), { recursive: true });
  const log = createWriteStream(path);
  let ok = true;
  for (const step of job.steps) {
    if (step.kind === 'write') {
      mkdirSync(dirname(step.path), { recursive: true });
      writeFileSync(step.path, step.content);
      continue;
    }
    if (step.kind === 'copy') {
      // Cleared first, so a copy that failed cannot leave the last run's build looking like this one's.
      rmSync(step.to, { recursive: true, force: true });
      mkdirSync(dirname(step.to), { recursive: true });
      try {
        cpSync(step.from, step.to, { recursive: true });
      } catch (err) {
        log.write(`\nCould not copy the build to ${step.to}: ${(err as Error).message}\n`);
        ok = false;
        break;
      }
      continue;
    }
    ok = await runStep(step, job.env, log);
    if (!ok) break;
  }
  await new Promise<void>((resolve) => log.end(resolve));
  return ok;
}

/** The last lines of a job's log, to show why it failed without opening the file. */
export function logTail(root: string, job: Job, lines = 20): string {
  try {
    return readFileSync(logPath(root, job), 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}
