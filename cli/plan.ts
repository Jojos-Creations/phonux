import { join } from 'node:path';
import type { Probe, Readiness } from './checks.js';
import type { AppInfo } from './config.js';
import { iosDeviceFamily, type Platform, type Target } from './targets.js';

/** One command a job runs, or a file it writes before the next command. */
export type Step =
  | { kind: 'run'; command: string; args: string[]; cwd: string }
  | { kind: 'write'; path: string; content: string };

/** A unit the scheduler runs: its steps run in order, after every job in `deps` has finished. */
export interface Job {
  id: string;
  label: string;
  deps: string[];
  /** Rough peak memory in GB, so two heavy jobs are not started on a machine that cannot hold both. */
  memoryGb: number;
  steps: Step[];
  env: Record<string, string>;
  /** Where the finished build lands, relative to the app root. */
  output?: string;
}

/** The jobs to run, and the platforms left out with the reason. */
export interface BuildPlan {
  jobs: Job[];
  skipped: { platform: Platform; problems: string[] }[];
}

/** Options that change what a plan builds. */
export interface PlanOptions {
  /** Build test builds even when signing is configured. */
  debug: boolean;
}

const OUT = join('.phonux', 'build');

function npm(app: AppInfo, script: string): Step {
  return { kind: 'run', command: 'npm', args: ['run', script], cwd: app.root };
}

function cap(app: AppInfo, ...args: string[]): Step {
  return { kind: 'run', command: 'npx', args: ['cap', ...args], cwd: app.root };
}

// `cap add` creates the native project once; after that it is the developer's to commit and customize.
function capPrepare(app: AppInfo, probe: Probe, platform: 'android' | 'ios'): Step[] {
  const add = probe.exists(join(app.root, platform)) ? [] : [cap(app, 'add', platform)];
  return [...add, cap(app, 'sync', platform)];
}

function androidJob(app: AppInfo, probe: Probe, env: Record<string, string>, opts: PlanOptions): Job | string[] {
  const signing = opts.debug ? undefined : app.config.android;
  const prepare = capPrepare(app, probe, 'android');
  if (!signing) {
    const gradlew = probe.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    return {
      id: 'android', label: 'Android test build', deps: ['web'], memoryGb: 3, env,
      steps: [...prepare, { kind: 'run', command: gradlew, args: ['assembleDebug'], cwd: join(app.root, 'android') }],
      output: join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    };
  }
  const storePass = probe.env.PHONUX_KEYSTORE_PASSWORD;
  if (!storePass) return ['Android signing is set up, but PHONUX_KEYSTORE_PASSWORD is not set. Set it, or build with --debug for a test build.'];
  const keyPass = probe.env.PHONUX_KEY_PASSWORD ?? storePass;
  return {
    id: 'android', label: 'Android release build', deps: ['web'], memoryGb: 3, env,
    steps: [
      ...prepare,
      cap(app, 'build', 'android', '--keystorepath', signing.keystore, '--keystorepass', storePass, '--keystorealias', signing.alias, '--keystorealiaspass', keyPass, '--androidreleasetype', 'AAB'),
    ],
    output: join('android', 'app', 'build', 'outputs', 'bundle', 'release'),
  };
}

function exportOptions(teamId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>teamID</key><string>${teamId}</string>
<key>signingStyle</key><string>automatic</string>
</dict></plist>
`;
}

function iosJob(app: AppInfo, probe: Probe, env: Record<string, string>, targets: readonly Target[], opts: PlanOptions): Job {
  const workspace = join('ios', 'App', 'App.xcworkspace');
  // CocoaPods projects build from the workspace; Swift Package Manager ones, Capacitor 8's default, from the project.
  const project = probe.exists(join(app.root, workspace)) ? ['-workspace', workspace] : ['-project', join('ios', 'App', 'App.xcodeproj')];
  const family = `TARGETED_DEVICE_FAMILY=${iosDeviceFamily(targets)}`;
  const xcode = (...args: string[]): Step => ({ kind: 'run', command: 'xcodebuild', args, cwd: app.root });
  const prepare = capPrepare(app, probe, 'ios');
  const dir = join(OUT, 'ios');
  const teamId = opts.debug ? undefined : app.config.ios?.teamId;
  if (!teamId) {
    return {
      id: 'ios', label: 'iOS simulator build', deps: ['web'], memoryGb: 4, env,
      steps: [
        ...prepare,
        xcode(...project, '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-derivedDataPath', dir, family, 'CODE_SIGNING_ALLOWED=NO', 'build'),
      ],
      output: join(dir, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app'),
    };
  }
  const archive = join(dir, 'App.xcarchive');
  const plist = join(app.root, dir, 'ExportOptions.plist');
  return {
    id: 'ios', label: 'iOS release build', deps: ['web'], memoryGb: 4, env,
    steps: [
      ...prepare,
      xcode(...project, '-scheme', 'App', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archive, `DEVELOPMENT_TEAM=${teamId}`, family, '-allowProvisioningUpdates', 'archive'),
      { kind: 'write', path: plist, content: exportOptions(teamId) },
      xcode('-exportArchive', '-archivePath', archive, '-exportOptionsPlist', plist, '-exportPath', join(dir, 'export'), '-allowProvisioningUpdates'),
    ],
    output: join(dir, 'export'),
  };
}

/** Turns picked targets into jobs, leaving out each platform this machine cannot build. */
export function planBuild(
  targets: readonly Target[],
  app: AppInfo,
  probe: Probe,
  check: (platform: Platform) => Readiness,
  opts: PlanOptions,
): BuildPlan {
  const plan: BuildPlan = { jobs: [], skipped: [] };
  const platforms = [...new Set(targets.map((t) => t.platform))];
  for (const platform of platforms) {
    const ready = check(platform);
    if (!ready.ok) {
      plan.skipped.push({ platform, problems: ready.problems });
      continue;
    }
    if (platform === 'desktop') {
      plan.jobs.push({ id: 'desktop', label: 'Desktop build', deps: [], memoryGb: 2, env: {}, steps: [npm(app, app.config.desktop)] });
      continue;
    }
    const job =
      platform === 'android'
        ? androidJob(app, probe, ready.env, opts)
        : iosJob(app, probe, ready.env, targets.filter((t) => t.platform === 'ios'), opts);
    if (Array.isArray(job)) plan.skipped.push({ platform, problems: job });
    else plan.jobs.push(job);
  }
  // Both phone platforms wrap the same web build, so it runs once, first.
  if (plan.jobs.some((j) => j.deps.includes('web'))) {
    plan.jobs.unshift({ id: 'web', label: 'Web build', deps: [], memoryGb: 1, env: {}, steps: [npm(app, app.config.web)] });
  }
  return plan;
}
