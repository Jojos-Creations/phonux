#!/usr/bin/env python3
"""Tests for shell_text.invocations_only -- the invoked-vs-quoted splitter.

Each STRIP case is a shape that has actually produced a false deny in a
command-inspecting hook (see shell_text.py's own docstring). Each KEEP case
is something that must stay detectable, including the regression case where
an over-broad fix once ate a real, quoted operand.

Uses unittest assertions throughout, never a bare `assert` -- `python -O`
compiles bare asserts away, which would make this suite pass by not
checking anything.
"""
import importlib.util
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "shell_text_under_test", HOOKS_DIR / "shell_text.py")
shell_text = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell_text)
invocations_only = shell_text.invocations_only
mentions_only = shell_text.mentions_only


class TestHeredocBodiesAreStripped(unittest.TestCase):
    def test_heredoc_body_mentioning_a_command_is_stripped(self):
        cmd = "python3 - <<'PY'\nprint('git worktree add /tmp/x -b br main')\nPY"
        self.assertNotIn("worktree", invocations_only(cmd))

    def test_commit_message_heredoc_is_stripped(self):
        cmd = "git commit -q -F - <<'MSG'\nfix: speed up the cargo test runs\nMSG"
        self.assertNotIn("cargo", invocations_only(cmd))

    def test_opener_line_tail_survives_the_strip(self):
        # Only the BODY is data; a pipe or redirect on the opener line is
        # real shell and must survive.
        cmd = "cat <<'EOF' | tr -d x\nsecret body\nEOF\n"
        scan = invocations_only(cmd)
        self.assertIn("| tr -d x", scan)
        self.assertNotIn("secret body", scan)


class TestScriptArgumentsAreStripped(unittest.TestCase):
    def test_python_dash_c_script_text_is_stripped(self):
        cmd = "python3 -c 'import os; os.system(\"cargo test\")'"
        self.assertNotIn("cargo", invocations_only(cmd))

    def test_node_dash_e_script_text_is_stripped(self):
        cmd = 'node -e "require(\'child_process\').exec(\'git push origin main\')"'
        self.assertNotIn("push origin main", invocations_only(cmd))


class TestEchoAndPrintfAreStripped(unittest.TestCase):
    def test_echo_argument_describing_a_command_is_stripped(self):
        cmd = 'echo "run cargo test before pushing"'
        self.assertNotIn("cargo", invocations_only(cmd))

    def test_printf_argument_is_stripped(self):
        cmd = "printf 'sleep 300 then retry\\n'"
        self.assertNotIn("sleep 300", invocations_only(cmd))


class TestSearchPatternsAreStripped(unittest.TestCase):
    def test_grep_pattern_is_stripped(self):
        cmd = "grep -n 'cargo test' build.rs"
        self.assertNotIn("cargo", invocations_only(cmd))

    def test_pgrep_pattern_is_stripped(self):
        cmd = "pgrep -f 'backup-tier1' | wc -l"
        self.assertNotIn("backup-tier1", invocations_only(cmd))


class TestJsonPayloadsAreStripped(unittest.TestCase):
    def test_json_payload_carrying_a_poll_loop_is_stripped(self):
        cmd = ('{"tool_name":"Bash","tool_input":'
               '{"command":"while kill -0 $B; do sleep 9; done"}}')
        self.assertNotIn("sleep", invocations_only(cmd))


class TestRealInvocationsStayDetectable(unittest.TestCase):
    def test_real_command_survives(self):
        cmd = "cd project && cargo test --bin x"
        self.assertIn("cargo", invocations_only(cmd))

    def test_real_worktree_add_survives(self):
        cmd = "git worktree add /tmp/scratch/wt -b br main"
        self.assertIn("worktree", invocations_only(cmd))

    def test_regression_quoted_variable_operand_survives(self):
        # An earlier, over-broad version of this idea stripped "$WT" here,
        # leaving the commit-ish to be misread as the target path.
        cmd = 'git worktree add --detach "$WT" 0a67bb58'
        self.assertIn('"$WT"', invocations_only(cmd))

    def test_regression_quoted_path_operand_survives(self):
        cmd = 'git worktree add "/tmp/scratch/wt-x" -b br main'
        self.assertIn("/tmp/scratch/wt-x", invocations_only(cmd))

    def test_real_sleep_survives(self):
        cmd = "sleep 60; ls"
        self.assertIn("sleep", invocations_only(cmd))

    def test_push_with_explicit_refspec_survives(self):
        cmd = "git push origin HEAD:refs/heads/main"
        self.assertIn("refs/heads/main", invocations_only(cmd))


class TestEdgeCases(unittest.TestCase):
    def test_empty_command_returns_empty_string(self):
        self.assertEqual(invocations_only(""), "")

    def test_none_command_returns_empty_string(self):
        self.assertEqual(invocations_only(None), "")

    def test_command_with_nothing_to_strip_is_unchanged(self):
        cmd = "ls -la /tmp"
        self.assertEqual(invocations_only(cmd), cmd)

    def test_mentions_only_returns_the_masked_scan_when_something_was_stripped(self):
        # UPDATED (ship-hooks-load-and-foreground draft, 2026-09-13) for the
        # wholesale shell_text.py replacement from claude-config's promoted
        # 841-line version. mentions_only's semantics genuinely changed
        # upstream, not just its line count: the OLD template-only version
        # returned the DATA regions that were removed, joined by newlines;
        # the new upstream version returns invocations_only(command)'s own
        # MASKED output when it differs from the input, and the raw command
        # unchanged otherwise -- see shell_text.py's own mentions_only
        # docstring. Confirmed nothing in this repo calls mentions_only
        # (grep across .claude/hooks/*.py, tests excluded) so this is a
        # test-only update, not a behavior change for any shipped hook.
        cmd = 'echo "cargo test"'
        self.assertNotIn("cargo test", mentions_only(cmd))
        self.assertNotIn("cargo test", invocations_only(cmd))
        self.assertEqual(mentions_only(cmd), invocations_only(cmd))

    def test_mentions_only_equals_command_when_nothing_stripped(self):
        # UPDATED for the same reason as the test above: the new upstream
        # mentions_only returns the ORIGINAL command (not "") when
        # invocations_only made no change.
        cmd = "ls -la /tmp"
        self.assertEqual(mentions_only(cmd), cmd)

    def test_commit_message_argument_is_data_not_invocation(self):
        # A commit message describing a rule names the command the rule is
        # about; that is prose, not an invocation.
        cmd = 'git commit -m "docs: warn against git push origin main"'
        scan = invocations_only(cmd)
        self.assertNotIn("push origin main", scan)
        self.assertIn("git commit", scan)

    def test_commit_message_mentioning_wildcard_add_is_data(self):
        cmd = 'git commit -m "chore: stop running git add -A in CI"'
        self.assertNotIn("add -A", invocations_only(cmd))


if __name__ == "__main__":
    unittest.main()
