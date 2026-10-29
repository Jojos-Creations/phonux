#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkPlatform } from './checks.js';
import { readApp, readSelection, writeSelection } from './config.js';
import { pickTargets } from './picker.js';
import { planBuild } from './plan.js';
import { logPath, logTail, runJob } from './runner.js';
import { machineLimits, schedule } from './scheduler.js';
import { TARGETS, targetsById } from './targets.js';
const USAGE = `Usage: phonux build [options]

Builds your app for the devices you pick. With no options it shows the list.

  --targets <ids>   Comma-separated, skipping the list: ${TARGETS.map((t) => t.id).join(', ')}
  --check           Only check what this machine can build, and say what is missing
  --debug           Make test builds even when signing is set up
  --jobs <n>        Run at most n builds at once (default: picked from this machine's cores and memory)
`;
const realProbe = {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    exists: existsSync,
    run(command, args) {
        const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000 });
        if (result.error || result.status !== 0)
            return null;
        // `java -version` writes to stderr.
        return `${result.stdout}${result.stderr}`;
    },
};
function parseArgs(argv) {
    const out = { check: false, debug: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--targets')
            out.targets = (argv[++i] ?? '').split(',').filter(Boolean);
        else if (arg === '--check')
            out.check = true;
        else if (arg === '--debug')
            out.debug = true;
        else if (arg === '--jobs') {
            out.jobs = Number(argv[++i]);
            if (!Number.isInteger(out.jobs) || out.jobs < 1)
                throw new Error('--jobs needs a whole number of 1 or more.');
        }
        else
            throw new Error(`Unknown option ${arg}.\n\n${USAGE}`);
    }
    return out;
}
function seconds(ms) {
    return `${Math.round(ms / 1000)}s`;
}
async function build(argv) {
    const args = parseArgs(argv);
    const app = readApp(process.cwd());
    const readiness = new Map();
    const check = (platform) => {
        if (!readiness.has(platform))
            readiness.set(platform, checkPlatform(platform, app, realProbe));
        return readiness.get(platform);
    };
    let ids = args.targets;
    if (!ids && process.stdin.isTTY && !args.check) {
        const notes = new Map(TARGETS.filter((t) => !check(t.platform).ok).map((t) => [t.id, 'missing tools, see --check']));
        const picked = await pickTargets(TARGETS, readSelection(app.root), notes);
        if (!picked)
            return 1;
        ids = picked;
    }
    ids ??= args.check ? TARGETS.map((t) => t.id) : readSelection(app.root);
    if (ids.length === 0) {
        console.error('Nothing picked. Pick at least one target, or pass --targets.');
        return 1;
    }
    const targets = targetsById(ids);
    if (args.check) {
        let ok = true;
        for (const platform of new Set(targets.map((t) => t.platform))) {
            const labels = targets.filter((t) => t.platform === platform).map((t) => t.label).join(', ');
            const ready = check(platform);
            ok &&= ready.ok;
            console.log(`${ready.ok ? 'ready  ' : 'missing'} ${labels}`);
            for (const problem of ready.problems)
                console.log(`        ${problem}`);
        }
        return ok ? 0 : 1;
    }
    writeSelection(app.root, ids);
    const plan = planBuild(targets, app, realProbe, check, { debug: args.debug });
    for (const { platform, problems } of plan.skipped) {
        const labels = targets.filter((t) => t.platform === platform).map((t) => t.label).join(', ');
        console.log(`Skipping ${labels}:`);
        for (const problem of problems)
            console.log(`  ${problem}`);
    }
    const limits = machineLimits(args.jobs);
    console.log(`Building ${plan.jobs.map((j) => j.label).join(', ') || 'nothing'}, up to ${limits.maxJobs} at a time.`);
    const started = Date.now();
    const outcomes = await schedule(plan.jobs, limits, async (job) => {
        const t0 = Date.now();
        console.log(`  started  ${job.label}`);
        const ok = await runJob(app.root, job);
        console.log(`  ${ok ? 'finished' : 'FAILED  '} ${job.label} in ${seconds(Date.now() - t0)}`);
        return ok;
    });
    console.log(`\nDone in ${seconds(Date.now() - started)}.`);
    for (const job of plan.jobs) {
        const outcome = outcomes.get(job.id);
        if (outcome === 'done') {
            console.log(`  ${job.label}: ${job.output ? join(app.root, job.output) : 'done'}`);
        }
        else if (outcome === 'failed') {
            console.log(`  ${job.label} failed. Full log: ${logPath(app.root, job)}\n${logTail(app.root, job).replace(/^/gm, '    ')}`);
        }
        else {
            console.log(`  ${job.label} did not run, because a build it needs failed.`);
        }
    }
    const allBuilt = plan.skipped.length === 0 && plan.jobs.every((j) => outcomes.get(j.id) === 'done');
    return allBuilt ? 0 : 1;
}
async function main(argv) {
    const [command, ...rest] = argv;
    if (command === 'build')
        return build(rest);
    console.log(USAGE);
    return command === undefined || command === '--help' || command === '-h' ? 0 : 1;
}
main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
}, (err) => {
    console.error(err.message);
    process.exitCode = 1;
});
