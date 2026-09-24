/**
 * Boundary scanner: the engine behind the phone-boundary tests. It answers one
 * question about a set of source files: does any of them use something it
 * must not?
 *
 *   scanBoundary({ files, roots, rules, importRules, minFiles }) -> { scannedFiles, violations }
 *
 * Our own views are written as if a third party wrote them: they reach the
 * app only through the public API surface, so they may not touch the IPC
 * bridge, `window.simplebrowser` or `localStorage`, and the UX-system folder
 * may not import the app. This file proves nothing about any particular tree;
 * test/phone-boundary.test.ts points it at the real one.
 *
 * Four decisions are load-bearing, and each exists because a check that
 * silently does nothing reports the same green as a check that passed.
 *
 * 1. COMMENTS ARE EXEMPT FROM THE VIEW RULES, NOTHING ELSE IS; THE HOST RULES
 *    ARE A LITERAL GREP.
 *    A comment that names `bridge()` or `localStorage` is documentation (the
 *    view files carry many, e.g. a JSDoc that says which bridge call an API
 *    replaces), so a raw grep would fail the tree over words while telling us
 *    nothing about code. But every non-comment token IS scanned, string
 *    literals, template text and JSX text included: module specifiers
 *    (`from '../ipc/bridge.js'`) and bracket access (`window['localStorage']`)
 *    live in string literals, so exempting strings would exempt the exact
 *    thing the boundary is about. The cost is that a view which prints the
 *    word "localStorage" at the user must reword it; that is cheap and safe.
 *    Comments are located by PARSING (the TypeScript compiler API), never by
 *    regex or a hand-rolled lexer: a lexer that mis-tracks an apostrophe in
 *    JSX text or a `//` inside a string blanks real code, and blanked code is
 *    a false green. See stripComments for how, and the self-tests for the
 *    lookalikes it survives.
 *    A rule says which reading it wants (`scope`). 'code' (the default, every
 *    view rule) matches the source with its comments blanked. 'text' matches
 *    the file exactly as written, comments included, which is what `grep`
 *    does. The host rules are 'text' because their acceptance check IS a grep
 *    (the host's own acceptance check: `grep 'bridge\|localStorage\|useEffect\|useRef'`
 *    over GoalFrontPage.tsx returns nothing): a test that stayed green on a
 *    file that grep fails would report a pass the acceptance check does not give.
 *    This is a DELIBERATE relaxation for the host too, same as the view
 *    rules and for the same reason (a check that goes red on prose tells us
 *    nothing about code) -- it is not an oversight, and it is the opposite of
 *    understating the host rule's strictness: 'text' scope is what makes the
 *    host rule read comments too (the view rules, scope 'code', do not). The
 *    cost is that the host may not even mention those words in a comment; it
 *    is about 110-150 lines, so rewording is cheap.
 *
 * 2. THERE IS NO ALLOWLIST, AND THE SCANNER CANNOT BE GIVEN ONE.
 *    The spec has no option that excuses a file, a line or a match, and an
 *    option it does not recognise (a typo, or someone adding an escape hatch
 *    at the call site) is a hard error rather than something quietly ignored.
 *    An in-source pragma comment cannot excuse a violation either, because
 *    comments are simply not read. A boundary with a way out is a suggestion.
 *    (`scope` only chooses what a rule reads; it can make a rule see more or
 *    different text, never excuse anything.)
 *
 * 3. A SCAN THAT COVERED TOO LITTLE FAILS.
 *    `minFiles` is required (no default) and must be at least 1. Fewer files
 *    scanned than that floor throws, as does a listed file that does not
 *    exist, a root that does not exist, a root that contains no source files,
 *    a symbolic link under a root (its target would go unscanned), and an
 *    import rule whose forbidden directory does not exist (it could never
 *    match). A path typo, a moved directory or a wrong extension therefore
 *    turns the test red instead of turning it into "0 violations in 0 files".
 *
 * 4. THE TO-DO LIST IS COMPLETE.
 *    Every match of every rule in every file is reported, each with its own
 *    line and column, not the first one per rule or per file: a red run is the
 *    whole list of what to fix, and fixing the first line must not reveal a
 *    second red run for the same rule. (Proven directly in
 *    test/phone-boundary-scanner.test.ts: two `bridge()` calls in one file
 *    produce two violations, not one, and a mutant that reports only the
 *    first match per rule/file turns exactly that test red.)
 *
 * Two spellings that text matching cannot see are handled here, because they
 * are cheap to handle honestly. An identifier written with an escape
 * (`window.\u{73}implebrowser`) is refused outright (rule 'escaped-identifier'):
 * nobody has a reason to spell a name that way in a view. A string or template
 * chunk whose DECODED value matches a 'code' rule that its raw text does not
 * (`window['simple\x62rowser']`) is reported under that rule.
 *
 * LIMITS, stated so nobody trusts this further than it goes. Each item below is
 * pinned by a "documented limit" fixture in test/phone-boundary-scanner.test.ts,
 * so a limit that stops being true turns a test red and gets this list edited,
 * instead of going stale.
 *  - Computed names cannot be matched by text: `window[name]`, `window['simple'
 *    + 'browser']`, template substitutions, `[...].join('')`, `Reflect.get`.
 *    The escape handling above covers ONE literal at a time, not a name
 *    assembled from several, so `window['simple\x62rowser']` (a single
 *    literal, one escape) IS caught -- it is the multi-literal/computed forms
 *    that are not.
 *  - The 'bridge()' rule matches the call shapes `bridge(`, `bridge?.(`,
 *    `bridge!(`, `bridge<T>(`, `(0, bridge)(` and `(bridge)(` -- the optional
 *    call and the comma/indirect call included, specifically because both are
 *    plausible ways to dodge a naive `bridge(` match. It does not match
 *    `bridge.call(...)`, `bridge.apply(...)` or an alias (`const b = bridge;
 *    b()`); those need the name to reach the file, and importing the bridge
 *    module itself is caught by 'ipc/bridge', so the gap is a re-export of it
 *    under another module name plus deliberate obfuscation.
 *  - Ambient channels the host acceptance spec does not name are not matched:
 *    `indexedDB`, `document.cookie`, `cookieStore`, `caches`,
 *    `navigator.storage`, and a bare `import 'electron'` (a bare specifier is a
 *    package, not a path into the app). Adding one is a one-line rule and a
 *    decision about the boundary, so it needs an owner decision.
 *  - `import.meta.glob` (and `globEager`) IS matched as a rule ('import.meta.glob'
 *    below), any spacing or comments between the tokens, specifically because a
 *    glob pulls in a directory whose members text cannot list -- e.g.
 *    `import.meta.glob('../../desktop/*.ts')` from the UX-system folder is the
 *    plausible accident this rule exists to catch. What it does NOT see:
 *    `import.meta['glob']`, `(import.meta as any).glob(...)` and
 *    `const { glob } = import.meta`, because those need the property name to
 *    reach the file the same way an aliased `bridge` does.
 *  - Import rules see RELATIVE specifiers, `require()`, `import()`, import
 *    types, `export ... from`, `import x = require()` and `new URL(literal,
 *    import.meta.url)` (a non-literal first argument is refused as
 *    unverifiable, and a wrong-case path IS caught -- see the next bullet).
 *    They also follow a BARE specifier that resolves into `node_modules`
 *    (walked up from the importing file the way Node does, then realpathed):
 *    a workspace symlink reaches the app exactly as a relative path would, so
 *    it cannot stay unfollowed; one that resolves to nothing, or to an
 *    ordinary package elsewhere in `node_modules`, is unaffected either way.
 *    Not followed: a triple-slash `/// <reference path>` directive (a
 *    comment), `createRequire(...)` or
 *    another name for `require`, `import.meta.resolve`, `new Worker('path')`
 *    (only the `new URL(..., import.meta.url)` form a Worker source is
 *    usually built from is checked), or assets referenced from CSS or HTML.
 *  - Path comparison lower-cases both sides (ASCII), so a wrong-case path
 *    (`../../Desktop/x.js`, `../../DESKTOP/x.js`) IS caught, matching what a
 *    disk that ignores case (macOS, Windows) would actually resolve. Unicode
 *    normalisation differences, which APFS also ignores, are not handled.
 *  - The scanner checks words and named directories, not REACH: it reads the
 *    files it is given and does not follow their imports, so a view that
 *    imports an app helper which itself calls the bridge stays green as long
 *    as only the view is listed (and test/phone-boundary.test.ts gives import
 *    rules to the UX-system folder only). Words only for now -- no
 *    import-graph/allowlist analysis; revisit once the UX system splits into
 *    its own package. Nothing here builds toward that in the meantime.
 *  - The host rules are the acceptance grep's own tokens plus useLayoutEffect,
 *    matched as the grep matches: case-sensitive substrings (not words --
 *    `bridgeHelper` and `getbridge` both match, proven in the self-tests),
 *    escapes not decoded.
 *    Refs and effects spelled any other way (`createRef`, a callback
 *    `ref={fn}`, `useImperativeHandle`, `useInsertionEffect`) are not matched,
 *    because the grep does not match them either. A different CASE is also not
 *    matched (`useBridgeThing`, `UseRef`): the grep is case-sensitive and the
 *    scanner deliberately agrees with it exactly (a differential self-test
 *    runs the real `grep` on the same fixtures) rather than being stricter
 *    than the acceptance check it stands in for.
 *  - Only files with a source extension are read (.ts .tsx .mts .cts .js .jsx
 *    .mjs .cjs); .vue, .json, .css, .html and the like are never scanned.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/** What a text rule reads: the source with every comment blanked ('code', the default) or the file as written ('text', a literal grep). */
