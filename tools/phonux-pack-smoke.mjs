#!/usr/bin/env node
/**
 * Proves the packed phonux tarball is consumable OUTSIDE this repo: unpacks
 * it into a throwaway app under /private/tmp, installs the real peer set
 * from the npm registry (never a local file:/link: substitute for a peer),
 * and runs three independent checks against only what npm pack shipped.
 *
 * Usage: node tools/phonux-pack-smoke.mjs   (or: npm run smoke:phonux)
 *
 * Requires `npm run build:phonux` to have already produced dist/ -- this
 * script never rebuilds it, so a run here checks whatever dist/ currently
 * holds, not source.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST_DIR = join(REPO_ROOT, 'client/src/shared/phone/dist');
const TSC_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

// Must match client/src/shared/phone/package.json's peerDependencies exactly;
// drift here would let this script silently install a different range than
// what the shipped package.json actually declares to a real consumer.
const PEERS = {
  react: '^19.2.8',
  'react-dom': '^19.2.8',
  '@mui/material': '^9.3.1',
  '@mui/icons-material': '^9.3.1',
  '@emotion/react': '^11.14.0',
  '@emotion/styled': '^11.14.1',
  motion: '^13.3.0',
};

const CHECK_TYPES_TSX = `import * as React from 'react';
import { Panel, PanelFrame, useHost, HostProvider, registerView, type ViewProps } from 'phonux';

function SmokeView({ panel }: ViewProps): React.JSX.Element {
  const host = useHost();
  return (
    <Panel title={panel.title}>
      <PanelFrame>{host.device.size.width}</PanelFrame>
    </Panel>
  );
}

registerView('phonux-smoke-view', SmokeView);

// HostProvider's prop renamed from 'apis' to 'host' -- a regression here only shows up as a type error.
function _typeSanity(host: Parameters<typeof HostProvider>[0]['host']): number {
  return host.panels.panelList.length;
}
void _typeSanity;
`;

const CHECK_IMPORT_MJS = `import * as phonux from 'phonux';

const required = ['Panel', 'PanelFrame', 'useHost', 'HostProvider', 'registerView'];
const missing = required.filter((name) => typeof phonux[name] !== 'function');
if (missing.length > 0) {
  throw new Error(\`ESM import of phonux resolved but is missing: \${missing.join(', ')}\`);
}
console.log('checkImport: phonux ESM import resolved with all expected exports');
`;

const CHECK_RENDER_MJS = `import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Panel, PanelFrame, HostProvider, useHost } from 'phonux';
import { createFakeHost } from 'phonux/testing';

const MARKER = 'phonux-smoke-marker-9f3a1c';

function SmokeView({ panel }) {
  const host = useHost();
  return React.createElement(
    Panel,
    { title: panel.title },
    React.createElement(PanelFrame, null, \`width=\${host.device.size.width}\`),
  );
}

const panel = { id: 'smoke', url: 'about:blank', title: MARKER, live: true, locked: false };

const html = renderToString(
  React.createElement(HostProvider, { host: createFakeHost() }, React.createElement(SmokeView, { panel })),
);

if (!html.includes(MARKER)) {
  throw new Error(\`renderToString output is missing "\${MARKER}". Got: \${html.slice(0, 300)}\`);
}
console.log("checkRender: renderToString produced the View's text inside HostProvider");
`;

let root = null;
let checksPassed = 0;
const results = [];
let hardError = null;

function record(name, fn) {
  try {
    fn();
    checksPassed += 1;
    results.push(`  ok    ${name}`);
  } catch (err) {
    results.push(`  FAIL  ${name}: ${String(err.message ?? err).split('\n')[0]}`);
  }
}

try {
  if (!existsSync(join(DIST_DIR, 'package.json'))) {
    throw new Error('client/src/shared/phone/dist/package.json is missing -- run `npm run build:phonux` first');
  }

  // Bare mktemp under $TMPDIR would work too, but this script's own gate greps
  // for a fixed /private/tmp prefix so a leftover directory from a killed run
  // is always findable by path alone; never reused between runs.
  root = mkdtempSync('/private/tmp/phonux-smoke.');
  console.log(`smoke:phonux: working in ${root}`);

  const packOut = execFileSync('npm', ['pack', DIST_DIR, '--pack-destination', root, '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const [packInfo] = JSON.parse(packOut);
  const tarball = join(root, packInfo.filename);
  if (!existsSync(tarball)) {
    throw new Error(`npm pack reported ${packInfo.filename} but it is missing at ${tarball}`);
  }

  const appDir = join(root, 'app');
  mkdirSync(appDir);
  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'phonux-smoke-app', private: true, type: 'module' }, null, 2)}\n`,
  );
  writeFileSync(
    join(appDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['checkTypes.tsx'],
      },
      null,
      2,
    )}\n`,
  );

  // Only the tarball is a local path; every peer name below resolves through
  // the real registry -- no file:/link: spec for any of the 7.
  const installArgs = [
    'install',
    tarball,
    ...Object.entries(PEERS).map(([name, range]) => `${name}@${range}`),
    '@types/react@^19.2.18',
    '@types/react-dom@^19.2.4',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
  ];
  execFileSync('npm', installArgs, { cwd: appDir, stdio: 'inherit' });

  writeFileSync(join(appDir, 'checkTypes.tsx'), CHECK_TYPES_TSX);
  writeFileSync(join(appDir, 'checkImport.mjs'), CHECK_IMPORT_MJS);
  writeFileSync(join(appDir, 'checkRender.mjs'), CHECK_RENDER_MJS);

  record('(1) tsc type-checks a View against the shipped .d.ts', () => {
    execFileSync(TSC_BIN, ['-p', 'tsconfig.json'], { cwd: appDir, stdio: 'pipe' });
  });
  record('(2) an ESM import of phonux resolves', () => {
    execFileSync(process.execPath, ['checkImport.mjs'], { cwd: appDir, stdio: 'pipe' });
  });
  record('(3) renderToString renders the View inside HostProvider', () => {
    execFileSync(process.execPath, ['checkRender.mjs'], { cwd: appDir, stdio: 'pipe' });
  });
} catch (err) {
  hardError = err;
}

console.log(results.join('\n'));
console.log(`${checksPassed}/3 checks passed`);

if (hardError) {
  console.error(`smoke:phonux FAILED before all 3 checks could run: ${hardError.message ?? hardError}`);
}

if (checksPassed === 3 && !hardError) {
  if (root) rmSync(root, { recursive: true, force: true });
  console.log(`smoke:phonux OK -- ${root} removed`);
  process.exit(0);
} else {
  if (root) console.error(`smoke:phonux: leaving ${root} in place for inspection`);
  process.exit(1);
}
