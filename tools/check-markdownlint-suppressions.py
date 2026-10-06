#!/usr/bin/env python3
"""check-markdownlint-suppressions.py -- an inline lint suppression must earn itself.

WHY THIS EXISTS
---------------
`.markdownlint-cli2.yaml` turns several rules off repo-wide, each with a
reason written beside it. That is policy, it is reviewed in one place, and
it is fine. An INLINE `<!-- markdownlint-disable MDxxx -->` is different: it
is invisible from the config, it is scoped to one file, and nothing checks
one unless something like this does.

A suppression fails in three ways, and the third is the one that matters:

  1. BLANKET. `markdownlint-disable` with no rule list switches off every rule
     for the rest of the file. That is not an exception, it is an opt-out.

  2. UNEXPLAINED. No HTML comment immediately above saying why. A suppression
     without a reason cannot be reviewed, only inherited.

  3. DEAD -- and this is the negative control. A suppression that suppresses
     NOTHING looks exactly like one doing real work. The document may have been
     rewritten, the rule may have been disabled repo-wide in the config since,
     the rule id may be misspelled. So this tool does not take the suppression's
     word for it: it STRIPS the suppression, re-runs the real linter on the real
     file, and requires each named rule to actually fire. If removing the
     suppression changes nothing, the suppression is decoration and is reported.

     This is the same discipline as asserting a test count went UP rather than
     trusting an exit code: ask what it would look like if it were not working,
     then confirm it does not look like that.

VACUITY GUARD
-------------
Scanning zero markdown files is NOT a pass. A broken path argument, a bad glob,
or a hook invoked with an empty staged list would otherwise print the same
cheerful green as a genuinely clean tree. Zero files examined exits non-zero and
says it proved nothing. Zero SUPPRESSIONS across a non-zero number of files is a
real pass and says so.

USAGE
    python3 tools/check-markdownlint-suppressions.py --repo-root .
    python3 tools/check-markdownlint-suppressions.py --repo-root . FILE [FILE...]

With no FILE arguments it walks the same globs `.markdownlint-cli2.yaml`
declares, so it cannot drift from what the gate actually lints. With FILE
arguments it checks only those (how .githooks/lib/markdown_lint.sh, sourced
from .githooks/pre-commit, calls it, over staged markdown).

Proof it fires: tools/tests/test_check_markdownlint_suppressions.py
"""

import argparse
import fnmatch
import os
import re
import subprocess
import sys
import tempfile

# `<!-- markdownlint-disable MD049 MD040 -->`, `markdownlint-disable-file`,
# `markdownlint-disable-next-line`, and the bare (blanket) forms of each.
SUPPRESSION = re.compile(
    r"<!--\s*(markdownlint-disable(?:-file|-next-line)?)((?:\s+MD\d+)*)\s*-->",
    re.IGNORECASE,
)
RULE_IN_OUTPUT = re.compile(r"\b(MD\d+)\b")
GLOB_LINE = re.compile(r'^\s*-\s*"(.+)"\s*$')


def _declared_list(repo_root, key):
    """Read one top-level string list (`globs:` / `ignores:`) out of the config."""
    path = os.path.join(repo_root, ".markdownlint-cli2.yaml")
    items, inside = [], False
    with open(path) as fh:
        for line in fh:
            stripped = line.strip()
            if stripped.startswith(key + ":"):
                inside = True
                continue
            if inside:
                m = GLOB_LINE.match(line)
                if m:
                    items.append(m.group(1))
                elif stripped and not stripped.startswith("#"):
                    break
    return items


def declared_globs(repo_root):
    """Read the glob list out of .markdownlint-cli2.yaml.

    Parsed rather than duplicated: a second hand-maintained copy of the lint
    scope would drift from the gate's, and a checker blind to the files the gate
    reads is worse than no checker.
    """
    return _declared_list(repo_root, "globs")


