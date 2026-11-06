/**
 * Finds a headless Chromium for the rendered tests, and says so loudly when there is none. Playwright wants the revision it was
 * built for; a machine that cached a different one (or ships one under /opt/pw-browsers) would skip every rendered test, and a
 * skip reads as a pass. So the search is explicit, the browser that ran is printed, and a run that finds none prints a banner
 * naming each test that did not run. PHONUX_REQUIRE_CHROMIUM=1 turns that skip into a failure; PHONUX_CHROMIUM=<path to a
 * headless shell or Chromium binary> names one by hand. Always headless: no window is ever opened.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The slice of Playwright the rendered tests use. */
export interface PlaywrightModule {
  chromium: { launch(o: { headless: true; executablePath?: string }): Promise<LaunchedBrowser<unknown>>; executablePath(): string };
}
/** The launched browser, with the caller's own slice of Playwright's Page. */
export interface LaunchedBrowser<P> {
  version(): string;
  newContext(o: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<{ newPage(): Promise<P>; close(): Promise<void> }>;
  close(): Promise<void>;
}

async function loadPlaywright(): Promise<PlaywrightModule | undefined> {
  try {
    const from = process.env.PLAYWRIGHT_DIR === undefined ? undefined : createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright');
    const ns = (await import(from === undefined ? 'playwright' : pathToFileURL(from).href)) as PlaywrightModule & { default?: PlaywrightModule };
    return ns.chromium === undefined ? ns.default : ns;
  } catch {
    return undefined;
  }
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

// The newest cached headless shell or Chromium, from where Playwright keeps its downloads.
function cached(): string | undefined {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')].filter((r): r is string => r !== undefined && existsSync(r));
  const found: { revision: number; path: string }[] = [];
  for (const root of roots) {
    for (const dir of readdirSync(root)) {
      const m = /^chromium(?:_headless_shell)?-(\d+)$/.exec(dir);
      if (m === null) continue;
      for (const sub of readdirSync(join(root, dir))) {
        for (const bin of ['chrome-headless-shell', 'Chromium.app/Contents/MacOS/Chromium', 'chrome']) {
          const p = join(root, dir, sub, bin);
          if (isFile(p)) found.push({ revision: Number(m[1]), path: p });
        }
      }
    }
  }
  return found.sort((a, b) => b.revision - a.revision)[0]?.path;
}

/** Where a browser is, in order: PHONUX_CHROMIUM, the revision Playwright wants, /opt/pw-browsers/chromium, the newest cached. */
export async function findChromium(): Promise<{ pw: PlaywrightModule; executablePath?: string; source: string } | { pw?: PlaywrightModule; why: string }> {
  const pw = await loadPlaywright();
  if (pw === undefined) return { why: 'playwright is not installed (npm install, or PLAYWRIGHT_DIR=<node_modules holding playwright>)' };
  const named = process.env.PHONUX_CHROMIUM;
  if (named !== undefined) return isFile(named) ? { pw, executablePath: named, source: 'PHONUX_CHROMIUM' } : { pw, why: `PHONUX_CHROMIUM names ${named}, which is not a file` };
  if (isFile(pw.chromium.executablePath())) return { pw, source: `playwright's own revision (${pw.chromium.executablePath()})` };
  if (isFile('/opt/pw-browsers/chromium')) return { pw, executablePath: '/opt/pw-browsers/chromium', source: '/opt/pw-browsers/chromium' };
  const other = cached();
  if (other !== undefined) return { pw, executablePath: other, source: `the newest cached browser, not the revision playwright wants (${other})` };
  return { pw, why: `no Chromium: playwright wants ${pw.chromium.executablePath()}, nothing at /opt/pw-browsers/chromium, nothing cached under ms-playwright (set PHONUX_CHROMIUM=<binary>)` };
}

/**
 * Launches headless Chromium for `label`, or returns undefined after saying loudly that `label` did NOT run (and failing when
 * PHONUX_REQUIRE_CHROMIUM=1). A launch that throws is a failure, not a skip: a browser was found and does not work.
 */
export async function launchChromium<P>(t: { skip(reason: string): void }, label: string): Promise<LaunchedBrowser<P> | undefined> {
  const found = await findChromium();
  if ('why' in found) {
    const banner = `\n*** RENDERED TEST DID NOT RUN: ${label}\n*** ${found.why}\n*** This is a skip, not a pass. PHONUX_REQUIRE_CHROMIUM=1 makes it a failure.\n`;
    process.stderr.write(banner);
    if (process.env.PHONUX_REQUIRE_CHROMIUM === '1') throw new Error(`${label} could not run: ${found.why}`);
    t.skip(`NOT RUN, no browser: ${found.why}`);
    return undefined;
  }
  const browser = await found.pw.chromium.launch({ headless: true, ...(found.executablePath === undefined ? {} : { executablePath: found.executablePath }) });
  process.stderr.write(`[rendered] ${label}: headless Chromium ${browser.version()} from ${found.source}\n`);
  return browser as LaunchedBrowser<P>;
}
