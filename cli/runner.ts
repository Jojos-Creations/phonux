import { cpSync, createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Transform } from 'node:stream';
import spawn from 'cross-spawn';
import type { Job, Step } from './plan.js';

/** The environment variables that hold the keystore passwords. */
const PASSWORD_VARIABLES = ['PHONUX_KEYSTORE_PASSWORD', 'PHONUX_KEY_PASSWORD'];

/** The command line as printed to the log. Steps carry no secrets: passwords travel by environment variable. */
export function describeStep(step: Extract<Step, { kind: 'run' }>): string {
  return [step.command, ...step.args].join(' ');
}

/** The environment a step starts with: the caller's, without the passwords unless the step signs. */
function stepEnvironment(step: Extract<Step, { kind: 'run' }>, env: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  for (const name of PASSWORD_VARIABLES) delete inherited[name];
  const passwords: NodeJS.ProcessEnv = {};
  if (step.signs === true) for (const name of PASSWORD_VARIABLES) passwords[name] = process.env[name];
  return { ...inherited, ...env, ...passwords };
}

/** Passes output on a line at a time with each secret replaced, so a secret split across two reads is still found. */
function redactor(secrets: string[]): Transform {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const clean = (text: string): string => secrets.reduce((out, secret) => out.split(secret).join('[hidden]'), text);
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      pending += decoder.write(chunk);
      const end = pending.lastIndexOf('\n') + 1;
      if (end > 0) this.push(clean(pending.slice(0, end)));
      pending = pending.slice(end);
      done();
    },
    flush(done) {
      this.push(clean(pending + decoder.end()));
      done();
    },
  });
}

function runStep(step: Extract<Step, { kind: 'run' }>, env: Record<string, string>, log: NodeJS.WritableStream): Promise<boolean> {
  return new Promise((resolve) => {
    log.write(`\n$ ${describeStep(step)}\n`);
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: stepEnvironment(step, env),
      // npm, npx and gradlew.bat are .cmd or .bat files on Windows; cross-spawn starts them with each argument escaped,
      // where `shell: true` would join the arguments unquoted into one command line.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const secrets = PASSWORD_VARIABLES.flatMap((name) => process.env[name] ?? []).filter((value) => value !== '');
    const streams = [child.stdout, child.stderr].flatMap((stream) => {
      if (!stream) return [];
      const clean = redactor(secrets);
      stream.pipe(clean).pipe(log, { end: false });
      return [new Promise<void>((done) => clean.once('end', done))];
    });
    child.on('error', (err) => {
      log.write(`\n${err.message}\n`);
      resolve(false);
    });
    // The next log line is written only after both outputs have reached the log.
    child.on('close', (code) => void Promise.all(streams).then(() => resolve(code === 0)));
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