def declared_ignores(repo_root):
    """Read the ignores list, for the same reason.

    Scope is `globs` MINUS `ignores`, and a checker that hardcoded its own
    copy of that second list (`node_modules`, say) in Python, instead of
    reading it from the config, would silently drift from it the next time
    the config's `ignores:` gained an entry -- examining files the gate
    itself never lints. That matters here specifically, because in a file
    the linter never reads no rule can ever fire, which makes every
    suppression in it DEAD BY CONSTRUCTION -- reported as a finding nobody
    can act on, since removing it changes nothing either.

    One source of truth: the config. The docstring above already promised
    this; now both halves keep the promise.
    """
    return _declared_list(repo_root, "ignores")


def _is_ignored(rel, ignores):
    """True when `rel` falls under one of the config's ignore globs."""
    rel = rel.replace(os.sep, "/")
    for pat in ignores:
        # `dir/**` is the form every entry in this repo's config uses; match it
        # by prefix rather than leaving it to fnmatch, which would also accept
        # partial path-segment matches like `plans/records-old/x.md`.
        if pat.endswith("/**"):
            base = pat[:-3]
            if rel == base or rel.startswith(base + "/"):
                return True
        elif fnmatch.fnmatch(rel, pat):
            return True
    return False


def _matches_glob(rel, pattern):
    """True when `rel` matches a `globs:` entry such as `**/*.md`.

    `fnmatch.fnmatch` treats `*` as "anything, including `/`" -- so
    `fnmatch("AGENTS.md", "**/*.md")` is False, because the pattern's
    literal `/` has nothing to match at the repo root. Real glob engines
    (what `markdownlint-cli2` itself uses) treat a leading `**/` as
    "zero or more path segments", which DOES match a root-level file. This
    tries the pattern as-is, then -- only for a `**/`-prefixed pattern --
    also tries it with that prefix stripped, covering the zero-segments
    case without a full glob-engine reimplementation.
    """
    if fnmatch.fnmatch(rel, pattern):
        return True
    if pattern.startswith("**/") and fnmatch.fnmatch(rel, pattern[3:]):
        return True
    return False


def files_from_globs(repo_root, globs, ignores=None):
    """Walk `repo_root` for every file matching any of `globs`, minus
    `ignores`.

    Uses `os.walk`, not `glob.glob(..., recursive=True)`: Python's `glob`
    does not descend into dot-directories (`.claude/`, `.github/`,
    `.githooks/`, ...) by default, silently under-scoping this tool on any
    repo whose authored markdown lives partly under one -- exactly the kind
    of gap that makes a suppression inside such a file DEAD BY CONSTRUCTION
    from this tool's point of view (see `declared_ignores`'s docstring)
    while `markdownlint-cli2` itself (a real glob engine) still lints it.
    Found while porting this tool onto a repo that keeps most of its
    authored markdown under `.claude/` and `.github/`.
    """
    if ignores is None:
        ignores = declared_ignores(repo_root)
    # node_modules stays an unconditional floor: it is a performance guard
    # (walking it is pathological), NOT a scope declaration. Everything that
    # decides what this tool is responsible for comes from the config above.
    ignores = list(ignores) + ["node_modules/**"]
    out = set()
    for dirpath, dirnames, filenames in os.walk(repo_root):
        rel_dir = os.path.relpath(dirpath, repo_root)
        if rel_dir == ".":
            rel_dir = ""
        # `.git` is repository plumbing, never content -- never a target of
        # `globs:` and pathological to walk (it is not a `.md`-bearing
        # ignore entry because nobody should need to declare it).
        if rel_dir == "":
            dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            rel = (rel_dir + "/" + name) if rel_dir else name
            if not any(_matches_glob(rel, g) for g in globs):
                continue
            if _is_ignored(rel, ignores):
                continue
            out.add(rel)
    return sorted(out)


# markdownlint-cli2 prints one of these on every run it actually performed
# ("Linting: N files", then "Summary: N issues in M files"). Their ABSENCE is
# the positive evidence that it never ran -- see lint_rules_fired().
RAN_MARKERS = ("Linting:", "Summary:")


