#!/usr/bin/env node
/**
 * The publish gate for phonux: unpacks the tarball into a throwaway app under the OS temp directory, installs the real peer
 * set from the npm registry (never a local stand-in for a peer), and checks only what npm pack shipped.
 * `npm publish --dry-run` is not a check: it exits 0 for a `private: true` manifest, because only a real publish
 * refuses it (EPRIVATE), so the manifest is asserted directly.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePhoneDir } from './phonux-paths.mjs';
import { extractReadmeBlock } from './readme-blocks.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHONE_DIR = resolvePhoneDir(REPO_ROOT);
const DIST_DIR = join(PHONE_DIR, 'dist');
const TSC_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

// Read at runtime, not copied by hand, so this can never drift from what the
// shipped package.json actually declares to a real consumer.
const srcPkg = JSON.parse(readFileSync(join(PHONE_DIR, 'package.json'), 'utf8'));
const PEERS = srcPkg.peerDependencies;

// A list that silently lost entries must not print a smaller "all passed".
const MIN_CHECKS = 10;

// npm keeps a `--from` placed before a bare `--` for itself (as npm_config_from, a spaced value forwarded as a stray
// positional); that and anything but `--from <value>` is refused, or the local dist/ would be gated in its place.
const argv = process.argv.slice(2);
const fromIndex = argv.indexOf('--from');
const FROM = fromIndex === -1 ? null : argv[fromIndex + 1];
const strayArgs = argv.filter((_arg, i) => i !== fromIndex && !(fromIndex !== -1 && i === fromIndex + 1));

// Value exports come from the committed API reports, so a name added to the barrel is checked here with no edit to this file.
function valueExportsOf(reportFile) {
  const text = readFileSync(join(PHONE_DIR, 'etc', reportFile), 'utf8');
  const declared = [...text.matchAll(/^export (?:declare )?(?:function|const|class|enum) (\w+)/gm)].map((m) => m[1]);
  // API Extractor writes a forwardRef component as a local const plus `export { X }` / `export { X as Y }`.
  const reExported = [...text.matchAll(/^export \{ (\w+)(?: as (\w+))? \}$/gm)].map((m) => m[2] ?? m[1]);
  return [...new Set([...declared, ...reExported])].sort();
}
const EXPECTED_VALUES = { phonux: valueExportsOf('phonux.api.md'), 'phonux/testing': valueExportsOf('phonux-testing.api.md'), 'phonux/testing/row': valueExportsOf('phonux-testing-row.api.md') };

const CONSUMER_TSX = `import * as React from 'react';
import { renderToString } from 'react-dom/server';
import {
  HostProvider,
  Panel,
  PanelFrame,
  PanelRow,
  Workspace,
  createWorkspace,
  definePanel,
  useHost,
  useProvidePanels,
} from 'phonux';
import { createFakeHost } from 'phonux/testing';

export const MARKER = 'phonux-smoke-marker-9f3a1c';

const smoke = definePanel({
  id: 'phonux-smoke-view',
  view: function SmokeView({ panel }) {
    const host = useHost();
    return (
      <Panel title={panel.title}>
        <PanelFrame>{\`\${MARKER} width=\${host.device.size.width}\`}</PanelFrame>
      </Panel>
    );
  },
});

const workspace = createWorkspace({ mount: false, root: smoke });

// The composition an app writes: provider -> Host -> Workspace -> PanelRow, all from the published names.
function App(): React.JSX.Element {
  const overflowContainerRef = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const fake = createFakeHost();
  const width = fake.device.size.width;
  const provided = useProvidePanels({ workspace, phoneWidth: width, containerWidth: 1200, overflowContainerRef });
  return (
    <HostProvider host={{ ...fake, panels: provided }}>
      <Workspace
        overflowContainerRef={overflowContainerRef}
        rowRef={rowRef}
        containerWidth={1200}
        rowResizeSettled
        phoneWidth={width}
        fixedColumnCount={provided.fixedViewCount}
        liveWidths={provided.liveWidths}
      >
        <PanelRow
          entries={provided.entries}
          rootId={workspace.rootId}
          workspace={workspace}
          closingIds={provided.closingIds}
          enteringViaAnchorIds={provided.enteringViaAnchorIds}
          exitRightIds={provided.exitRightIds}
          enterSideById={provided.enterSideById}
          maxLiveWidth={provided.maxLiveWidth}
        />
      </Workspace>
    </HostProvider>
  );
}

export function render(): string {
  return renderToString(<App />);
}
`;

// The row driver as a consumer's test imports it: first, before react, then a workspace rendered on the virtual clock.
const CHECK_ROW_MJS = `import { frameClock, renderWorkspace } from 'phonux/testing/row';
import { createElement } from 'react';
import { createWorkspace, definePanel } from 'phonux';
import { memoryWorkspaceStorage } from 'phonux/testing';

const storage = memoryWorkspaceStorage();
const note = definePanel({ id: 'note', view: () => createElement('i', null, 'smoke-note') });
const workspace = createWorkspace({ root: note, storage });
const before = frameClock.now();
const rendered = await renderWorkspace(workspace, { width: 900 });
const root = rendered.panel('note');
if (root === undefined) throw new Error('the driver found no slot for the root panel');
if (!root.root.textContent.includes('smoke-note')) throw new Error('the root panel did not draw its view');
await rendered.setWidth(500);
if (frameClock.now() <= before) throw new Error('the virtual clock never moved');
await rendered.dispose();
console.log('checkRow: rendered a workspace, resized it and took it away on the virtual clock');
`;

// A wrong prop type. If the .d.ts were not consulted (module unresolved, or types collapsed to any) this would not
// fail with TS2322, so a green typecheck cannot be a typecheck that never looked at phonux.
const NEGATIVE_TSX = `import * as React from 'react';
import { Workspace } from 'phonux';

export const bad = (
  <Workspace
    overflowContainerRef={{ current: null }}
    rowRef={{ current: null }}
    containerWidth="wide"
    rowResizeSettled
    phoneWidth={390}
    fixedColumnCount={1}
    liveWidths={[]}
  >
    {null}
  </Workspace>
);
`;

const CHECK_EXPORTS_MJS = `import * as row from 'phonux/testing/row';
import * as main from 'phonux';
import * as testing from 'phonux/testing';

const expected = ${JSON.stringify(EXPECTED_VALUES)};
const actual = { phonux: Object.keys(main).sort(), 'phonux/testing': Object.keys(testing).sort(), 'phonux/testing/row': Object.keys(row).sort() };
const problems = [];
for (const key of Object.keys(expected)) {
  const missing = expected[key].filter((n) => !actual[key].includes(n));
  const extra = actual[key].filter((n) => !expected[key].includes(n));
  if (missing.length) problems.push(key + ' is missing ' + missing.join(', '));
  if (extra.length) problems.push(key + ' exports unreported ' + extra.join(', '));
  if (expected[key].length === 0) problems.push(key + ': the API report listed zero value exports, so nothing was checked');
}
if (problems.length) throw new Error(problems.join('; '));
console.log('checkExports:', expected.phonux.length, 'values from phonux,', expected['phonux/testing'].length, 'from phonux/testing,', expected['phonux/testing/row'].length, 'from phonux/testing/row');
`;

const CHECK_SSR_MJS = `import { MARKER, render } from './consumer.node.mjs';
const html = render();
if (!html.includes(MARKER)) throw new Error('renderToString output is missing "' + MARKER + '". Got: ' + html.slice(0, 300));
console.log('checkSsr: Workspace + PanelRow rendered the registered view, ' + html.length + ' bytes of html');
`;

// The README's quickstart block, run as a reader copies it: it is exported for the check below, which needs the workspace it makes.
const CHECK_README_MJS = `import { workspace, notes } from './readme-quickstart.node.mjs';
if (workspace.panels.get('notes') === undefined) throw new Error('the README quickstart did not open a notes panel');
if (notes.id !== 'notes') throw new Error('the README quickstart template is not the notes template');
console.log('checkReadme: the quickstart opened its panel');
`;

const tsconfigFor = (resolution, include) => ({
  compilerOptions: {
    target: 'ES2022',
    module: resolution === 'bundler' ? 'ESNext' : 'NodeNext',
    moduleResolution: resolution === 'bundler' ? 'bundler' : 'NodeNext',
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: false,
    noEmit: true,
  },
  include,
});

let root = null;
const results = [];
let passed = 0;
let ran = 0;
let hardError = null;

function record(name, fn) {
  ran += 1;
  const started = Date.now();
  try {
    const detail = fn();
    passed += 1;
    results.push(`  ok    ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)${detail ? ` -- ${detail}` : ''}`);
  } catch (err) {
    const text = String(err.stdout?.toString?.() || err.stderr?.toString?.() || err.message || err);
    results.push(`  FAIL  ${name}: ${text.split('\n').find((l) => l.trim()) ?? text}`);
  }
}

const run = (file, args, cwd) => execFileSync(file, args, { cwd, stdio: 'pipe', encoding: 'utf8' });

try {
  if (process.env.npm_config_from !== undefined) {
    throw new Error(`npm kept a --from placed before a bare -- for itself (npm_config_from=${process.env.npm_config_from}), so it never reached this script; run \`npm run smoke -- --from <tarball path or registry spec>\``);
  }
  if (strayArgs.length > 0) {
    throw new Error(`unexpected argument "${strayArgs[0]}"; the only option is --from <tarball path or registry spec>, after a bare -- when run through npm`);
  }
  if (fromIndex !== -1 && (!FROM || FROM.startsWith('--'))) {
    throw new Error('--from needs a tarball path or a registry spec such as phonux@0.1.0');
  }
  // Without --from the smoke never rebuilds dist/: it checks whatever dist/ holds now, which may be stale against source.
  if (FROM === null && !existsSync(join(DIST_DIR, 'package.json'))) {
    throw new Error(`${relative(REPO_ROOT, join(DIST_DIR, 'package.json'))} is missing -- run \`node tools/phonux-build.mjs\` first`);
  }

  // A fixed macOS-only prefix would fail on the Linux CI runner; the printed path still makes a leftover from a
  // killed run findable. Never reused between runs.
  root = mkdtempSync(join(tmpdir(), 'phonux-smoke.'));
  console.log(`smoke:phonux: working in ${root}`);

  // npm runs with cwd = root, so a relative tarball path must be made absolute first;
  // a registry spec has no file on disk and passes through.
  const packTarget = FROM === null ? DIST_DIR : existsSync(resolve(FROM)) ? resolve(FROM) : FROM;
  console.log(`smoke:phonux: packing ${FROM ?? DIST_DIR}`);
  const packOut = run('npm', ['pack', packTarget, '--pack-destination', root, '--json'], root);
  const [packInfo] = JSON.parse(packOut);
  const tarball = join(root, packInfo.filename);
  if (!existsSync(tarball)) throw new Error(`npm pack reported ${packInfo.filename} but it is missing at ${tarball}`);
  const packedFiles = packInfo.files.map((f) => f.path);

  const appDir = join(root, 'app');
  mkdirSync(appDir);
  writeFileSync(join(appDir, 'package.json'), `${JSON.stringify({ name: 'phonux-smoke-app', private: true, type: 'module' }, null, 2)}\n`);
  writeFileSync(join(appDir, 'tsconfig.bundler.json'), `${JSON.stringify(tsconfigFor('bundler', ['consumer.tsx']), null, 2)}\n`);
  writeFileSync(join(appDir, 'tsconfig.nodenext.json'), `${JSON.stringify(tsconfigFor('nodenext', ['consumer.tsx']), null, 2)}\n`);
  writeFileSync(join(appDir, 'tsconfig.readme.json'), `${JSON.stringify(tsconfigFor('bundler', ['readme-quickstart.tsx']), null, 2)}\n`);
  writeFileSync(join(appDir, 'tsconfig.negative.json'), `${JSON.stringify(tsconfigFor('bundler', ['negative.tsx']), null, 2)}\n`);

  // Only the tarball is a local path; every peer name below resolves through the real registry.
  // esbuild is installed here, not borrowed from this repo's node_modules, where it is only a transitive dependency.
  run(
    'npm',
    [
      'install',
      tarball,
      ...Object.entries(PEERS).map(([name, range]) => `${name}@${range}`),
      '@types/react@^19.2.18',
      '@types/react-dom@^19.2.4',
      'esbuild@^0.28.1',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
    ],
    appDir,
  );

  writeFileSync(join(appDir, 'consumer.tsx'), CONSUMER_TSX);
  writeFileSync(join(appDir, 'negative.tsx'), NEGATIVE_TSX);
  writeFileSync(join(appDir, 'checkExports.mjs'), CHECK_EXPORTS_MJS);
  writeFileSync(join(appDir, 'checkSsr.mjs'), CHECK_SSR_MJS);
  writeFileSync(join(appDir, 'checkRow.mjs'), CHECK_ROW_MJS);
  const esbuild = join(appDir, 'node_modules', '.bin', 'esbuild');
  // The registry page is the packed README, so the block is read from it and not from the source tree.
  const readmeBlock = extractReadmeBlock(run('tar', ['-xOzf', tarball, 'package/README.md'], root), 'quickstart');
  writeFileSync(join(appDir, 'readme-quickstart.tsx'), `${readmeBlock}\nexport { notes, workspace };\n`);
  writeFileSync(join(appDir, 'checkReadme.mjs'), CHECK_README_MJS);

  record('(1) the packed manifest is publishable', () => {
    // The manifest inside the tarball, not dist/package.json: what a registry would receive.
    const packed = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json'], root));
    const problems = [];
    if (Object.hasOwn(packed, 'private')) problems.push(`has a 'private' key (${packed.private}); npm's real publish refuses it with EPRIVATE`);
    if (typeof packed.license !== 'string' || packed.license.trim() === '') problems.push('has no license');
    const needsText = typeof packed.license === 'string' && packed.license !== 'UNLICENSED' && !packed.license.startsWith('SEE LICENSE IN');
    if (needsText && !packedFiles.some((f) => /^LICEN[CS]E(\.|$)/i.test(f))) problems.push(`license "${packed.license}" has no LICENSE file in the tarball`);
    if (typeof packed.description !== 'string' || packed.description.trim() === '') problems.push('has no description');
    if (packed.name !== srcPkg.name || packed.version !== srcPkg.version) problems.push(`name/version ${packed.name}@${packed.version} differ from the source manifest`);
    if (packed.publishConfig?.access !== 'public') problems.push('publishConfig.access is not "public"');
    if (JSON.stringify(packed.peerDependencies) !== JSON.stringify(PEERS)) problems.push('peerDependencies differ from the source manifest');
    const keys = Object.keys(packed.exports ?? {}).sort().join(',');
    if (keys !== '.,./testing,./testing/row') problems.push(`exports keys are "${keys}", expected ". and ./testing and ./testing/row"`);
    if (problems.length) throw new Error(problems.join('; '));
    return `${packed.name}@${packed.version}, license ${packed.license}`;
  });

  record('(2) the tarball holds built files only', () => {
    const packed = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json'], root));
    const stray = packedFiles.filter((f) => (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) || /\.map$/.test(f) || /typecheck|fixture|\.config\.|^etc\/|api-extractor/i.test(f));
    if (stray.length) throw new Error(`unexpected files: ${stray.join(', ')}`);
    const missing = Object.values(packed.exports).flatMap((c) => Object.values(c)).filter((p) => !packedFiles.includes(p.replace(/^\.\//, '')));
    if (missing.length) throw new Error(`exports point at files not in the tarball: ${missing.join(', ')}`);
    for (const doc of ['README.md', 'DESIGN.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE']) if (!packedFiles.includes(doc)) throw new Error(`${doc} is not in the tarball`);
    // The packed README is the registry page: it must say how to install, and must not name this repo's
    // layout or link to a file the page cannot serve.
    const readme = run('tar', ['-xOzf', tarball, 'package/README.md'], root);
    const readmeProblems = [];
    if (!readme.includes(`npm install ${srcPkg.name}`)) readmeProblems.push(`has no "npm install ${srcPkg.name}" line`);
    const readmeBans = [
      [/client\/src\/shared\/phone/, "names this repo's source folder"],
      [/plans\//, 'names the plans folder'],
    ];
    for (const [pattern, problem] of readmeBans) if (pattern.test(readme)) readmeProblems.push(problem);
    // Every link target must be absolute: the registry page has no sibling files, so a path, a bare file name or an
    // empty target dead-ends there. Inline links, reference definitions and raw html href/src are all covered.
    const linkTargets = [
      ...[...readme.matchAll(/\]\(\s*<?([^)\s>]*)/g)].map((m) => m[1]),
      ...[...readme.matchAll(/^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*<?([^\s>]*)/gm)].map((m) => m[1]),
      ...[...readme.matchAll(/\b(?:href|src)\s*=\s*["']?([^"'\s>]*)/gi)].map((m) => m[1]),
    ];
    const badTargets = linkTargets.filter((target) => !/^(?:https?:|mailto:|#)/i.test(target));
    if (badTargets.length) readmeProblems.push(`has links the registry page cannot serve (${badTargets.map((t) => `"${t}"`).join(', ')}); only http(s):, mailto: and #anchor targets are allowed`);
    if (readmeProblems.length) throw new Error(`the packed README ${readmeProblems.join('; ')}`);
    return `${packedFiles.length} files`;
  });

  record('(3) tsc (bundler resolution, skipLibCheck false) accepts Workspace + PanelRow + useProvidePanels', () => {
    run(TSC_BIN, ['-p', 'tsconfig.bundler.json'], appDir);
  });
  record('(4) tsc (NodeNext resolution, skipLibCheck false) accepts the same', () => {
    run(TSC_BIN, ['-p', 'tsconfig.nodenext.json'], appDir);
  });
  record('(5) negative control: tsc rejects a wrong prop with TS2322', () => {
    let out = '';
    try {
      run(TSC_BIN, ['-p', 'tsconfig.negative.json'], appDir);
    } catch (err) {
      out = String(err.stdout ?? '') + String(err.stderr ?? '');
    }
    if (!out.includes('TS2322')) throw new Error(`expected TS2322, got: ${out.split('\n')[0] || 'tsc exited 0'}`);
  });
  record('(6) every reported value export is importable, and no unreported one is', () => run(process.execPath, ['checkExports.mjs'], appDir).trim());
  record('(7) Workspace + PanelRow server-render a registered view', () => {
    run(esbuild, ['consumer.tsx', '--bundle', '--format=esm', '--platform=node', '--packages=external', '--jsx=automatic', '--outfile=consumer.node.mjs', '--log-level=error'], appDir);
    return run(process.execPath, ['checkSsr.mjs'], appDir).trim();
  });
  record('(8) esbuild bundles the same consumer for a browser', () => {
    run(esbuild, ['consumer.tsx', '--bundle', '--format=esm', '--platform=browser', '--jsx=automatic', '--define:process.env.NODE_ENV="production"', '--outfile=consumer.browser.js', '--log-level=error'], appDir);
    const out = readFileSync(join(appDir, 'consumer.browser.js'), 'utf8');
    if (!out.includes('phonux-smoke-marker-9f3a1c')) throw new Error('bundle does not contain the consumer code');
    return `${out.length} bytes`;
  });
  record('(9) tsc accepts the README quickstart as written', () => {
    run(TSC_BIN, ['-p', 'tsconfig.readme.json'], appDir);
  });
  record('(10) the README quickstart runs against the tarball', () => {
    run(esbuild, ['readme-quickstart.tsx', '--bundle', '--format=esm', '--platform=node', '--packages=external', '--jsx=automatic', '--outfile=readme-quickstart.node.mjs', '--log-level=error'], appDir);
    return run(process.execPath, ['checkReadme.mjs'], appDir).trim();
  });
  record('(11) phonux/testing/row renders and resizes a workspace on its virtual clock', () => run(process.execPath, ['checkRow.mjs'], appDir).trim());
} catch (err) {
  hardError = err;
}

console.log(results.join('\n'));
console.log(`${passed}/${ran} checks passed`);

if (hardError) {
  console.error(`smoke:phonux FAILED before all checks could run: ${hardError.message ?? hardError}`);
}
if (ran < MIN_CHECKS) {
  console.error(`smoke:phonux: only ${ran} of at least ${MIN_CHECKS} checks ran; that proves nothing`);
}

if (passed === ran && ran >= MIN_CHECKS && !hardError) {
  if (root) rmSync(root, { recursive: true, force: true });
  console.log(`smoke:phonux OK -- ${root} removed`);
  process.exit(0);
} else {
  if (root) console.error(`smoke:phonux: leaving ${root} in place for inspection`);
  process.exit(1);
}
