/**
 * The core store modules (the plain stores the provider hooks read through useSyncExternalStore) import no React, no
 * react-dom and no motion, and touch no document or window. A store test then runs without a DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CORE = ['panels/panelList.ts', 'panels/operationGate.ts', 'panels/rowSettle.ts', 'panels/restWatch.ts'];
const BANNED_IMPORT = /^\s*(?:import|export)\b[^'"]*from\s+['"](react|react-dom|motion)(?:\/[^'"]*)?['"]/m;
const BANNED_GLOBAL = /\b(document|window)\./;

test('the core store modules import no React, react-dom or motion, and touch no document or window', () => {
  for (const file of CORE) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, BANNED_IMPORT, `${file} imports React, react-dom or motion`);
    assert.doesNotMatch(source, BANNED_GLOBAL, `${file} reads document or window`);
  }
});

test('the guard catches a planted React import and a planted window read', () => {
  assert.match("import { useState } from 'react';\nexport const x = 1;", BANNED_IMPORT);
  assert.match("import type { X } from 'react-dom/client';", BANNED_IMPORT);
  assert.match("export const y = window.innerWidth;", BANNED_GLOBAL);
  assert.doesNotMatch("import { createPanelList } from './panelList.js';", BANNED_IMPORT);
});
