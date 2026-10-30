/** The `phonux.build` block of an app's package.json. Every field is optional. */
export interface BuildConfig {
    /** npm script that builds the web app Capacitor wraps. */
    web: string;
    /** npm script that builds the desktop app. */
    desktop: string;
    /** Android release signing. Passwords come from PHONUX_KEYSTORE_PASSWORD and PHONUX_KEY_PASSWORD. */
    android?: {
        keystore: string;
        alias: string;
    };
    /** Apple developer team for signed iOS builds. */
    ios?: {
        teamId: string;
    };
}
/** What `phonux build` reads from the app it runs in. */
export interface AppInfo {
    root: string;
    scripts: Record<string, string>;
    config: BuildConfig;
}
/** Reads the app's package.json from `root`. */
export declare function readApp(root: string): AppInfo;
/** The targets picked last time, or none. */
export declare function readSelection(root: string): string[];
/** Remembers the picked targets for the next run. */
export declare function writeSelection(root: string, ids: readonly string[]): void;
