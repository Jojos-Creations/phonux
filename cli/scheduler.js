import { availableParallelism, totalmem } from 'node:os';
/**
 * Limits for this machine: one job per two cores up to three, inside half the memory.
 * `jobs` overrides the count, for a machine that shares its cores with other work.
 */
export function machineLimits(jobs) {
    // Half, because the developer's editor, browser and simulator keep running alongside the build.
    const memoryGb = totalmem() / 2 ** 30 / 2;
    const maxJobs = jobs ?? Math.max(1, Math.min(3, Math.floor(availableParallelism() / 2)));
    return { maxJobs: Math.max(1, maxJobs), memoryGb };
}
/**
 * Runs every job once its deps are done, as many at a time as `limits` allow.
 * A job too big for the memory budget still runs, alone, so a small machine builds in sequence instead of not at all.
 */
export async function schedule(jobs, limits, run) {
    const outcomes = new Map();
    const running = new Map();
    const pending = [...jobs];
    return new Promise((resolve) => {
        const pump = () => {
            for (let i = 0; i < pending.length; i++) {
                const job = pending[i];
                if (job.deps.some((dep) => outcomes.get(dep) === 'failed' || outcomes.get(dep) === 'skipped')) {
                    outcomes.set(job.id, 'skipped');
                    pending.splice(i, 1);
                    i = -1;
                }
            }
            for (let i = 0; i < pending.length; i++) {
                const job = pending[i];
                if (!job.deps.every((dep) => outcomes.get(dep) === 'done'))
                    continue;
                if (running.size >= limits.maxJobs)
                    break;
                const used = [...running.values()].reduce((sum, j) => sum + j.memoryGb, 0);
                if (running.size > 0 && used + job.memoryGb > limits.memoryGb)
                    continue;
                pending.splice(i, 1);
                i--;
                running.set(job.id, job);
                run(job)
                    .catch(() => false)
                    .then((ok) => {
                    running.delete(job.id);
                    outcomes.set(job.id, ok ? 'done' : 'failed');
                    pump();
                });
            }
            if (running.size === 0) {
                // Whatever is left waits on a dep that never ran, which only a dep missing from the list can cause.
                for (const job of pending)
                    outcomes.set(job.id, 'skipped');
                resolve(outcomes);
            }
        };
        pump();
    });
}