def lint_findings(repo_root, rel_path):
    """Run the REAL linter on one file; return a list of (line_no, rule_id)
    findings -- one entry per reported violation, keeping the LINE each one
    fired on. `lint_rules_fired` (below) collapses this to a bare rule-id
    set for the whole-file checks; `-next-line` suppressions need the line
    number too, to tell "this rule fires on the very line the suppression
    scopes to" apart from "this rule fires SOMEWHERE in the document" (round
    3 item 6b -- see check_file's per-suppression scoping for why the
    distinction matters).

    Raises RuntimeError exactly like `lint_rules_fired` on a cannot-run.
    """
    try:
        proc = subprocess.run(
            ["npx", "--offline", "markdownlint-cli2", "--no-globs", "--", ":" + rel_path],
            cwd=repo_root, capture_output=True, text=True,
        )
    except OSError as exc:
        raise RuntimeError(
            "could not execute `npx` at all (" + str(exc) + "); this check cannot run. "
            "Refusing to report a verdict it did not earn."
        )
    blob = proc.stdout + proc.stderr

    findings = []
    for line in blob.splitlines():
        if " error " not in line:
            continue
        prefix, rest = line.split(" error ", 1)
        m = RULE_IN_OUTPUT.search(rest)
        if not m:
            continue
        # prefix looks like "path:LINE[:COL]" or "path:LINE"
        loc = prefix.rsplit(":", 2 if prefix.count(":") >= 2 else 1)
        line_no = None
        for part in loc[1:]:
            if part.strip().isdigit():
                line_no = int(part.strip())
                break
        if line_no is not None:
            findings.append((line_no, m.group(1).upper()))

    if findings:
        return findings

    ran = any(marker in blob for marker in RAN_MARKERS)
    if proc.returncode != 0 or not ran:
        raise RuntimeError(
            "markdownlint-cli2 did not run (exit " + str(proc.returncode)
            + ", no findings and no "
            + "/".join(RAN_MARKERS)
            + " line in its output); this check cannot run. Refusing to report a "
            "pass -- or a dead-suppression verdict -- it did not earn. Run "
            "`npx markdownlint-cli2` once with network to warm the shared cache. "
            "Its output was:\n" + blob.strip()[:800]
        )
    return findings


def lint_rules_fired(repo_root, rel_path):
    """Run the REAL linter on one file; return the set of rule ids it reports.

    Raises RuntimeError ("cannot run", mapped to exit 3 by main()) rather
    than returning an empty set whenever the linter did not actually execute.
    THAT DISTINCTION IS THE WHOLE POINT: an empty rule set means "removing the
    suppression changes nothing", so a linter that never ran reads as every
    suppression in the repo being dead, and the tool exits 1 accusing a
    load-bearing suppression of suppressing nothing.

    It used to detect "cannot run" by sniffing for the substring "not found".
    The real message, captured verbatim from `npm_config_cache=<empty dir>
    npx --offline markdownlint-cli2` on this machine, is:

        npm error code ENOTCACHED
        npm error request to https://registry.npmjs.org/markdownlint-cli2
        failed: cache mode is 'only-if-cached' but no cached response is
        available.

    -- no "not found" anywhere, so the documented exit-3 path was unreachable
    and the false accusation was what a cold machine actually got. The checks
    below are therefore about EVIDENCE OF HAVING RUN, not about matching one
    vendor's wording: any non-zero exit with no rule findings, and any exit
    at all that produced neither of the linter's own run markers, is a
    cannot-run.

    A thin wrapper over `lint_findings` (one real subprocess call, one real
    parse) that collapses (line, rule) pairs to a bare rule-id set -- the
    whole-file checks below only need "did this rule fire anywhere", never
    the line it fired on.
    """
    return {rule for _line, rule in lint_findings(repo_root, rel_path)}