export type RuleScope = 'code' | 'text';

/**
 * A text rule: `pattern` is matched against a file's source. With the default
 * scope every comment is blanked out first and decoded string escapes are
 * checked as well (see the header); with scope 'text' the raw file is matched,
 * comments included, exactly as `grep` would read it.
 */
export interface TextRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly scope?: RuleScope;
}

/** An import rule: no relative import in a scanned file may resolve into `forbiddenDir` (an absolute path). */
export interface ImportRule {
  readonly name: string;
  readonly forbiddenDir: string;
}

export interface ScanSpec {
  /** Explicit files (absolute paths). Every one must exist. */
  readonly files?: readonly string[];
  /** Directories (absolute paths) walked recursively for source files. Every one must exist and contain at least one. */
  readonly roots?: readonly string[];
  readonly rules?: readonly TextRule[];
  readonly importRules?: readonly ImportRule[];
  /** The fewest files this scan may cover. Required, an integer >= 1. */
  readonly minFiles: number;
}

export interface Violation {
  /** Absolute path. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  readonly rule: string;
  /** The offending line of the ORIGINAL file, trimmed. */
  readonly snippet: string;
}

export interface ScanReport {
  /** Absolute paths of every file actually read, sorted. `scannedFiles.length` is the "how many did it scan" count. */
  readonly scannedFiles: readonly string[];
  /** Sorted by file, line, column, rule. */
  readonly violations: readonly Violation[];
}

