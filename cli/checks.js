import { join } from 'node:path';
const MIN_JAVA = 21;
const MIN_XCODE = 26;
function capacitorProblems(app, probe, nativePackage) {
    const problems = [];
    for (const name of ['@capacitor/cli', '@capacitor/core', nativePackage]) {
        if (!probe.exists(join(app.root, 'node_modules', name, 'package.json'))) {
            problems.push(`${name} is not installed. Add it to your app's dependencies and run npm install.`);
        }
    }
    const configs = ['capacitor.config.ts', 'capacitor.config.json', 'capacitor.config.js'];
    if (!configs.some((name) => probe.exists(join(app.root, name)))) {
        problems.push('No capacitor.config.ts. Create one that names your app and points webDir at your web build output.');
    }
    if (!app.scripts[app.config.web]) {
        problems.push(`No "${app.config.web}" script in package.json to build the web app. Add one, or set phonux.build.web.`);
    }
    return problems;
}
function javaMajor(output) {
    const match = output?.match(/version "(\d+)(?:\.(\d+))?/);
    if (!match)
        return null;
    // Java 8 and older report "1.8".
    return match[1] === '1' ? Number(match[2]) : Number(match[1]);
}
function findJava(probe) {
    const candidates = [probe.env.JAVA_HOME ?? null];
    // Android Studio bundles a JDK, so a developer who installed only Android Studio still has one.
    if (probe.platform === 'darwin')
        candidates.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home');
    if (probe.platform === 'linux')
        candidates.push(join(probe.home, 'android-studio', 'jbr'), '/opt/android-studio/jbr');
    if (probe.platform === 'win32')
        candidates.push('C:\\Program Files\\Android\\Android Studio\\jbr');
    for (const home of candidates) {
        if (!home)
            continue;
        const bin = join(home, 'bin', probe.platform === 'win32' ? 'java.exe' : 'java');
        if (!probe.exists(bin))
            continue;
        return { home, major: javaMajor(probe.run(bin, ['-version'])) };
    }
    return { home: null, major: javaMajor(probe.run('java', ['-version'])) };
}
function findAndroidSdk(probe) {
    const candidates = [probe.env.ANDROID_HOME, probe.env.ANDROID_SDK_ROOT];
    if (probe.platform === 'darwin')
        candidates.push(join(probe.home, 'Library', 'Android', 'sdk'));
    if (probe.platform === 'linux')
        candidates.push(join(probe.home, 'Android', 'Sdk'));
    if (probe.platform === 'win32' && probe.env.LOCALAPPDATA)
        candidates.push(join(probe.env.LOCALAPPDATA, 'Android', 'Sdk'));
    return candidates.find((dir) => dir && probe.exists(join(dir, 'platform-tools'))) ?? null;
}
function androidReadiness(app, probe) {
    const problems = capacitorProblems(app, probe, '@capacitor/android');
    const env = {};
    const java = findJava(probe);
    if (java.major === null) {
        problems.push(`Android builds need Java ${MIN_JAVA} or newer, and none was found. Installing Android Studio includes one.`);
    }
    else if (java.major < MIN_JAVA) {
        problems.push(`Android builds need Java ${MIN_JAVA} or newer; this machine has Java ${java.major}. Set JAVA_HOME to a newer one, such as the one inside Android Studio.`);
    }
    else if (java.home) {
        env.JAVA_HOME = java.home;
    }
    const sdk = findAndroidSdk(probe);
    if (sdk)
        env.ANDROID_HOME = sdk;
    else
        problems.push('Android builds need the Android SDK, and none was found. Install Android Studio and open it once, or set ANDROID_HOME.');
    return { ok: problems.length === 0, problems, env };
}
function iosReadiness(app, probe) {
    if (probe.platform !== 'darwin') {
        return { ok: false, problems: ['iPhone and iPad builds need a Mac with Xcode. This machine is not a Mac.'], env: {} };
    }
    const problems = capacitorProblems(app, probe, '@capacitor/ios');
    const version = probe.run('xcodebuild', ['-version'])?.match(/Xcode (\d+)/);
    if (!version) {
        problems.push(`iPhone and iPad builds need Xcode ${MIN_XCODE} or newer from the App Store. If it is installed, open it once to finish setup.`);
    }
    else if (Number(version[1]) < MIN_XCODE) {
        problems.push(`iPhone and iPad builds need Xcode ${MIN_XCODE} or newer; this Mac has Xcode ${version[1]}. Update it from the App Store.`);
    }
    return { ok: problems.length === 0, problems, env: {} };
}
function desktopReadiness(app) {
    const script = app.config.desktop;
    const problems = app.scripts[script] ? [] : [`No "${script}" script in package.json to build the desktop app. Add one, or set phonux.build.desktop.`];
    return { ok: problems.length === 0, problems, env: {} };
}
/** Checks whether this machine can build `platform` for the app. */
export function checkPlatform(platform, app, probe) {
    if (platform === 'android')
        return androidReadiness(app, probe);
    if (platform === 'ios')
        return iosReadiness(app, probe);
    return desktopReadiness(app);
}
