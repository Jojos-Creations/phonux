import type { Job, Step } from './plan.js';
/** The command line as it is safe to print: password values are hidden. */
export declare function describeStep(step: Extract<Step, {
    kind: 'run';
}>): string;
/** Where a job's full output is written. */
export declare function logPath(root: string, job: Job): string;
/** Runs a job's steps in order into its log file, stopping at the first failure. */
export declare function runJob(root: string, job: Job): Promise<boolean>;
/** The last lines of a job's log, to show why it failed without opening the file. */
export declare function logTail(root: string, job: Job, lines?: number): string;