/**
 * Thrown when a scan cannot be trusted: a bad spec, a missing file or root, an
 * empty root, or fewer files scanned than `minFiles`. `report` carries whatever
 * the files that WERE scanned contained (null for a bad spec), and the message
 * includes those violations so one red run still shows the whole to-do list.
 */
export class BoundaryScanError extends Error {
  declare readonly problems: readonly string[];
  declare readonly report: ScanReport | null;

  constructor(problems: readonly string[], report: ScanReport | null) {
    const lines = [`boundary scan is not trustworthy (${problems.length} problem(s)):`, ...problems.map((p) => `  - ${p}`)];
    if (report && report.violations.length > 0) {
      lines.push(
        `violations in the ${report.scannedFiles.length} file(s) that were scanned (${report.violations.length}):`,
        ...formatViolations(report.violations, process.cwd()).map((v) => `  ${v}`),
      );
    }
    super(lines.join('\n'));
    this.name = 'BoundaryScanError';
    // Non-enumerable: the test runner dumps every enumerable property of a failed error, and the report is long.
    Object.defineProperties(this, { problems: { value: problems }, report: { value: report } });
  }
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const SPEC_KEYS = ['files', 'roots', 'rules', 'importRules', 'minFiles'];
const TEXT_RULE_KEYS = ['name', 'pattern', 'scope'];
const IMPORT_RULE_KEYS = ['name', 'forbiddenDir'];

/**
 * Scans the listed files and the source files under the listed roots. Returns
 * the violations and the files scanned, or throws BoundaryScanError if the scan
 * itself cannot be trusted (see the header). A return value with an empty
 * `violations` is therefore a real green: at least `minFiles` files were read.
 */
export function scanBoundary(spec: ScanSpec): ScanReport {
  const specProblems = validateSpec(spec);
  if (specProblems.length > 0) throw new BoundaryScanError(specProblems, null);

  const problems: string[] = [];
  for (const rule of spec.importRules ?? []) {
    if (!isDirectory(rule.forbiddenDir)) {
      problems.push(`import rule "${rule.name}" forbids a directory that does not exist, so it could never match: ${rule.forbiddenDir}`);
    }
  }
  const collected = new Set<string>();
  for (const file of spec.files ?? []) {
    const problem = fileProblem(file);
    if (problem) problems.push(problem);
    else collected.add(file);
  }
  for (const root of spec.roots ?? []) {
    for (const file of walkRoot(root, problems)) collected.add(file);
  }

  const scannedFiles = [...collected].sort();
  const violations = scannedFiles.flatMap((file) => scanFile(file, spec)).sort(byLocation);
  if (scannedFiles.length < spec.minFiles) {
    problems.push(
      `scanned ${scannedFiles.length} file(s), fewer than the required minimum of ${spec.minFiles}: a scan that covered fewer files than expected proves nothing`,
    );
  }
  const report: ScanReport = { scannedFiles, violations };
  if (problems.length > 0) throw new BoundaryScanError(problems, report);
  return report;
}

/** One line per violation: `relative/path.tsx:12:5  rule  offending line`. */
export function formatViolations(violations: readonly Violation[], baseDir: string): string[] {
  return violations.map((v) => `${relative(baseDir, v.file)}:${v.line}:${v.column}  ${v.rule}  ${v.snippet}`);
}

/**
 * Returns `text` with every comment replaced by spaces (newlines kept, so a
 * position in the result is the same line and column in the original).
 *
 * Comments are the trivia between tokens. Rather than guess where a comment
 * starts, this parses the file, visits every token (punctuation included, via
 * getChildren) and asks the compiler for the comments sitting before and after
 * each one. Three things need care, and each is covered by a self-test:
 *  - JSX text is not trivia. `<a>// hi</a>` has no comment in it, and the
 *    compiler cannot tell from the position alone, so any candidate that
 *    starts inside a JsxText node is dropped.
 *  - JSDoc nodes live INSIDE comments. Visiting them yields candidate
 *    "comments" that start inside the real one and run past its end (a
 *    `{@link X}` followed by `//` inside a JSDoc gives a candidate that runs to
 *    the end of the line, over the code after the JSDoc's closing delimiter).
 *    A candidate that starts inside a comment already found is part of it, so
 *    it is dropped, not clipped.
 *  - Strings, regex literals and template text are single tokens, so a `//`
 *    or a quote inside one can never open or close a comment.
 */
export function stripComments(text: string, fileName: string): string {
  return blankComments(parse(text, fileName));
}

function parse(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

function blankComments(sf: ts.SourceFile): string {
  const text = sf.text;
  const found = new Map<number, number>();
  const jsxText: Array<readonly [number, number]> = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxText.push([node.pos, node.end]);
      return;
    }
    for (const c of ts.getLeadingCommentRanges(text, node.pos) ?? []) found.set(c.pos, c.end);
    for (const c of ts.getTrailingCommentRanges(text, node.end) ?? []) found.set(c.pos, c.end);
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);

