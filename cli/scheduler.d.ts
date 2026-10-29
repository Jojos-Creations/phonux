/** What the scheduler needs from a job. */
export interface Schedulable {
    id: string;
    deps: string[];
    memoryGb: number;
}
/** How much may run at once. */
export interface Limits {
    maxJobs: number;
    memoryGb: number;
}
/** How each job ended. A job is skipped when a job it depends on failed. */
export type Outcome = 'done' | 'failed' | 'skipped';
/**
 * Limits for this machine: one job per two cores up to three, inside half the memory.
 * `jobs` overrides the count, for a machine that shares its cores with other work.
 */
export declare function machineLimits(jobs?: number): Limits;
/**
 * Runs every job once its deps are done, as many at a time as `limits` allow.
 * A job too big for the memory budget still runs, alone, so a small machine builds in sequence instead of not at all.
 */
export declare function schedule<J extends Schedulable>(jobs: readonly J[], limits: Limits, run: (job: J) => Promise<boolean>): Promise<Map<string, Outcome>>;
