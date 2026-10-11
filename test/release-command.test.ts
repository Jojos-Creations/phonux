/**
 * The release candidate's publish text and its recorded base. publishCommand is pure, so the table below runs it
 * directly; the control feeds the same table a copy with the tag rule removed and demands that it fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PublishCommand = (version: string, distDir: string) => string;

const PUBLISH_FILE = fileURLToPath(new URL('../tools/phonux-publish-command.mjs', import.meta.url));
const DESIGN = readFileSync(fileURLToPath(new URL('../DESIGN.md', import.meta.url)), 'utf8');

const ROWS: ReadonlyArray<readonly [version: string, tagged: boolean]> = [
  ['0.2.0-rc.1', true],
  ['1.0.0-beta.2', true],
  ['0.2.0', false],
  ['0.1.1', false],
];

async function load(file: string): Promise<PublishCommand> {
  const mod = (await import(`${new URL(`file://${file}`).href}?load=${Math.random()}`)) as { publishCommand: PublishCommand };
  return mod.publishCommand;
}

/** The rows whose printed text disagrees with the tag rule; empty when `publishCommand` follows it. */
function tableProblems(publishCommand: PublishCommand): string[] {
  return ROWS.flatMap(([version, tagged]) => {
    const text = publishCommand(version, 'dist');
    const problems: string[] = [];
    if (text.includes('--tag next') !== tagged) problems.push(`${version}: ${tagged ? 'missing' : 'unexpected'} --tag next in '${text}'`);
    if (!text.includes('npm publish')) problems.push(`${version}: no npm publish in '${text}'`);
    return problems;
  });
}

for (const [version, tagged] of ROWS) {
  test(`publishCommand: ${version} ${tagged ? 'carries' : 'does not carry'} --tag next`, async () => {
    const text = (await load(PUBLISH_FILE))(version, 'dist');
    assert.equal(text.includes('--tag next'), tagged, text);
    assert.match(text, /^cd dist && npm publish/);
  });
}

test('publishCommand: a scratch copy with --tag next removed fails the table', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-publish-'));
  try {
    const source = readFileSync(PUBLISH_FILE, 'utf8');
    const edited = source.replace(" --tag next", '');
    assert.notEqual(edited, source, 'the planted edit must change the text');
    const copy = join(scratch, 'phonux-publish-command.mjs');
    writeFileSync(copy, edited);
    assert.deepEqual(tableProblems(await load(PUBLISH_FILE)), []);
    assert.notDeepEqual(tableProblems(await load(copy)), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('publishCommand: the file starts no process', () => {
  assert.doesNotMatch(readFileSync(PUBLISH_FILE, 'utf8'), /child_process|spawn|execFile|exec\(/);
});

test('DESIGN.md records the release candidate base: one 40-character commit line, and that no real browser measured the tree', () => {
  const at = DESIGN.indexOf('### Release candidate base');
  assert.ok(at >= 0, 'DESIGN.md has the Release candidate base heading');
  const section = DESIGN.slice(at, DESIGN.indexOf('\n#', at + 1) === -1 ? undefined : DESIGN.indexOf('\n#', at + 1));
  assert.equal(section.match(/^base: [0-9a-f]{40}$/gm)?.length, 1, 'exactly one base line');
  assert.match(section, /no real browser/i);
});

test('release:check prints the command through publishCommand, with no second copy of the text', () => {
  const check = readFileSync(fileURLToPath(new URL('../tools/phonux-release-check.mjs', import.meta.url)), 'utf8');
  assert.match(check, /publishCommand\(version, distDir\)/);
  assert.equal(check.split('npm publish').length - 1, 0);
});
