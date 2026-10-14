/**
 * Whether PANEL_API matches the package's major version. The two functions that decide are pure; the reader and the
 * command line at the end only fetch the inputs. `release:check` runs it as `tsx tools/phonux-api-level-version.ts <package dir>`.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A 0.x version is exempt: before 1.0.0 level 1 moves with the prereleases. A prerelease of N.0.0 already needs level N.
export function requiredLevelFor(version: string): number | null {
  const match = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(version);
  if (match === null) return null;
  const major = Number(match[1]);
  return major >= 1 ? major : null;
}

export function apiLevelVersionProblem(version: string, newest: number): string | null {
  const required = requiredLevelFor(version);
  if (required === null || required === newest) return null;
  return `version ${version} needs panel API level ${required} as PANEL_API, but panelApiLevel.ts says ${newest}`;
}

export function newestLevelIn(source: string): number | null {
  const match = /export const PANEL_API: PanelApiLevel = (\d+);/.exec(source);
  return match === null ? null : Number(match[1]);
}

export function packageApiLevelProblem(packageDir: string): string | null {
  const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string };
  const newest = newestLevelIn(readFileSync(join(packageDir, 'panelApiLevel.ts'), 'utf8'));
  if (newest === null) return 'panelApiLevel.ts has no `export const PANEL_API: PanelApiLevel = N;` line to read';
  return apiLevelVersionProblem(version, newest);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problem = packageApiLevelProblem(resolve(process.argv[2] ?? '.'));
  if (problem !== null) {
    console.error(problem);
    process.exit(1);
  }
}
