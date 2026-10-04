#!/usr/bin/env python3
"""Unit tests for tools/check-markdownlint-suppressions.py.

Written as unittest.TestCase so `python3 -m unittest discover`
(tools/tests/run_all.sh) picks it up rather than needing a second,
hand-kept explicit-loop entry.

A gate that has never been seen to fail is indistinguishable from a gate that
cannot fail (AGENTS.md rule 1). This pins:

  1. Each of the three ways a suppression must be rejected -- blanket, no
     reason, and DEAD -- end to end through the real CLI against synthetic
     fixtures that carry a real .markdownlint-cli2.yaml.
  2. The dead-suppression case is the one worth having, and it is proven
     against a file that lints CLEAN with the suppression removed. That is
     the shape a stale suppression actually has: nothing is wrong, so
     nothing fires, so the suppression is decoration -- and it looks
     identical to a load-bearing one from the outside.
  3. The legitimate case passes: scoped + explained + still firing.
  4. The vacuity guard. Zero files examined exits NON-ZERO. Without this,
     the hook invoked with an empty staged list, or a mistyped path, would
     print the same cheerful green as a genuinely clean tree. Zero
     SUPPRESSIONS over a non-zero file count is a real pass and is asserted
     separately.
  5. THE REAL TREE. This template's own repo has zero suppressions today
     and must PASS -- if the gate fails a clean repo, the gate is wrong.
  6. Scope comes from the config's `ignores:`, not from a copy of it, and
     the file-discovery walk actually reaches dot-directories (`.claude/`,
     `.github/`) -- the real bug this port's `files_from_globs` fixes over
     the ported original (see that function's own docstring).

Run:
    python3 tools/tests/test_check_markdownlint_suppressions.py
    python3 -m unittest tools.tests.test_check_markdownlint_suppressions -v
"""

import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import unittest

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.dirname(THIS_DIR)
REPO_ROOT = os.path.dirname(TOOLS_DIR)
TOOL = os.path.join(TOOLS_DIR, "check-markdownlint-suppressions.py")

_spec = importlib.util.spec_from_file_location("check_markdownlint_suppressions", TOOL)
supp_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(supp_mod)

CONFIG = """\
globs:
  - "*.md"
  - "plans/**/*.md"

ignores:
  - "node_modules/**"
"""

# Mixed emphasis styles: MD049 genuinely fires here once unsuppressed.
BODY_THAT_TRIPS_MD049 = "Some *asterisk* emphasis and then _underscore_ emphasis.\n"
# Nothing wrong with this one; no rule fires.
BODY_THAT_TRIPS_NOTHING = "Plain prose with *consistent* emphasis only.\n"


