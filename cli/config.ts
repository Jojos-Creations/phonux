import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The `phonux.build` block of an app's package.json. Every field is optional. */
export interface BuildConfig {
  /** npm script that builds the web app Capacitor wraps. */
  web: string;
  /** npm script that builds the desktop app. */
  desktop: string;
  /** Android release signing. Passwords come from PHONUX_KEYSTORE_PASSWORD and PHONUX_KEY_PASSWORD. */
  android?: { keystore: string; alias: string };
  /** Apple developer team for signed iOS builds. */
  ios?: { teamId: string };
}

/** What `phonux build` reads from the app it runs in. */
export interface AppInfo {
  root: string;
  scripts: Record<string, string>;
  config: BuildConfig;
}

/** Reads the app's package.json from `root`. */
export function readApp(root: string): AppInfo {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) throw new Error(`No package.json in ${root}. Run phonux build from your app's folder.`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const raw = pkg.phonux?.build ?? {};
  return {
    root,
    scripts: pkg.scripts ?? {},
    config: { web: raw.web ?? 'build:web', desktop: raw.desktop ?? 'build:desktop', android: raw.android, ios: raw.ios },
  };
}

// Under the build folder, so a clean of build output also forgets the selection.
function selectionPath(root: string): string {
  return join(root, '.phonux', 'build', 'targets.json');
}

/** The targets picked last time, or none. */
export function readSelection(root: string): string[] {
  try {
    const ids = JSON.parse(readFileSync(selectionPath(root), 'utf8'));
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembers the picked targets for the next run. */
export function writeSelection(root: string, ids: readonly string[]): void {
  const path = selectionPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ids)}\n`);
}
