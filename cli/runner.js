import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const SECRET_FLAGS = new Set(['--keystorepass', '--keystorealiaspass']);
/** The command line as it is safe to print: password values are hidden. */
export function describeStep(step) {
    const args = step.args.map((arg, i) => (SECRET_FLAGS.has(step.args[i - 1] ?? '') ? '***' : arg));
    return [step.command, ...args].join(' ');
}
function runStep(step, env, log) {
    return new Promise((resolve) => {
        log.write(`\n$ ${describeStep(step)}\n`);
        const child = spawn(step.command, step.args, {
            cwd: step.cwd,
            env: { ...process.env, ...env },
            // npm, npx and gradlew.bat are .cmd or .bat files on Windows, which only a shell can start.
            shell: process.platform === 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.pipe(log, { end: false });
        child.stderr.pipe(log, { end: false });
        child.on('error', (err) => {
            log.write(`\n${err.message}\n`);
            resolve(false);
        });
        child.on('close', (code) => resolve(code === 0));
    });
}
/** Where a job's full output is written. */
export function logPath(root, job) {
    return join(root, '.phonux', 'build', 'logs', `${job.id}.log`);
}
/** Runs a job's steps in order into its log file, stopping at the first failure. */
export async function runJob(root, job) {
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
        ok = await runStep(step, job.env, log);
        if (!ok)
            break;
    }
    await new Promise((resolve) => log.end(resolve));
    return ok;
}
/** The last lines of a job's log, to show why it failed without opening the file. */
export function logTail(root, job, lines = 20) {
    try {
        return readFileSync(logPath(root, job), 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
    }
    catch {
        return '';
    }
}
