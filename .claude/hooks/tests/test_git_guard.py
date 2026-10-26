#!/usr/bin/env python3
"""Tests for git_guard.py -- allow and deny cases for all five rules.

Each rule gets at least one ALLOW and one DENY case, per this repo's own
rule that a guard test suite with only allow cases passes when the guard is
broken. Repos are built fresh under a temp directory per test; nothing here
touches this template repo's own git state.
"""
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "git_guard_under_test", HOOKS_DIR / "git_guard.py")
git_guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(git_guard)


def _run_git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True)


def _init_repo(path, branch="main"):
    """A one-commit repo on `branch`, HEAD pointed there before the first
    commit so the branch name is exact on every git version (no reliance on
    init.defaultBranch or a post-hoc rename)."""
    _run_git(path, "init", "-q")
    _run_git(path, "symbolic-ref", "HEAD", "refs/heads/%s" % branch)
    _run_git(path, "config", "user.email", "test@example.com")
    _run_git(path, "config", "user.name", "Test")
    (Path(path) / "README.md").write_text("hello\n")
    _run_git(path, "add", "README.md")
    _run_git(path, "commit", "-q", "-m", "initial commit")


class GitGuardTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="git-guard-test-")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        _init_repo(self.tmp)

    def make_dirty(self):
        (Path(self.tmp) / "README.md").write_text("changed\n")

    def make_untracked(self):
        (Path(self.tmp) / "scratch.txt").write_text("new\n")


