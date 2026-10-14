/**
 * The doc comments say what the code does: no count of members and no fixed duration in a TSDoc block of the published source,
 * and the methods that throw a PanelManagerError carry an `@throws` naming a code that exists and that the method really throws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './support/jsdom-globals.js';
import ts from 'typescript';
import { createWorkspace, definePanel } from '../index.js';
import { PanelManagerError } from '../panelManagerError.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sources = (): string[] => [ROOT, join(ROOT, 'panels')].flatMap((dir) => readdirSync(dir).filter((f) => /[.]tsx?$/.test(f)).sort().map((f) => join(dir, f)));

const COUNTED = 'read|members?|verbs?|operations?|settings|keys?|leaves|names?|things|exports?|methods|props|fields|codes|rules|entries|tiers|layers|handles|hooks|options|values';
const WORDS = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
/** A number word or a digit count in front of the thing it counts, and a duration written in seconds. */
const ROTTING = new RegExp(`\\b(?:${WORDS}|\\d+)\\s+(?:${COUNTED})\\b|\\b\\d+(?:\\.\\d+)?\\s?(?:s|seconds?)\\b`, 'gi');

/** The offending phrases in every TSDoc block of `files`, as `file: phrase`. */
function rotting(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const block of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) for (const hit of block[0].matchAll(ROTTING)) found.push(`${file.slice(ROOT.length)}: ${hit[0]}`);
  }
  return found;
}

test('no TSDoc block of the published source counts its members or names a fixed duration', () => {
  const files = sources();
  assert.ok(files.length > 50, 'the scan reached the published source');
  assert.deepEqual(rotting(files), []);
  const dir = mkdtempSync(join(tmpdir(), 'phonux-doc-truth-'));
  try {
    const planted = join(dir, 'Planted.ts');
    writeFileSync(planted, '/** The handle has ten read members and can be undone for 10 s. */\nexport const x = 1;\n');
    assert.equal(rotting([planted]).length, 2, 'a planted violation is found, so the scan is not blind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CODES = [...readFileSync(join(ROOT, 'panelManagerError.ts'), 'utf8').matchAll(/\|\s+'([a-z-]+)'/g)].map((m) => m[1]!);

/** The members that throw, with the codes their `@throws` must name. */
const THROWERS: readonly { file: string; owner: string; member: string; codes: readonly string[] }[] = [
  { file: 'workspaceCore.ts', owner: 'WorkspaceHandle', member: 'addPanel', codes: ['disposed', 'unknown-template', 'duplicate-template', 'instance-id-required', 'invalid-options', 'invalid-settings'] },
  { file: 'workspaceCore.ts', owner: 'WorkspaceHandle', member: 'update', codes: ['disposed', 'invalid-options'] },
  { file: 'workspaceCore.ts', owner: 'WorkspaceHandle', member: 'registerTemplate', codes: ['disposed', 'duplicate-template', 'invalid-settings'] },
  { file: 'workspaceCore.ts', owner: 'WorkspaceHandle', member: 'rename', codes: ['disposed'] },
  { file: 'panelTemplate.ts', owner: 'PanelReadHandle', member: 'getState', codes: ['invalid-options'] },
  { file: 'panelTemplate.ts', owner: 'PanelReadHandle', member: 'getSettings', codes: ['invalid-options'] },
  { file: 'panelHandles.ts', owner: 'PanelHandle', member: 'getState', codes: ['invalid-options'] },
  { file: 'panelHandles.ts', owner: 'PanelHandle', member: 'configure', codes: ['invalid-settings'] },
  { file: 'panelManager.ts', owner: 'PanelManager', member: 'configure', codes: ['invalid-settings'] },
  { file: 'panelManager.ts', owner: 'PanelManager', member: 'configureTemplate', codes: ['unknown-template', 'invalid-settings'] },
  { file: 'panelManager.ts', owner: 'PanelManager', member: 'configureTuning', codes: ['invalid-settings'] },
];

/** The text of the `@throws` tag on `owner.member`, or undefined. */
function throwsOf(file: string, owner: string, member: string): string | undefined {
  const sf = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
  let found: string | undefined;
  sf.forEachChild((node) => {
    const members = ts.isInterfaceDeclaration(node) && node.name.text === owner ? node.members : ts.isTypeAliasDeclaration(node) && node.name.text === owner && ts.isTypeLiteralNode(node.type) ? node.type.members : undefined;
    if (members === undefined) return;
    for (const m of members) {
      if (m.name === undefined || m.name.getText(sf) !== member) continue;
      for (const tag of ts.getJSDocTags(m)) if (tag.tagName.text === 'throws') found = typeof tag.comment === 'string' ? tag.comment : tag.comment?.map((c) => c.text).join('');
    }
  });
  return found;
}

test('every method that throws a PanelManagerError has an @throws naming each code it throws, and every named code exists', () => {
  assert.ok(CODES.length >= 9 && CODES.includes('invalid-options'));
  for (const { file, owner, member, codes } of THROWERS) {
    const tag = throwsOf(file, owner, member);
    assert.ok(tag !== undefined, `${owner}.${member} has an @throws`);
    for (const code of codes) assert.ok(tag.includes(`\`${code}\``), `${owner}.${member} names ${code}`);
    for (const named of tag.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) assert.ok(CODES.includes(named[1]!), `${owner}.${member} names a real code: ${named[1]}`);
  }
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof PanelManagerError ? error.code : `not a PanelManagerError: ${String(error)}`;
  }
  return undefined;
};

test('the throwing paths the @throws tags name throw those codes', () => {
  const view = (): null => null;
  const notes = definePanel({ id: 'notes', view });
  const ws = createWorkspace({ mount: false, templates: [notes] });
  assert.equal(codeOf(() => ws.addPanel('missing')), 'unknown-template');
  assert.equal(codeOf(() => ws.addPanel('notes', { id: 5 as never })), 'invalid-options');
  assert.equal(codeOf(() => ws.update({ templates: [] } as never)), 'invalid-options');
  assert.equal(codeOf(() => ws.registerTemplate({ ...notes, view: 'x' as never })), 'invalid-template');
  assert.equal(codeOf(() => ws.registerTemplate({ ...notes, view })), 'duplicate-template');
  assert.equal(codeOf(() => ws.panels.configure('notes', 5 as never)), 'invalid-settings');
  assert.equal(codeOf(() => ws.panels.configureTuning({ nope: 1 } as never)), 'invalid-settings');
  assert.equal(codeOf(() => ws.panels.configureTemplate('missing', {})), 'unknown-template');
  assert.equal(codeOf(() => ws.panels.configureTemplate('notes', 5 as never)), 'invalid-settings');
  assert.equal(codeOf(() => ws.panels.get('notes')?.getState()), undefined);
  ws.dispose();
  assert.equal(codeOf(() => ws.addPanel('notes')), 'disposed');
  assert.equal(codeOf(() => ws.rename('x')), 'disposed');
  assert.equal(codeOf(() => ws.registerTemplate(definePanel({ id: 'other', view }))), 'disposed');
  assert.equal(codeOf(() => ws.update({})), 'disposed');
});