def rules_fired_without_suppressions(repo_root, rel_path, text):
    """THE NEGATIVE CONTROL: strip every suppression, lint, report what
    fires, as (line, rule) pairs -- so a caller can ask either "did this
    rule fire anywhere in the document" (whole-file suppressions) or "did
    this rule fire on THIS specific line" (`-next-line` suppressions; round
    3 item 6b). See check_file()."""
    stripped = SUPPRESSION.sub("", text)
    directory = os.path.dirname(os.path.join(repo_root, rel_path))
    fd, tmp_abs = tempfile.mkstemp(
        prefix=".suppression-check-", suffix=".md", dir=directory or repo_root)
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(stripped)
        return lint_findings(repo_root, os.path.relpath(tmp_abs, repo_root))
    finally:
        os.unlink(tmp_abs)


def check_file(repo_root, rel_path):
    """Return (n_suppressions, [failure strings])."""
    with open(os.path.join(repo_root, rel_path)) as fh:
        text = fh.read()
    matches = list(SUPPRESSION.finditer(text))
    if not matches:
        return 0, []

    failures = []
    # (where, claimed rules, target_line or None) for every non-blanket
    # suppression -- checked against the real linter output below, ONE
    # suppression at a time. `target_line` is set only for
    # `-next-line` directives: that scope claims to protect exactly one
    # line, so its dead-check must be scoped to that line too (round 3 item
    # 6b -- see the block below for why a whole-file check cannot tell this
    # apart from a misplaced or wrong-rule-id suppression). A bare
    # `markdownlint-disable` or `-disable-file` genuinely does apply from
    # its own point to the end of the document, so those keep the
    # whole-file "fires anywhere after here" check.
    scoped = []
    for m in matches:
        directive, rules = m.group(1), m.group(2).split()
        line_no = text.count("\n", 0, m.start()) + 1
        where = f"{rel_path}:{line_no}"

        if not rules:
            failures.append(
                f"{where}: BLANKET `{directive}` with no rule list. Name the "
                f"rules it needs off; a bare disable is an opt-out, not an "
                f"exception.")
            continue

        # A reason is the HTML comment immediately above -- and it must be a
        # real comment, not another markdownlint directive stacked on top.
        preceding = text[:m.start()].rstrip()
        has_reason = False
        if preceding.endswith("-->"):
            open_at = preceding.rfind("<!--")
            if open_at != -1:
                inner = preceding[open_at + 4:-3].strip().lower()
                has_reason = not inner.startswith("markdownlint-")
        if not has_reason:
            failures.append(
                f"{where}: no reason. Put an HTML comment directly above "
                f"saying why these rules cannot apply here.")

        target_line = line_no + 1 if directive.endswith("-next-line") else None
        scoped.append((where, {r.upper() for r in rules}, target_line))

    if scoped:
        findings = rules_fired_without_suppressions(repo_root, rel_path, text)
        fired_anywhere = {rule for _line, rule in findings}
        fired_by_line = {}
        for line, rule in findings:
            fired_by_line.setdefault(line, set()).add(rule)

        for where, claimed, target_line in scoped:
            if target_line is None:
                would_fire = fired_anywhere
                scope_desc = ""
            else:
                would_fire = fired_by_line.get(target_line, set())
                scope_desc = f" on line {target_line} (the line it scopes to)"
            dead = sorted(claimed - would_fire)
            if dead:
                # A `-next-line` suppression whose claimed rule fires
                # SOMEWHERE else in the document, but not on the specific
                # line it scopes to, is not "load-bearing" -- it is either
                # misplaced (the real violation is on a different line) or
                # naming the wrong rule id for the line it actually sits
                # over. A whole-file check that only asks "does MD049 fire
                # anywhere in this document" cannot tell that apart from a
                # genuine suppression, which is exactly the gap item 6b
                # closes: the SAME claimed-rule set can be "fired anywhere"
                # (whole-file suppressions, unaffected) while still being
                # dead-on-the-line for a `-next-line` one.
                misplaced = target_line is not None and dead != sorted(claimed - fired_anywhere)
                pronoun = "it" if len(dead) == 1 else "them"
                reason = (
                    "unjustified or misplaced: the named rule does not fire" + scope_desc
                    if target_line is not None else
                    "removing the suppression does not make " + pronoun + " fire"
                )
                failures.append(
                    f"{where}: suppresses {', '.join(dead)}, but {reason}"
                    + (" (it does fire elsewhere in the file, which is why a "
                       "whole-document check alone would have missed this)"
                       if misplaced else "")
                    + ". A suppression that suppresses nothing is indistinguishable "
                      "from one doing real work -- delete it, fix the rule id, or "
                      "move it to the line it is meant to cover."
                )
    return len(matches), failures