class TestPushBareRef(GitGuardTestCase):
    def test_deny_bare_ref_push(self):
        reason = git_guard.check("git push origin main", self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn("no explicit refspec", reason)
        # The denial must point at the actual remedy script, not just the
        # manual git incantation -- a caller who never learns the script
        # exists keeps hand-rolling the fragile form this rule exists to
        # replace. Mirrors the global resource_guard.py's two-path message.
        self.assertIn("tools/git-safe-push.sh", reason)
        self.assertIn("~/.claude/tools/git-safe-push.sh", reason)

    def test_allow_explicit_refspec_push(self):
        reason = git_guard.check(
            "git push origin HEAD:refs/heads/main", self.tmp)
        self.assertIsNone(reason)

    def test_allow_dry_run_push(self):
        reason = git_guard.check("git push --dry-run origin main", self.tmp)
        self.assertIsNone(reason)

    def test_allow_push_with_no_remote_argument(self):
        # `git push` alone (using the configured upstream) is not the
        # "origin <name>" shape this rule targets.
        reason = git_guard.check("git push", self.tmp)
        self.assertIsNone(reason)

    def test_deny_survives_heredoc_noise_around_it(self):
        cmd = (
            "cat <<'NOTE'\nreminder: review before pushing\nNOTE\n"
            "git push origin main"
        )
        reason = git_guard.check(cmd, self.tmp)
        self.assertIsNotNone(reason)

    def test_allow_when_push_only_mentioned_in_heredoc(self):
        cmd = "cat <<'NOTE'\ndo not run: git push origin main\nNOTE\n"
        reason = git_guard.check(cmd, self.tmp)
        self.assertIsNone(reason)


class TestForcePushToDefaultBranch(GitGuardTestCase):
    def test_deny_force_push_to_default_branch_explicit_ref(self):
        # Explicit refspec so this exercises rule 5, not rule 1.
        reason = git_guard.check(
            "git push --force origin HEAD:refs/heads/main", self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn("default branch", reason)

    def test_deny_force_push_current_branch_with_no_ref(self):
        reason = git_guard.check("git push --force origin", self.tmp)
        self.assertIsNotNone(reason)

    def test_allow_force_push_to_feature_branch(self):
        reason = git_guard.check(
            "git push --force origin HEAD:refs/heads/feature/x", self.tmp)
        self.assertIsNone(reason)

    def test_allow_force_with_lease_to_default_branch(self):
        # --force-with-lease already refuses on a moved remote; not blocked.
        reason = git_guard.check(
            "git push --force-with-lease origin HEAD:refs/heads/main",
            self.tmp)
        self.assertIsNone(reason)

    def test_allow_dry_run_force_push_to_default_branch(self):
        reason = git_guard.check(
            "git push --dry-run --force origin HEAD:refs/heads/main",
            self.tmp)
        self.assertIsNone(reason)

    def test_allow_branch_name_whose_last_segment_matches_default(self):
        # Regression: a naive "take the text after the last slash" extractor
        # would misread "refs/heads/feature/main" as branch "main" and deny
        # a push to a DIFFERENT branch that merely ends in "/main".
        reason = git_guard.check(
            "git push --force origin HEAD:refs/heads/feature/main", self.tmp)
        self.assertIsNone(reason)


class TestDirtyBranchMove(GitGuardTestCase):
    def test_deny_checkout_dash_b_when_dirty(self):
        self.make_dirty()
        reason = git_guard.check("git checkout -b feature", self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn("uncommitted changes", reason)

    def test_deny_switch_when_dirty(self):
        self.make_dirty()
        reason = git_guard.check("git switch -c other", self.tmp)
        self.assertIsNotNone(reason)

    def test_deny_when_untracked_file_present(self):
        self.make_untracked()
        reason = git_guard.check("git checkout main", self.tmp)
        self.assertIsNotNone(reason)

    def test_allow_checkout_when_clean(self):
        reason = git_guard.check("git checkout -b feature", self.tmp)
        self.assertIsNone(reason)

    def test_allow_checkout_restore_file_form_even_when_dirty(self):
        self.make_dirty()
        reason = git_guard.check("git checkout -- README.md", self.tmp)
        self.assertIsNone(reason)

    def test_allow_worktree_add_outside_repo_even_when_dirty(self):
        self.make_dirty()
        outside = tempfile.mkdtemp(prefix="git-guard-outside-")
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        target = str(Path(outside) / "wt-feature")
        reason = git_guard.check(
            "git worktree add %s -b feature main" % target, self.tmp)
        self.assertIsNone(reason)


class TestWorktreeAddInsideRepo(GitGuardTestCase):
    def test_deny_worktree_add_target_inside_repo(self):
        reason = git_guard.check(
            "git worktree add ./scratch/wt -b feature main", self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn("inside the repo", reason)

    def test_allow_worktree_add_target_outside_repo(self):
        outside = tempfile.mkdtemp(prefix="git-guard-outside-")
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        target = str(Path(outside) / "wt-feature")
        reason = git_guard.check(
            "git worktree add %s -b feature main" % target, self.tmp)
        self.assertIsNone(reason)

    def test_allow_when_target_is_unresolved_variable(self):
        # Cannot resolve "$WT" without executing the shell -- must not guess.
        reason = git_guard.check(
            'git worktree add --detach "$WT" main', self.tmp)
        self.assertIsNone(reason)


class TestAddAll(GitGuardTestCase):
    def test_deny_add_dash_capital_a(self):
        reason = git_guard.check("git add -A", self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn("Stage explicit paths", reason)

    def test_deny_add_dot(self):
        reason = git_guard.check("git add .", self.tmp)
        self.assertIsNotNone(reason)

    def test_deny_add_dash_dash_all(self):
        reason = git_guard.check("git add --all", self.tmp)
        self.assertIsNotNone(reason)

    def test_allow_add_specific_path(self):
        reason = git_guard.check("git add src/module.py", self.tmp)
        self.assertIsNone(reason)

    def test_allow_add_mentioned_only_in_commit_message_heredoc(self):
        cmd = "git commit -F - <<'MSG'\nran git add -A locally, reverted\nMSG"
        reason = git_guard.check(cmd, self.tmp)
        self.assertIsNone(reason)

    def test_allow_add_mentioned_only_in_dash_m_commit_message(self):
        cmd = 'git commit -m "chore: stop running git add -A in CI"'
        self.assertIsNone(git_guard.check(cmd, self.tmp))

    def test_deny_add_all_inside_a_subshell(self):
        # The closing paren fuses onto the flag token; without stripping it,
        # `-A)` is not `-A` and the rule silently does not fire.
        reason = git_guard.check("(cd docs && git add -A)", self.tmp)
        self.assertIsNotNone(reason)

    def test_deny_add_all_inside_command_substitution(self):
        self.assertIsNotNone(git_guard.check("$(git add -A)", self.tmp))

    def test_deny_add_dot_slash(self):
        self.assertIsNotNone(git_guard.check("git add ./", self.tmp))

    def test_deny_add_dash_u(self):
        # -u stages every modified tracked file: the same shared-index
        # hazard as -A, with a smaller radius.
        self.assertIsNotNone(git_guard.check("git add -u", self.tmp))

    def test_deny_add_repo_root_pathspec(self):
        self.assertIsNotNone(git_guard.check("git add :/", self.tmp))

    def test_deny_add_quoted_star(self):
        self.assertIsNotNone(git_guard.check("git add '*'", self.tmp))


class TestRemoteNamesOtherThanOrigin(GitGuardTestCase):
    """A remote is whatever the first non-flag token is. Recognising only
    `origin` and `upstream` left `git push fork main` -- the same stale-ref
    push -- allowed in silence."""

    def test_deny_bare_ref_push_to_a_differently_named_remote(self):
        reason = git_guard.check("git push fork main", self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn("no explicit refspec", reason)

    def test_deny_force_push_to_default_branch_via_other_remote(self):
        # Explicit refspec, so rule 1 is satisfied and rule 5 is what has
        # to catch this.
        reason = git_guard.check(
            "git push --force myremote HEAD:refs/heads/main", self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn("force push", reason)

    def test_allow_explicit_refspec_push_to_other_remote(self):
        reason = git_guard.check(
            "git push fork HEAD:refs/heads/main", self.tmp)
        self.assertIsNone(reason)


class TestDashCTargetsAnotherTree(GitGuardTestCase):
    """`git -C <dir>` operates on <dir>, so every rule must judge <dir> --
    not the session's own cwd, which is a different tree with a different
    dirtiness."""

    def setUp(self):
        super().setUp()
        self.other = tempfile.mkdtemp(prefix="git-guard-other-")
        self.addCleanup(shutil.rmtree, self.other, ignore_errors=True)
        _init_repo(self.other)

    def test_allow_dash_c_move_when_the_target_tree_is_clean(self):
        self.make_dirty()  # THIS tree is dirty; the -C target is not
        reason = git_guard.check(
            "git -C %s checkout -b feature" % self.other, self.tmp)
        self.assertIsNone(reason)

    def test_deny_dash_c_move_when_the_target_tree_is_dirty(self):
        (Path(self.other) / "README.md").write_text("changed\n")
        reason = git_guard.check(
            "git -C %s checkout -b feature" % self.other, self.tmp)
        self.assertIsNotNone(reason)
        self.assertIn(self.other, reason)


class TestCheckoutExemptionIsScopedToItsOwnCommand(GitGuardTestCase):
    """A `--` belonging to a LATER command must not exempt an earlier
    HEAD-moving checkout. `git commit --only -- <paths>` is the form this
    repo's own rules prescribe, so the two rules used to cancel each other
    in the most likely command an agent writes."""

    def test_deny_checkout_dash_b_followed_by_commit_only(self):
        self.make_dirty()
        reason = git_guard.check(
            "git checkout -b feature && git commit --only -- README.md",
            self.tmp)
        self.assertIsNotNone(reason)

    def test_deny_checkout_followed_by_log_with_pathspec(self):
        self.make_dirty()
        reason = git_guard.check(
            "git checkout main && git log -- README.md", self.tmp)
        self.assertIsNotNone(reason)

    def test_allow_file_restore_form_even_when_dirty(self):
        self.make_dirty()
        reason = git_guard.check("git checkout -- README.md", self.tmp)
        self.assertIsNone(reason)


class TestNonGitCommandsAreUntouched(GitGuardTestCase):
    def test_allow_non_git_command(self):
        reason = git_guard.check("ls -la && npm test", self.tmp)
        self.assertIsNone(reason)


class TestHelperFunctions(GitGuardTestCase):
    def test_default_branch_detects_main(self):
        self.assertEqual(git_guard.default_branch(self.tmp), "main")

    def test_default_branch_falls_back_to_master(self):
        tmp2 = tempfile.mkdtemp(prefix="git-guard-master-")
        self.addCleanup(shutil.rmtree, tmp2, ignore_errors=True)
        _init_repo(tmp2, branch="master")
        self.assertEqual(git_guard.default_branch(tmp2), "master")

    def test_is_dirty_false_on_clean_repo(self):
        self.assertFalse(git_guard.is_dirty(self.tmp))

    def test_is_dirty_true_after_modification(self):
        self.make_dirty()
        self.assertTrue(git_guard.is_dirty(self.tmp))


class TestMainEntrypoint(unittest.TestCase):
    """End-to-end: stdin JSON in, hookSpecificOutput JSON (or nothing) out."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="git-guard-main-")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        _init_repo(self.tmp)

    def _run_hook(self, payload_text):
        return subprocess.run(
            [sys.executable, str(HOOKS_DIR / "git_guard.py")],
            input=payload_text, capture_output=True, text=True, timeout=15)

    def test_denies_bare_push_via_stdin(self):
        payload = json.dumps({
            "hook_event_name": "PreToolUse",
            "cwd": self.tmp,
            "tool_input": {"command": "git push origin main"},
        })
        proc = self._run_hook(payload)
        self.assertEqual(proc.returncode, 0)  # decision travels via JSON
        out = json.loads(proc.stdout)
        self.assertEqual(
            out["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_allows_clean_command_via_stdin(self):
        payload = json.dumps({
            "hook_event_name": "PreToolUse",
            "cwd": self.tmp,
            "tool_input": {"command": "git status"},
        })
        proc = self._run_hook(payload)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "")

    def test_fails_open_on_malformed_stdin(self):
        proc = self._run_hook("not json at all")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
