import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
/** Reads the app's package.json from `root`. */
export function readApp(root) {
    const pkgPath = join(root, 'package.json');
    if (!existsSync(pkgPath))
        throw new Error(`No package.json in ${root}. Run phonux build from your app's folder.`);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const raw = pkg.phonux?.build ?? {};
    return {
        root,
        scripts: pkg.scripts ?? {},
        config: { web: raw.web ?? 'build:web', desktop: raw.desktop ?? 'build:desktop', android: raw.android, ios: raw.ios },
    };
}
// Under the build folder, so a clean of build output also forgets the selection.
function selectionPath(root) {
    return join(root, '.phonux', 'build', 'targets.json');
}
/** The targets picked last time, or none. */
export function readSelection(root) {
    try {
        const ids = JSON.parse(readFileSync(selectionPath(root), 'utf8'));
        return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    }
    catch {
        return [];
    }
}
/** Remembers the picked targets for the next run. */
export function writeSelection(root, ids) {
    const path = selectionPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(ids)}\n`);
}
