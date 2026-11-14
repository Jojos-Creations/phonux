import type { AppInfo } from './config.js';
import type { Platform } from './targets.js';
/** The machine a check looks at; tests pass a fake one. */
export interface Probe {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
    home: string;
    exists(path: string): boolean;
    /** Runs a command and returns its combined output, or null when it cannot run or exits non-zero. */
    run(command: string, args: readonly string[]): string | null;
}
/** What a platform's build needs that this machine has, or what is missing. */
export interface Readiness {
    ok: boolean;
    /** Plain sentences saying what is missing and how to get it. Empty when ok. */
    problems: string[];
    /** Environment the build commands need, such as JAVA_HOME found inside Android Studio. */
    env: Record<string, string>;
}
/** Checks whether this machine can build `platform` for the app. */
export declare function checkPlatform(platform: Platform, app: AppInfo, probe: Probe): Readiness;