def main():
    """Check inline markdownlint suppressions across the repo or the named files.

    Returns:
        Exit code 0 when every suppression is scoped, explained and load-bearing
        (or all named files are out of lint scope), 1 on a failing suppression,
        2 when zero files were examined, 3 when the linter could not run.
    """
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("files", nargs="*")
    args = ap.parse_args()
    root = os.path.abspath(args.repo_root)

    if args.files:
        targets = [os.path.relpath(os.path.abspath(f), root) for f in args.files]
        targets = [t for t in targets if t.endswith(".md") and
                   os.path.isfile(os.path.join(root, t))]
        # Named files get the same scope test as globbed ones. The pre-commit
        # fragment passes the staged markdown list, which can name a file the
        # gate never lints (plans/records/**). Examining one would report its
        # suppressions as DEAD -- correctly, but uselessly: no rule can fire
        # in a file the linter does not read, and removing the suppression
        # would change nothing either.
        ignores = declared_ignores(root)
        in_scope = [t for t in targets if not _is_ignored(t, ignores)]
        skipped_out_of_scope = len(targets) - len(in_scope)
        targets = in_scope
    else:
        skipped_out_of_scope = 0
        targets = files_from_globs(root, declared_globs(root))

    if not targets:
        # "Everything you named is out of scope" is a real answer; "nothing
        # matched at all" is the vacuous run the guard exists to catch. Only the
        # second one is a failure, and they must not be collapsed: a commit that
        # touches only archived records is legitimate and must not be refused.
        if skipped_out_of_scope:
            print(f"check-markdownlint-suppressions: OK -- {skipped_out_of_scope} "
                  f"named file(s), all outside the lint scope declared in "
                  f".markdownlint-cli2.yaml (ignores:). Nothing to check.")
            return 0
        print("check-markdownlint-suppressions: EXAMINED ZERO FILES -- this "
              "proves nothing, so it is not a pass.", file=sys.stderr)
        print("  (no markdown matched. Check the path arguments or the globs in "
              ".markdownlint-cli2.yaml.)", file=sys.stderr)
        return 2

    total, failures = 0, []
    try:
        for rel in targets:
            n, f = check_file(root, rel)
            total += n
            failures.extend(f)
    except RuntimeError as exc:
        # Exit 3 is "could not run", distinct from 1 "failed" and 2 "vacuous".
        # .githooks/lib/markdown_lint.sh treats it the way it treats a missing
        # linter: loudly, but without blocking a commit it cannot legitimately
        # judge.
        print(f"check-markdownlint-suppressions: CANNOT RUN -- {exc}", file=sys.stderr)
        return 3

    if failures:
        print(f"check-markdownlint-suppressions: FAIL -- {len(failures)} "
              f"problem(s) in {total} suppression(s) across {len(targets)} file(s):",
              file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1

    if total == 0:
        print(f"check-markdownlint-suppressions: OK -- {len(targets)} file(s) "
              f"examined, no inline suppressions to check.")
    else:
        print(f"check-markdownlint-suppressions: OK -- {total} suppression(s) "
              f"across {len(targets)} file(s); each is scoped, explained, and "
              f"verified still load-bearing by removing it and re-linting.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