  const ranges = [...found].filter(([pos]) => !jsxText.some(([from, to]) => pos >= from && pos < to)).sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [pos, end] of ranges) {
    if (pos < cursor) continue; // starts inside a comment already blanked: part of it (see stripComments)
    out += text.slice(cursor, pos) + text.slice(pos, end).replace(/[^\r\n]/g, ' ');
    cursor = end;
  }
  return out + text.slice(cursor);
}

function scanFile(file: string, spec: ScanSpec): Violation[] {
  const text = readFileSync(file, 'utf8');
  const sf = parse(text, file);
  const code = blankComments(sf);
  const lineStarts = sf.getLineStarts();
  const out: Violation[] = [];
  const at = (pos: number, rule: string): Violation => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos);
    const from = lineStarts[line] ?? 0;
    const to = lineStarts[line + 1] ?? text.length;
    return { file, line: line + 1, column: character + 1, rule, snippet: text.slice(from, to).trim().slice(0, 160) };
  };

  const rules = spec.rules ?? [];
  for (const rule of rules) {
    const haystack = rule.scope === 'text' ? text : code;
    // globalOf + matchAll: EVERY match is reported, not just the first (header decision 4).
    for (const match of haystack.matchAll(globalOf(rule.pattern))) out.push(at(match.index ?? 0, rule.name));
  }
  const codeRules = rules.filter((rule) => rule.scope !== 'text');
  if (codeRules.length > 0) out.push(...escapeViolations(sf, codeRules, at));

  const importRules = spec.importRules ?? [];
  if (importRules.length > 0) {
    for (const site of importSites(sf)) {
      if (site.specifier === null) {
        out.push(at(site.pos, 'unverifiable-import'));
        continue;
      }
      const target =
        site.specifier.startsWith('.') || isAbsolute(site.specifier)
          ? resolve(dirname(file), site.specifier)
          : resolveBareSpecifier(dirname(file), site.specifier);
      if (target === null) continue; // resolves to nothing, or to an ordinary package: not a path into the app
      for (const rule of importRules) {
        if (isInside(rule.forbiddenDir, target)) out.push(at(site.pos, rule.name));
      }
    }
  }
  return out;
}

