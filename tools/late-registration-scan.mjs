// Static check for test registrations that Node can drop without a word.
// Under --test-force-exit the root exits once every test it already knows has finished, so a test or hook registered
// after an await (or from a deferred callback) may never run, and the result stream stays self-consistent.
// Bindings are resolved through the TypeScript checker, so a local named `after` is not mistaken for node:test's.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import ts from 'typescript';

// A new node:test export is assumed to register something until it is listed here.
const NON_REGISTERING = new Set(['mock', 'run', 'snapshot', 'assert']);
const SUITE_EXPORTS = new Set(['describe', 'suite']);
const HOOK_EXPORTS = new Set(['before', 'after', 'beforeEach', 'afterEach']);
const MEMBER_REGISTRARS = new Set([
  'test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach', 'skip', 'only', 'todo', 'expectFailure',
]);
// On a test context only these register something; t.skip() and t.todo() just mark the running test.
const CONTEXT_REGISTRARS = new Set(['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach']);

// reg: a test-like registration may already have run. aw: line of an await that may have run after one (0 = none).
// Hooks do not set reg: a hook followed by an await and then the first test is safe.
const START = { reg: false, aw: 0 };
const join = (a, b) => ({ reg: a.reg || b.reg, aw: a.aw || b.aw });
const mergeFlow = (a, b) => {
  if (a.live && b.live) return { live: true, state: join(a.state, b.state) };
  if (a.live) return a;
  if (b.live) return b;
  return { live: false, state: join(a.state, b.state) };
};

const isFunctionLike = (n) => ts.isFunctionLike(n) || ts.isClassStaticBlockDeclaration(n);
const isAwaitUsing = (list) => (list.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing;
const isCallback = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n);

const walkAll = (n, fn) => {
  fn(n);
  ts.forEachChild(n, (c) => walkAll(c, fn));
};

const peel = (e) => {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
};

// `a.b['c'](...)` gives root `a` and chain ['b', 'c'].
const calleeChain = (call) => {
  const chain = [];
  let cur = peel(call.expression);
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      chain.unshift(cur.name.text);
      cur = peel(cur.expression);
    } else if (ts.isElementAccessExpression(cur) && ts.isStringLiteralLike(cur.argumentExpression)) {
      chain.unshift(cur.argumentExpression.text);
      cur = peel(cur.expression);
    } else {
      return { root: cur, chain };
    }
  }
};

// One Program over in-memory files with no module resolution: only the binder's scope rules are needed to tell a node:test import from a local of the same name.
// Every file is loaded under a synthetic .ts name, because TypeScript silently drops a root file whose extension it does not accept.
function buildProgram(files) {
  const options = { noResolve: true, noLib: true, types: [], target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, noEmit: true };
  const host = ts.createCompilerHost(options);
  const names = files.map((_, i) => `/scan-input/${i}.ts`);
  const sources = new Map(files.map((f, i) => [names[i], ts.createSourceFile(names[i], f.text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)]));
  host.getSourceFile = (name) => sources.get(name);
  host.fileExists = (name) => sources.has(name);
  host.readFile = (name) => sources.get(name)?.text;
  host.writeFile = () => {};
  return { program: ts.createProgram(names, options, host), names };
}

export function scanSources(files) {
  const { program, names } = buildProgram(files);
  const checker = program.getTypeChecker();
  return files.map(({ file }, i) => {
    const sf = program.getSourceFile(names[i]);
    if (!sf) throw new Error(`late-registration scan: ${file} was not loaded into the Program`);
    return scanFile(sf, file, program, checker);
  });
}

export function scanSource(file, text) {
  return scanSources([{ file, text }])[0];
}