def run(repo_root, *files):
    proc = subprocess.run(
        [sys.executable, TOOL, "--repo-root", repo_root, *files],
        capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def fixture(tmp, name, body):
    os.makedirs(os.path.join(tmp, "plans"), exist_ok=True)
    with open(os.path.join(tmp, ".markdownlint-cli2.yaml"), "w") as fh:
        fh.write(CONFIG)
    rel = os.path.join("plans", name)
    with open(os.path.join(tmp, rel), "w") as fh:
        fh.write(body)
    return rel


class CheckMarkdownlintSuppressionsTest(unittest.TestCase):
    def test_blanket_disable_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(tmp, "blanket.md", "# T\n\n<!-- why: reasons -->\n"
                          "<!-- markdownlint-disable -->\n\n" + BODY_THAT_TRIPS_MD049)
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(code, 1, f"blanket disable should FAIL, got {code}\n{out}")
            self.assertIn("BLANKET", out)

    def test_unexplained_disable_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(tmp, "noreason.md", "# T\n\n"
                          "<!-- markdownlint-disable MD049 -->\n\n" + BODY_THAT_TRIPS_MD049)
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(code, 1, f"unexplained disable should FAIL, got {code}\n{out}")
            self.assertIn("no reason", out)

    def test_dead_suppression_is_rejected(self):
        """THE CENTRAL CLAIM. Suppression is scoped and explained, but
        nothing fires without it -- so it is decoration, and it must not
        read as load-bearing."""
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(tmp, "dead.md", "# T\n\n<!-- why: reasons -->\n"
                          "<!-- markdownlint-disable MD049 -->\n\n" + BODY_THAT_TRIPS_NOTHING)
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(code, 1, f"dead suppression should FAIL, got {code}\n{out}")
            self.assertIn("does not make it fire", out)

    def test_next_line_suppression_misplaced_over_a_clean_line_is_rejected(self):
        """Round 3 item 6b. A `-next-line` suppression only ever protects the
        SINGLE line right after it. This fixture's claimed rule (MD049)
        really does fire in the document -- just on an EARLIER, unrelated
        line the suppression never touches -- while the line the
        suppression actually scopes to is clean. A whole-file "does this
        rule fire anywhere" check (the pre-item-6b behavior) cannot tell
        this apart from a genuine suppression and would wrongly call it
        load-bearing; this must be reported as unjustified/misplaced."""
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(
                tmp, "misplaced.md",
                "# T\n\n"
                + BODY_THAT_TRIPS_MD049  # a REAL, unsuppressed MD049 violation earlier in the doc
                + "\n<!-- reason: this line uses underscores on purpose -->\n"
                "<!-- markdownlint-disable-next-line MD049 -->\n"
                + BODY_THAT_TRIPS_NOTHING  # the line the suppression actually scopes to: clean
            )
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(
                code, 1,
                f"a -next-line suppression whose claimed rule fires only elsewhere in the "
                f"document, not on the line it scopes to, must FAIL, got {code}\n{out}")
            self.assertIn("misplaced", out.lower())
            self.assertIn("MD049", out)

    def test_load_bearing_suppression_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(tmp, "live.md", "# T\n\n<!-- why: quoted text, do not restyle -->\n"
                          "<!-- markdownlint-disable MD049 -->\n\n" + BODY_THAT_TRIPS_MD049)
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(code, 0, f"legitimate suppression should PASS, got {code}\n{out}")
            self.assertIn("load-bearing", out)

    def test_next_line_suppression_correctly_placed_still_passes(self):
        """The positive control for item 6b's new line-scoped check: a
        `-next-line` suppression whose claimed rule DOES fire on the very
        line it scopes to must still pass -- the new check must not turn
        every -next-line suppression red, only misplaced ones."""
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(
                tmp, "correctly-placed.md",
                "# T\n\n<!-- why: quoted text, do not restyle -->\n"
                "<!-- markdownlint-disable-next-line MD049 -->\n"
                + BODY_THAT_TRIPS_MD049)
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(code, 0, f"correctly scoped -next-line suppression should PASS, got {code}\n{out}")
            self.assertIn("load-bearing", out)

    def test_a_cold_npx_cache_is_CANNOT_RUN_exit_3_not_a_dead_suppression_verdict(self):
        """THE MUST-FAIL THIS TOOL WAS MISSING. "Removing the suppression
        changes nothing" and "the linter never ran" produce the same empty
        rule set, so a cold machine got a FALSE accusation against a
        genuinely load-bearing suppression, exit 1, blocking the commit --
        and the documented exit-3 path was unreachable, because it detected
        "cannot run" by sniffing for the substring "not found" while the
        real npm message is `ENOTCACHED ... cache mode is 'only-if-cached'`.

        Reproduced here the way it happens: an EMPTY npm cache directory, so
        `npx --offline` really cannot resolve markdownlint-cli2. The SAME
        fixture must pass (0) with a warm cache and report cannot-run (3)
        with a cold one -- never 1."""
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as cold_cache:
            rel = fixture(tmp, "live.md", "# T\n\n<!-- why: quoted text, do not restyle -->\n"
                          "<!-- markdownlint-disable MD049 -->\n\n" + BODY_THAT_TRIPS_MD049)
            warm_code, warm_out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(warm_code, 0, f"fixture precondition: warm cache should PASS\n{warm_out}")

            env = dict(os.environ)
            env["npm_config_cache"] = cold_cache
            proc = subprocess.run(
                [sys.executable, TOOL, "--repo-root", tmp, os.path.join(tmp, rel)],
                capture_output=True, text=True, env=env)
            out = proc.stdout + proc.stderr
            self.assertEqual(
                proc.returncode, 3,
                "a cold npx cache must be CANNOT RUN (3), never a dead-suppression "
                f"verdict (1) against a load-bearing suppression. Got {proc.returncode}:\n{out}")
            self.assertIn("CANNOT RUN", out)
            self.assertNotIn("does not make it fire", out)

    def test_npx_missing_from_PATH_is_CANNOT_RUN_exit_3_not_a_traceback(self):
        """The other cold shape: no npx at all. It used to raise an uncaught
        FileNotFoundError -- a traceback and exit 1, i.e. a FAILURE."""
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(tmp, "live.md", "# T\n\n<!-- why: quoted text, do not restyle -->\n"
                          "<!-- markdownlint-disable MD049 -->\n\n" + BODY_THAT_TRIPS_MD049)
            env = dict(os.environ)
            env["PATH"] = "/nonexistent-bin-dir-for-this-test"
            proc = subprocess.run(
                [sys.executable, TOOL, "--repo-root", tmp, os.path.join(tmp, rel)],
                capture_output=True, text=True, env=env)
            out = proc.stdout + proc.stderr
            self.assertEqual(proc.returncode, 3, f"expected CANNOT RUN (3), got {proc.returncode}:\n{out}")
            self.assertIn("CANNOT RUN", out)
            self.assertNotIn("Traceback", out)

    def test_zero_files_is_not_a_pass(self):
        """The vacuity guard: examining nothing must never look like a
        clean run."""
        with tempfile.TemporaryDirectory() as tmp:
            fixture(tmp, "unused.md", "# T\n")
            code, out = run(tmp, os.path.join(tmp, "plans", "does-not-exist.md"))
            self.assertEqual(code, 2, f"zero files examined must exit 2, got {code}\n{out}")
            self.assertIn("ZERO FILES", out)

    def test_no_suppressions_is_a_real_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            rel = fixture(tmp, "clean.md", "# T\n\n" + BODY_THAT_TRIPS_NOTHING)
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(code, 0, f"clean file should PASS, got {code}\n{out}")
            self.assertIn("no inline suppressions", out)

    def test_the_real_repo_this_file_ships_in_passes(self):
        """If the gate fails a clean, real repo, the gate is wrong.

        This file is VENDORED: it runs in the template's own tree, where
        there are no live suppressions, and in every consumer, where there
        may well be. Both are a pass, and the two print different sentences
        -- so what is asserted is the pass and the non-vacuity (some file
        count reached the output), never the template's own wording, which a
        consumer would fail on for the wrong reason."""
        code, out = run(REPO_ROOT)
        self.assertEqual(code, 0, f"real tree should PASS, got {code}\n{out}")
        self.assertIn("file(s)", out)
        self.assertNotIn("EXAMINED ZERO FILES", out)
        self.assertTrue(
            re.search(r"\b([1-9]\d*) file\(s\)", out),
            "the pass line reports zero files, which proves nothing:\n" + out)

    # --- scope comes from the config's `ignores:`, not from a copy of it.
    # Both directions are asserted, because "no findings" is exactly what a
    # checker that silently examines nothing also prints.

    CONFIG_WITH_FROZEN_IGNORED = """globs:
  - "plans/**/*.md"

ignores:
  - "node_modules/**"
  - "plans/frozen/**"
"""

    CONFIG_WITHOUT_FROZEN_IGNORED = """globs:
  - "plans/**/*.md"

ignores:
  - "node_modules/**"
"""

    # A suppression naming a rule that does NOT fire in this body: dead by
    # any measure, so the gate must report it whenever the file is in scope.
    DEAD_SUPPRESSION_BODY = (
        "# T\n\n"
        "<!-- reason: pinned while the transcript below is re-checked -->\n"
        "<!-- markdownlint-disable MD049 -->\n"
        + BODY_THAT_TRIPS_NOTHING
    )

    @staticmethod
    def _frozen_fixture(tmp, config):
        os.makedirs(os.path.join(tmp, "plans", "frozen"), exist_ok=True)
        with open(os.path.join(tmp, ".markdownlint-cli2.yaml"), "w") as fh:
            fh.write(config)
        rel = os.path.join("plans", "frozen", "archived.md")
        with open(os.path.join(tmp, rel), "w") as fh:
            fh.write(CheckMarkdownlintSuppressionsTest.DEAD_SUPPRESSION_BODY)
        return rel

    def test_scope_control_ignored_file_is_reported_when_not_ignored(self):
        """THE MUST-FAIL CASE. Without this the test below proves nothing:
        a gate that examines no files at all would pass it identically."""
        with tempfile.TemporaryDirectory() as tmp:
            self._frozen_fixture(tmp, self.CONFIG_WITHOUT_FROZEN_IGNORED)
            code, out = run(tmp)
            self.assertEqual(
                code, 1,
                "a dead suppression in an IN-SCOPE file must be reported; "
                f"got exit {code}. If this passes, the scope test below is vacuous.\n{out}")
            self.assertIn("MD049", out)

    def test_scope_suppression_in_an_ignored_file_is_not_reported(self):
        """Same file, same suppression -- only the config's ignores: differ."""
        with tempfile.TemporaryDirectory() as tmp:
            self._frozen_fixture(tmp, self.CONFIG_WITH_FROZEN_IGNORED)
            code, out = run(tmp)
            self.assertEqual(
                code, 2,
                "with the only file ignored, a globbed run examines nothing and "
                f"must say so rather than print a green; got exit {code}\n{out}")
            self.assertIn("ZERO FILES", out)

    def test_scope_named_ignored_file_is_out_of_scope_not_vacuous(self):
        """The pre-commit fragment names staged files. Staging only archived
        records is legitimate and must not be refused -- but it must not
        print a bare pass either."""
        with tempfile.TemporaryDirectory() as tmp:
            rel = self._frozen_fixture(tmp, self.CONFIG_WITH_FROZEN_IGNORED)
            code, out = run(tmp, os.path.join(tmp, rel))
            self.assertEqual(code, 0, f"named out-of-scope file must not refuse the commit, got {code}\n{out}")
            self.assertIn("outside the lint scope", out)

    # round-3 item 2(a): this used to read REPO_ROOT -- the tree this file
    # happens to be running IN -- and assert markdown existed under .claude/
    # and .github/. That is THIS TEMPLATE's own shape, not a property of the
    # tool: a freshly vendored consumer has neither directory, so the exact
    # same assertion went RED everywhere the tool actually landed. Both
    # tests below now build their own scratch tree instead, so what is
    # proven (the config-driven ignore, and the dot-directory walk) holds
    # in the template AND in every consumer, resolved entirely relative to
    # wherever the tree lives.
    IGNORE_SCOPE_CONFIG = """\
globs:
  - "**/*.md"

ignores:
  - "node_modules/**"
  - "plans/records/**"
"""

    @staticmethod
    def _build_ignore_scope_tree(tmp):
        """A synthetic tree exercising the same two properties the old
        real-tree test asked of REPO_ROOT: the walk reaches markdown under
        a dot-directory (files_from_globs uses os.walk, not glob.glob,
        specifically so it does -- see that function's own docstring), and
        the config's `ignores:` -- read from the config, never a second
        hand-copied list -- actually excludes what it names."""
        with open(os.path.join(tmp, ".markdownlint-cli2.yaml"), "w") as fh:
            fh.write(CheckMarkdownlintSuppressionsTest.IGNORE_SCOPE_CONFIG)
        with open(os.path.join(tmp, "root.md"), "w") as fh:
            fh.write("# root\n")
        os.makedirs(os.path.join(tmp, ".dotdir"), exist_ok=True)
        with open(os.path.join(tmp, ".dotdir", "x.md"), "w") as fh:
            fh.write("# under a dot-directory\n")
        os.makedirs(os.path.join(tmp, "plans", "records"), exist_ok=True)
        with open(os.path.join(tmp, "plans", "records", "old.md"), "w") as fh:
            fh.write("# archived record\n")
        os.makedirs(os.path.join(tmp, "node_modules", "pkg"), exist_ok=True)
        with open(os.path.join(tmp, "node_modules", "pkg", "readme.md"), "w") as fh:
            fh.write("# vendored dependency\n")

    def test_scope_real_tree_honours_every_declared_ignore(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._build_ignore_scope_tree(tmp)
            files = supp_mod.files_from_globs(tmp, supp_mod.declared_globs(tmp))
            self.assertTrue(files, "synthetic tree must select SOME files, else this proves nothing")
            self.assertIn("root.md", files)
            for prefix in ("plans/records/", "node_modules/"):
                offenders = [f for f in files if f.startswith(prefix)]
                self.assertEqual(offenders, [], f"{prefix} is in ignores: but was selected: {offenders}")
            # Positive half: dot-directory content this port's os.walk-based
            # rewrite is specifically here to reach (see files_from_globs's
            # docstring -- Python's glob.glob does not descend into these).
            self.assertTrue(
                any(f.startswith(".dotdir/") for f in files),
                "synthetic tree must select markdown under a dot-directory -- if this is "
                "empty, files_from_globs has regressed to glob.glob's dot-directory blind spot")

    def test_negative_control_dot_directory_blind_spot_would_have_been_missed_by_plain_glob(self):
        """Proves test_scope_real_tree_honours_every_declared_ignore above
        is not vacuous: the naive `glob.glob(..., recursive=True)` this
        port replaced really does miss dot-directory content on the SAME
        synthetic tree -- so the assertion it fixed is a real regression
        guard, not a check that would have passed either way."""
        import glob as globmod
        with tempfile.TemporaryDirectory() as tmp:
            self._build_ignore_scope_tree(tmp)
            naive = set(
                os.path.relpath(p, tmp)
                for g in supp_mod.declared_globs(tmp)
                for p in globmod.glob(os.path.join(tmp, g), recursive=True)
                if os.path.isfile(p)
            )
            self.assertFalse(
                any(f.startswith(".dotdir" + os.sep) for f in naive),
                "sanity check failed: glob.glob unexpectedly found .dotdir/ "
                "content -- the blind spot this test guards against may have "
                "changed shape (Python version, glob semantics)",
            )


if __name__ == "__main__":
    unittest.main()
