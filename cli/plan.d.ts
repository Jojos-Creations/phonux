import type { Probe, Readiness } from './checks.js';
import type { AppInfo } from './config.js';
import { type Platform, type Target } from './targets.js';
/** One command a job runs, or a file it writes before the next command. */
export type Step = {
    kind: 'run';
    command: string;
    args: string[];
    cwd: string;
} | {
    kind: 'write';
    path: string;
    content: string;
} | {
    kind: 'copy';
    from: string;
    to: string;
};
/** A unit the scheduler runs: its steps run in order, after every job in `deps` has finished. */
export interface Job {
    id: string;
    label: string;
    deps: string[];
    /** Rough peak memory in GB, so two heavy jobs are not started on a machine that cannot hold both. */
    memoryGb: number;
    steps: Step[];
    env: Record<string, string>;
    /** Where the finished build lands, relative to the app root: always under `.phonux/build/<job>`. */
    output?: string;
}
/** The jobs to run, and the platforms left out with the reason. */
export interface BuildPlan {
    jobs: Job[];
    skipped: {
        platform: Platform;
        problems: string[];
    }[];
}
/** Options that change what a plan builds. */
export interface PlanOptions {
    /** Build test builds even when signing is configured. */
    debug: boolean;
}
/** Turns picked targets into jobs, leaving out each platform this machine cannot build. */
export declare function planBuild(targets: readonly Target[], app: AppInfo, probe: Probe, check: (platform: Platform) => Readiness, opts: PlanOptions): BuildPlan;