function scanFile(sf, file, program, checker) {
  const result = { file, importsNodeTest: false, registrations: 0, moduleLevelAwaits: 0, violations: [] };
  const seen = new Set();
  const report = (node, kind, detail) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const key = `${kind}:${line}:${character}`;
    if (seen.has(key)) return;
    seen.add(key);
    const first = node.getText(sf).split('\n')[0] ?? '';
    result.violations.push({ kind, line: line + 1, column: character + 1, text: first.slice(0, 80), detail });
  };
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  for (const d of program.getSyntacticDiagnostics(sf)) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    result.violations.push({ kind: 'syntax', line: line + 1, column: character + 1, text: '', detail: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
  }

  // Local names worth resolving; a name that is not one of these cannot be a node:test binding.
  const importedNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== 'node:test') continue;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly) continue;
    result.importsNodeTest = true;
    if (clause.name) importedNames.add(clause.name.text);
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) importedNames.add(nb.name.text);
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) importedNames.add(el.name.text);
  }

  // A literal 'node:test' anywhere but an import declaration is a binding this scan cannot follow.
  walkAll(sf, (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === 'node:test' && !ts.isImportDeclaration(n.parent)) {
      report(n, 'unresolved-import', 'node:test reached other than by a static import, so its registrations cannot be followed');
    }
  });

  // The identifier's own binding when it is a node:test import; a same-named local resolves to its own declaration and yields undefined.
  const bindingOf = (id) => {
    if (!importedNames.has(id.text)) return undefined;
    const sym = ts.isShorthandPropertyAssignment(id.parent) ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
    const decl = sym?.declarations?.[0];
    if (!decl) return { kind: 'named', exported: id.text };
    const importDecl = ts.findAncestor(decl, ts.isImportDeclaration);
    if (!importDecl || !ts.isStringLiteral(importDecl.moduleSpecifier) || importDecl.moduleSpecifier.text !== 'node:test') return undefined;
    if (ts.isImportSpecifier(decl)) return { kind: 'named', exported: (decl.propertyName ?? decl.name).text };
    if (ts.isImportClause(decl)) return { kind: 'default' };
    if (ts.isNamespaceImport(decl)) return { kind: 'namespace' };
    return undefined;
  };

  // null: not a node:test call.
  const classify = (call) => {
    const { root, chain } = calleeChain(call);
    if (!ts.isIdentifier(root)) return null;
    const b = bindingOf(root);
    if (!b) return null;
    let exported;
    let rest = chain;
    if (b.kind === 'named') exported = b.exported;
    else if (b.kind === 'default') exported = 'test';
    else {
      const [head, ...tail] = chain;
      if (head === undefined) return null;
      exported = head === 'default' ? 'test' : head;
      rest = tail;
    }
    if (NON_REGISTERING.has(exported)) return null;
    const member = rest[0];
    // test.mock.method(...), test.run(...): members of the default export that are not registrars.
    if (exported === 'test' && member !== undefined && !MEMBER_REGISTRARS.has(member)) {
      if (NON_REGISTERING.has(member)) return null;
      report(call, 'unresolved-import', `unknown member test.${member} of the node:test default export`);
      return null;
    }
    const first = exported === 'test' && member !== undefined ? member : exported;
    return { suite: SUITE_EXPORTS.has(first), hook: HOOK_EXPORTS.has(first) };
  };

  const countAwaits = (n) => {
    if (isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier) || (ts.isVariableDeclarationList(n) && isAwaitUsing(n))) {
      result.moduleLevelAwaits++;
    }
    ts.forEachChild(n, countAwaits);
  };
  countAwaits(sf);

  const all = [];
  walkAll(sf, (n) => { if (ts.isCallExpression(n) && classify(n)) all.push(n); });
  result.registrations = all.length;
  const classified = new Set();

  const suppress = (n) => {
    ts.forEachChild(n, function mark(c) {
      if (ts.isCallExpression(c) && classify(c)) classified.add(c);
      ts.forEachChild(c, mark);
    });
  };
  // Outermost registration calls inside a function body: the function runs whenever something calls it.
  const flagInsideFunction = (fn) => {
    const visit = (n) => {
      if (ts.isCallExpression(n) && classify(n)) {
        classified.add(n);
        report(n, 'inside-function', "registered inside a function body that may run after the file's known tests have finished; register at load time");
        suppress(n);
        return;
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn, visit);
  };

  const contextRoot = (call) => {
    const { root, chain } = calleeChain(call);
    return ts.isIdentifier(root) && CONTEXT_REGISTRARS.has(chain[0] ?? '') ? checker.getSymbolAtLocation(root) : undefined;
  };
  // A subtest or hook registered on a test's context from a function nested in the test body (a timer, a .then, a map callback)
  // can arrive after the parent finished. The direct body is safe, and each direct subtest callback is checked against its own parameter.
  // `enclosing` holds the parameters of the test callbacks that contain `cb`: a call through one of those from `cb` is flagged too.
  const flagDetachedSubtests = (cb, enclosing) => {
    const first = cb.parameters[0];
    const own = first && ts.isIdentifier(first.name) ? checker.getSymbolAtLocation(first.name) : undefined;
    const roots = new Set(enclosing);
    if (own) roots.add(own);
    const visit = (n, nested) => {
      if (n !== cb && isFunctionLike(n)) {
        ts.forEachChild(n, (c) => visit(c, true));
        return;
      }
      if (ts.isCallExpression(n)) {
        const root = contextRoot(n);
        if (root && roots.has(root)) {
          if (nested || root !== own) {
            report(n, 'detached-subtest', 'registered on a test context from a nested function, which may run after the parent test finished; await t.test(...) directly in the test body, in a for-of loop');
            return;
          }
          ts.forEachChild(n, (c) => (isCallback(c) ? flagDetachedSubtests(c, roots) : visit(c, false)));
          return;
        }
      }
      ts.forEachChild(n, (c) => visit(c, nested));
    };
    ts.forEachChild(cb, (c) => visit(c, false));
  };

  const awaitNow = (s, at, track) => (track && s.reg && !s.aw ? { reg: true, aw: lineOf(at) } : s);

  // Expressions never terminate, and state only grows along evaluation order, so threading it left to right is the may-analysis.
  const expr = (n, s, track) => {
    if (ts.isAwaitExpression(n)) return awaitNow(expr(n.expression, s, track), n, track);
    if (isFunctionLike(n)) { flagInsideFunction(n); return s; }
    if (ts.isConditionalExpression(n)) {
      const c = expr(n.condition, s, track);
      return join(expr(n.whenTrue, c, track), expr(n.whenFalse, c, track));
    }
    if (ts.isCallExpression(n)) return call(n, s, track);
    if (ts.isVariableDeclarationList(n)) {
      let cur = s;
      for (const d of n.declarations) {
        if (d.initializer) cur = expr(d.initializer, cur, track);
        cur = expr(d.name, cur, track);
        if (isAwaitUsing(n)) cur = awaitNow(cur, d, track);
      }
      return cur;
    }
    let cur = s;
    ts.forEachChild(n, (c) => { cur = expr(c, cur, track); });
    return cur;
  };

  const call = (n, s, track) => {
    const reg = classify(n);
    let cur = expr(n.expression, s, track);
    const callbacks = [];
    for (const a of n.arguments) {
      if (isCallback(a)) callbacks.push(a);
      else cur = expr(a, cur, track);
    }
    if (!reg) {
      for (const cb of callbacks) cur = expr(cb, cur, track);
      return cur;
    }
    classified.add(n);
    const after = reg.hook ? cur : { reg: true, aw: cur.aw };
    if (track && cur.aw) {
      report(n, 'after-await', `registered after the await at line ${cur.aw}; Node under --test-force-exit may already have exited, so put awaits before the first registration or inside test bodies`);
      for (const cb of callbacks) suppress(cb);
      return after;
    }
    for (const cb of callbacks) {
      // The harness awaits a describe/suite callback during its build phase, so awaits inside one are not tracked.
      if (reg.suite) suiteBody(cb);
      else { flagInsideFunction(cb); flagDetachedSubtests(cb, new Set()); }
    }
    return after;
  };

  const suiteBody = (fn) => {
    if (ts.isBlock(fn.body)) stmts(fn.body.statements, START, false);
    else expr(fn.body, START, false);
  };

  const stmts = (list, s, track) => {
    let cur = { state: s, live: true };
    for (const st of list) {
      const next = stmt(st, cur.state, track);
      cur = { state: next.state, live: cur.live && next.live };
    }
    return cur;
  };

  // Two passes: the second starts from what the first left behind, which is how an await late in the body reaches a registration early in it.
  const loop = (s, pass) => {
    const first = pass(s);
    const second = pass(join(s, first));
    return { state: join(join(s, first), second), live: true };
  };

  const stmt = (n, s, track) => {
    if (ts.isBlock(n)) return stmts(n.statements, s, track);
    if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) return { state: n.expression ? expr(n.expression, s, track) : s, live: false };
    if (ts.isIfStatement(n)) {
      const c = expr(n.expression, s, track);
      const t = stmt(n.thenStatement, c, track);
      const e = n.elseStatement ? stmt(n.elseStatement, c, track) : { state: c, live: true };
      return mergeFlow(t, e);
    }
    if (ts.isForStatement(n)) {
      const init = n.initializer ? expr(n.initializer, s, track) : s;
      return loop(init, (from) => {
        let cur = n.condition ? expr(n.condition, from, track) : from;
        cur = stmt(n.statement, cur, track).state;
        return n.incrementor ? expr(n.incrementor, cur, track) : cur;
      });
    }
    if (ts.isForOfStatement(n) || ts.isForInStatement(n)) {
      const isAwait = ts.isForOfStatement(n) && n.awaitModifier !== undefined;
      const head = expr(n.expression, s, track);
      return loop(isAwait ? awaitNow(head, n, track) : head, (from) => {
        const init = expr(n.initializer, from, track);
        return stmt(n.statement, isAwait ? awaitNow(init, n, track) : init, track).state;
      });
    }
    if (ts.isWhileStatement(n)) return loop(s, (from) => stmt(n.statement, expr(n.expression, from, track), track).state);
    if (ts.isDoStatement(n)) return loop(s, (from) => expr(n.expression, stmt(n.statement, from, track).state, track));
    if (ts.isTryStatement(n)) {
      const t = stmt(n.tryBlock, s, track);
      // The catch block can be entered from any point in the try block, so it starts from the state at its end.
      const reach = join(s, t.state);
      const c = n.catchClause ? stmt(n.catchClause.block, reach, track) : { state: reach, live: true };
      const joined = n.catchClause ? mergeFlow(t, c) : t;
      if (!n.finallyBlock) return joined;
      const f = stmt(n.finallyBlock, join(reach, c.state), track);
      return { state: join(joined.state, f.state), live: joined.live && f.live };
    }
    if (ts.isSwitchStatement(n)) {
      const d = expr(n.expression, s, track);
      let carry = START;
      let out = { state: d, live: true };
      for (const clause of n.caseBlock.clauses) {
        const from = join(d, carry);
        const head = ts.isCaseClause(clause) ? expr(clause.expression, from, track) : from;
        const body = stmts(clause.statements, head, track);
        carry = body.live ? body.state : START;
        out = mergeFlow(out, { state: body.state, live: true });
      }
      return out;
    }
    if (ts.isLabeledStatement(n)) return stmt(n.statement, s, track);
    // break and continue stay live: the code after them is then analysed as if they were absent, which can only over-report.
    if (isFunctionLike(n)) { flagInsideFunction(n); return { state: s, live: true }; }
    return { state: expr(n, s, track), live: true };
  };

  stmts(sf.statements, START, true);

  for (const n of all) {
    if (!classified.has(n)) report(n, 'unclassified', 'the scan reached this registration without classifying it');
  }

  // A registrar read as a value (passed, aliased, exported) can be called from somewhere the scan never looks.
  const isNonReferenceName = (n) => {
    const p = n.parent;
    if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p) || ts.isQualifiedName(p)) return true;
    if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
    if (ts.isBindingElement(p) && p.propertyName === n) return true;
    return (
      (ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p) || ts.isParameter(p) ||
        ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isFunctionExpression(p) ||
        ts.isClassExpression(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) ||
        ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) ||
        ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) && p.name === n
    );
  };
  walkAll(sf, (n) => {
    if (!ts.isIdentifier(n) || !importedNames.has(n.text) || isNonReferenceName(n)) return;
    // A type annotation such as `(t: TestContext)` reads no value.
    if (ts.findAncestor(n, ts.isTypeNode)) return;
    if (ts.isExportSpecifier(n.parent)) {
      if (!n.parent.parent.parent.moduleSpecifier) report(n, 'escaped-binding', `'${n.text}' is exported as a value, so later calls through it cannot be followed`);
      return;
    }
    const b = bindingOf(n);
    if (!b || (b.kind === 'named' && NON_REGISTERING.has(b.exported))) return;
    let top = n;
    while (
      (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) ||
      (ts.isElementAccessExpression(top.parent) && top.parent.expression === top) ||
      ts.isParenthesizedExpression(top.parent) || ts.isNonNullExpression(top.parent) || ts.isAsExpression(top.parent)
    ) top = top.parent;
    if (ts.isCallExpression(top.parent) && top.parent.expression === top) return;
    report(n, 'escaped-binding', `'${n.text}' is used as a value, so later calls through it cannot be followed`);
  });

  result.violations.sort((a, b) => a.line - b.line || a.column - b.column);
  return result;
}

export function scanLateRegistrations(absPaths) {
  const results = scanSources(absPaths.map((file) => ({ file, text: readFileSync(file, 'utf8') })));
  return {
    scanned: results.length,
    sites: results.reduce((sum, r) => sum + r.registrations, 0),
    results,
    violations: results.flatMap((r) => r.violations.map((v) => ({ ...v, file: r.file }))),
  };
}

// Zero files scanned is a failure, not a pass: a glob that matched nothing must not read as a clean scan.
export function lateScanFailed({ scanned, violations }) {
  return violations.length > 0 || scanned === 0;
}

export function formatLateScan({ repoRoot, scanned, sites, violations }) {
  const lines = [`late-registration scan: ${scanned} file(s), ${sites} registration site(s), ${violations.length} violation(s).`];
  for (const v of violations) lines.push(`  ${relative(repoRoot, v.file)}:${v.line}:${v.column}: ${v.kind}: ${v.detail}${v.text ? `  [${v.text}]` : ''}`);
  if (scanned === 0) lines.push('late-registration scan: no file was scanned: this run proved nothing.');
  return lines;
}
