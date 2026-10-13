/**
 * What a module of the workspace path holds outside any workspace: a Map, a Set or a `let` at module level in a file
 * the mount touches. Every one is listed here and explained in DESIGN.md, "Two layers"; none holds a workspace's own data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every module-level `let`, and every module-level binding made with `new Map/Set/WeakMap/WeakSet`, as `file:name`. */
const FILES = ['autoMount.tsx', 'autoMountContext.ts', 'workspaceCore.ts', 'viewRegistry.tsx', 'templateView.tsx', 'panelFrameBoundary.tsx', 'hostApi.tsx', 'PanelRow.tsx', 'Workspace.tsx', 'panels/useProvidePanels.ts', 'panels/useWorkspacePersistence.ts', 'index.ts'];

const ALLOWED: Record<string, string> = {
  'workspaceCore.ts:nextEngineIdValue': 'an id counter: ids stay unique across workspaces on purpose',
  'workspaceCore.ts:CORES': 'a WeakMap from a handle to its own core: it holds no state of its own',
  'viewRegistry.tsx:registry': 'plain views by key: registerView is an app-wide call and a plain view is no workspace\'s data',
  'viewRegistry.tsx:placeholders': 'one placeholder component per unregistered key',
  'templateView.tsx:adapters': 'a WeakMap keyed by template object: one adapter component per template, the template itself holds the workspace\'s view',
  'panelFrameBoundary.tsx:BARE_TEMPLATES': 'a WeakMap from a template object to whether its view was last found bare: it says how to draw the template, never a workspace\'s data',
  'PanelRow.tsx:EMPTY_SET': 'a default for an omitted prop, never written',
  'PanelRow.tsx:EMPTY_MAP': 'a default for an omitted prop, never written',
};

function moduleState(file: string): string[] {
  const out: string[] = [];
  for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
    const lets = /^let (\w+)/.exec(line);
    if (lets) out.push(`${file}:${lets[1]}`);
    const made = /^(?:export )?const (\w+)\b[^=]*=\s*new (?:Weak)?(?:Map|Set)\b/.exec(line);
    if (made) out.push(`${file}:${made[1]}`);
  }
  return out;
}

test('the files the mount touches hold exactly the module-level Maps, Sets and lets this test lists', () => {
  const found = FILES.flatMap(moduleState).sort();
  assert.deepEqual(found, Object.keys(ALLOWED).sort());
});

test('DESIGN.md names every one of them and says why it holds no workspace\'s data', () => {
  const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');
  const start = design.indexOf('## Two layers');
  assert.ok(start >= 0, 'DESIGN.md has no "Two layers" section');
  const next = design.indexOf('\n## ', start + 1);
  const section = design.slice(start, next < 0 ? undefined : next);
  for (const key of Object.keys(ALLOWED)) {
    const name = key.split(':')[1]!;
    assert.ok(section.includes(`\`${name}\``), `DESIGN.md "Two layers" does not explain ${key}`);
  }
});

test('no module-level template map is left: a template is held by the workspace that registered it', () => {
  const registry = readFileSync(join(ROOT, 'viewRegistry.tsx'), 'utf8');
  assert.doesNotMatch(registry, /new Map<string, PanelTemplate>/);
  assert.doesNotMatch(registry, /export (?:const|function) (?:getTemplate|listTemplates|registerTemplate)\b/);
});
