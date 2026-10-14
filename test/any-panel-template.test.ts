/**
 * The type-level pins of any-panel-template.typecheck.ts, run under the test runner so a mutant of the signatures turns a named test red:
 * the file must compile with no diagnostic, which includes its `@ts-expect-error` lines still being needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('typed templates compile into a workspace, a column, a registration and the hook, and addPanel still checks params', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const file = `${root}test/any-panel-template.typecheck.ts`;
  const program = ts.createProgram([file], { ...parsed.options, noEmit: true, skipLibCheck: true });
  const problems = ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  assert.deepEqual(problems, []);
});