/**
 * Node's own resolution shape for a bare specifier, stopped at the package boundary rather than
 * walked all the way to the file `exports` points at: a workspace symlink (or any other
 * `node_modules` entry) is a path into a real directory the moment it exists, so isInside only needs
 * that directory, not the subpath the specifier requests within it.
 */
function resolveBareSpecifier(fromDir: string, specifier: string): string | null {
  const match = /^(@[^/]+\/[^/]+|[^@][^/]*)(?:\/.*)?$/.exec(specifier);
  if (!match) return null;
  const packageName = match[1]!;
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', packageName);
    try {
      // statSync (not the lstatSync-based isDirectory used elsewhere): a workspace package is normally
      // ITSELF a symlink, so the existence check here must follow it rather than reject it.
      if (statSync(candidate).isDirectory()) return realpathSync(candidate);
    } catch {
      // no node_modules/<packageName> here; keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The same pattern with the global flag, so matchAll finds EVERY match (the to-do list is complete, header decision 4). */
function globalOf(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

function countMatches(pattern: RegExp, text: string): number {
  return [...text.matchAll(globalOf(pattern))].length;
}

/**
 * The two spellings text matching cannot see (header): an identifier written
 * with an escape sequence, refused under the rule name 'escaped-identifier';
 * and a string or template chunk whose DECODED value matches a rule more often
 * than its raw text does (`window['simple\x62rowser']`), reported under that
 * rule once per hidden match. Raw matches are already reported by the caller,
 * so a literal that matches raw is never counted twice.
 */
function escapeViolations(sf: ts.SourceFile, rules: readonly TextRule[], at: (pos: number, rule: string) => Violation): Violation[] {
  const out: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (node.getText(sf) !== node.text) out.push(at(node.getStart(sf), 'escaped-identifier'));
    } else if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) {
      const raw = node.getText(sf);
      if (raw.includes('\\')) {
        for (const rule of rules) {
          const hidden = countMatches(rule.pattern, node.text) - countMatches(rule.pattern, raw);
          for (let i = 0; i < hidden; i++) out.push(at(node.getStart(sf), rule.name));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

interface ImportSite {
  /** The module specifier, or null when it is not a string literal and so cannot be checked. */
  readonly specifier: string | null;
  readonly pos: number;
}

/**
 * Every static import, re-export, `import x = require()`, dynamic `import()`,
 * `require()`, `import()` type and `new URL(specifier, import.meta.url)` (the
 * bundler's way to reference a module or asset relative to this file).
 */
function importSites(sf: ts.SourceFile): ImportSite[] {
  const sites: ImportSite[] = [];
  const literal = (node: ts.Node | undefined): string | null => (node && ts.isStringLiteralLike(node) ? node.text : null);
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      sites.push({ specifier: literal(node.moduleSpecifier), pos: node.moduleSpecifier.getStart(sf) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      sites.push({ specifier: literal(node.moduleReference.expression), pos: node.getStart(sf) });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      sites.push({ specifier: literal(node.arguments[0]), pos: node.getStart(sf) });
    } else if (ts.isImportTypeNode(node)) {
      sites.push({ specifier: ts.isLiteralTypeNode(node.argument) ? literal(node.argument.literal) : null, pos: node.getStart(sf) });
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      isImportMetaUrl(node.arguments?.[1])
    ) {
      sites.push({ specifier: literal(node.arguments?.[0]), pos: node.getStart(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function isImportMetaUrl(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'url' &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  );
}

/**
 * True when `target` is `dir` itself or anywhere below it (`desktop-utils` is
 * not inside `desktop`). Both sides are lower-cased: a disk that ignores case
 * (macOS, Windows) resolves `../../Desktop/x.js` to desktop/x.ts, and a string
 * comparison alone would call that a different directory.
 */
function isInside(dir: string, target: string): boolean {
  const rel = relative(dir.toLowerCase(), target.toLowerCase());
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Source files under `root`, recursively; pushes a problem for a bad root, a symbolic link, or a root with nothing in it. */
function walkRoot(root: string, problems: string[]): string[] {
  let stat;
  try {
    stat = lstatSync(root);
  } catch {
    problems.push(`root does not exist: ${root}`);
    return [];
  }
  if (!stat.isDirectory()) {
    problems.push(`root is not a directory (a symbolic link is refused too): ${root}`);
    return [];
  }
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) problems.push(`symbolic link under a scanned root (its target would go unscanned): ${path}`);
      else if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(path);
    }
  };
  visit(root);
  if (found.length === 0) problems.push(`root contains no source files: ${root}`);
  return found;
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function fileProblem(file: string): string | null {
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    return `listed file does not exist: ${file}`;
  }
  if (stat.isSymbolicLink()) return `listed file is a symbolic link (its target would go unscanned): ${file}`;
  return stat.isFile() ? null : `listed path is not a file: ${file}`;
}

function byLocation(a: Violation, b: Violation): number {
  return a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule);
}

/** Every reason the spec itself is unusable, collected together so one run shows them all. */
function validateSpec(spec: unknown): string[] {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return ['the scan spec must be an object'];
  const s = spec as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(s)) {
    if (!SPEC_KEYS.includes(key)) {
      problems.push(`unrecognised scan option "${key}" (this scanner cannot be told to look away from a file, a line or a match)`);
    }
  }
  const floor = s.minFiles;
  if (typeof floor !== 'number' || !Number.isInteger(floor) || floor < 1) {
    problems.push(`minFiles must be an integer >= 1 (got ${String(floor)}): a scan with no floor can pass having read nothing`);
  }
  for (const key of ['files', 'roots']) {
    const list = s[key] ?? [];
    if (!Array.isArray(list) || list.some((p) => typeof p !== 'string' || !isAbsolute(p))) problems.push(`${key} must be an array of absolute paths`);
  }
  const files = Array.isArray(s.files) ? s.files : [];
  const roots = Array.isArray(s.roots) ? s.roots : [];
  if (files.length + roots.length === 0) problems.push('nothing to scan: give at least one file or root');

  const names = new Set<string>();
  const checkRules = (key: string, keys: readonly string[], valid: (r: Record<string, unknown>) => boolean, shape: string): number => {
    const list = s[key] ?? [];
    if (!Array.isArray(list)) {
      problems.push(`${key} must be an array`);
      return 0;
    }
    for (const rule of list) {
      if (typeof rule !== 'object' || rule === null) {
        problems.push(`every entry of ${key} must be an object ${shape}`);
        continue;
      }
      const r = rule as Record<string, unknown>;
      for (const k of Object.keys(r)) {
        if (!keys.includes(k)) problems.push(`unrecognised option "${k}" on rule "${String(r.name)}" (rules have exactly ${keys.join(' and ')})`);
      }
      if (typeof r.name !== 'string' || r.name === '' || !valid(r)) problems.push(`every entry of ${key} must be ${shape}`);
      else if (names.has(r.name)) problems.push(`rule name used twice: "${r.name}"`);
      else names.add(r.name);
    }
    return list.length;
  };
  const textRules = checkRules(
    'rules',
    TEXT_RULE_KEYS,
    (r) => r.pattern instanceof RegExp && (r.scope === undefined || r.scope === 'code' || r.scope === 'text'),
    "{ name, pattern: RegExp, scope?: 'code' | 'text' }",
  );
  const importRules = checkRules('importRules', IMPORT_RULE_KEYS, (r) => typeof r.forbiddenDir === 'string' && isAbsolute(r.forbiddenDir), '{ name, forbiddenDir: absolute path }');
  if (textRules + importRules === 0) problems.push('no rules given: a scan with nothing to look for proves nothing');
  return problems;
}

/**
 * The call shapes of the `bridge` accessor that the 'bridge()' rule matches:
 * `bridge(`, and the ones where the two characters do not touch and a plain
 * `bridge\s*\(` misses: `bridge?.(`, `bridge!(`, `bridge<T>(`, `(0, bridge)(`,
 * `(bridge)(`. Nothing else (see the header's limits).
 */
const BRIDGE_CALL = /\bbridge\s*(?:\?\.\s*|!\s*)?(?:<[^()]*?>\s*)?\(|\bbridge\s*\)\s*\(/;

/**
 * What our own views and the UX-system folder must not contain. The first,
 * third and fourth are the acceptance grep's own `ipc/bridge|window.simplebrowser|localStorage`
 * check; the rest close the obvious ways round it. Rule names are the tokens a
 * reader would grep for. All of them are 'code' rules: comments are exempt.
 *  - 'ipc/bridge'          any import of the bridge module (`import type` too).
 *  - 'bridge()'            a call to the accessor, so a re-export under another
 *                          module name cannot dodge the import rule (call
 *                          shapes: BRIDGE_CALL).
 *  - 'window.simplebrowser' the raw global, however it is reached: `window.`,
 *                          `globalThis.`, `window['simplebrowser']`, a cast.
 *  - 'localStorage', 'sessionStorage'  ambient persistence; a view persists
 *                          through the settings API, never around it.
 *  - 'import.meta.glob'    a glob import pulls in a whole directory whose members
 *                          text cannot list (`import.meta.glob('../../desktop/*.ts')`
 *                          from the UX-system folder is the plausible accident),
 *                          so it is refused outright, `globEager` too.
 */
export const PHONE_BOUNDARY_RULES: readonly TextRule[] = [
  { name: 'ipc/bridge', pattern: /ipc\/bridge/ },
  { name: 'bridge()', pattern: BRIDGE_CALL },
  { name: 'window.simplebrowser', pattern: /\bsimplebrowser\b/ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'import.meta.glob', pattern: /\bimport\s*\.\s*meta\s*\.\s*glob/ },
];

/**
 * What the thin GoalFrontPage host must not contain: the host's own
 * acceptance check, `grep 'bridge\|localStorage\|useEffect\|useRef' GoalFrontPage.tsx`
 * returns nothing, plus `useLayoutEffect`, since the host keeps no ref or
 * effect of its own. Literally that grep: scope 'text' (comments
 * count, like the grep -- this is intentional, the same "a check that goes red
 * on prose tells us nothing about code" relaxation the phone rules get, just
 * inverted: here the acceptance check itself reads comments, so agreeing with
 * it means the scanner must too), plain case-sensitive SUBSTRINGS (not whole
 * words -- `bridgeHelper` and `getbridge` both match; a word-bounded version
 * would miss both, which is exactly what the self-tests mutate to and prove
 * goes red), escapes not decoded. A test that stayed green on a file the grep
 * fails would report a pass the acceptance check does not give (header
 * decision 1); the differential self-test runs the real `grep` over the same
 * fixtures.
 */
export const THIN_HOST_RULES: readonly TextRule[] = [
  { name: 'bridge', pattern: /bridge/, scope: 'text' },
  { name: 'localStorage', pattern: /localStorage/, scope: 'text' },
  { name: 'useEffect', pattern: /useEffect/, scope: 'text' },
  { name: 'useRef', pattern: /useRef/, scope: 'text' },
  { name: 'useLayoutEffect', pattern: /useLayoutEffect/, scope: 'text' },
];
