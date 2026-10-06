#!/usr/bin/env python3
"""vendor-queue-tooling.py — copies this template's shared tooling into a
target repo and records a drift lock so future edits to the copies can be
told apart from a hand-edit.

The queue pipeline is opt-in per docs/decisions-to-make.md item 3 — most
forks of this template never turn it on. This script is how a repo takes the
shared tooling and how it (or CI) later checks that the copies it made have
not silently drifted from what was vendored. That is the GitHub plan pipeline
(the queue tool under tools/queue/ and the seat-guard hooks), plans/SCHEMA.md, the markdown-lint carriage and the push-
then-prove-ancestry helper. `--print-tracked` prints the files a run
overwrites and `--help` lists every TRACKED and STARTER file; no list is
repeated in this docstring.

What gets copied, and how:

  TRACKED files are hashed into .agent-vendor.lock and overwritten on every
  vendor run. tools/vendor-queue-tooling.py vendors itself, so a freshly
  vendored consumer has its own local copy to run and to drift-check, rather
  than silently having none at all. plans/SCHEMA.md comes from its
  templates/ canonical source.

  STARTER files are copied only if the destination does not already
  exist -- NEVER hashed, NEVER overwritten, NEVER re-copied on a later
  run. CLAUDE.md is the one most forks already have from "Use this
  template" and keep as-is. The plan issue and pull request templates are
  STARTER files too, and their source is this template's own live copy (no
  templates/ twin to drift): nothing reads them at runtime, so a consumer's
  edits to them are its own.

  round-3 item 6d: the exact TRACKED/STARTER file lists, and their counts,
  are NOT written out literally here -- a hand-copied second list of what
  TRACKED_MANIFEST / STARTER_MANIFEST (below) already say always drifts the
  moment either changes without a matching prose edit (measured: this
  section once said 11 TRACKED / 5 STARTER while the manifests had already
  grown to 14 and 9). `--help` builds its own listing from those two
  manifests directly at runtime instead (see `_manifest_help_text()`),
  and `--print-tracked` prints the TRACKED destinations for a shell caller
  that needs them without re-reading this docstring at all.

  This manifest is an explicit, hand-maintained list, not a directory glob.
  Repo B's own tools/ has well over a hundred entries; only a handful
  are shared tooling. A glob would leak Repo B-specific ops scripts
  (backups, ingest workers) into every future consumer.

Retiring what an earlier release vendored:

  A file leaves the manifests when this template stops shipping it, but a
  consumer that vendored it earlier still holds a copy nothing will ever
  overwrite. RETIRED_TRACKED_PATHS names every such file that was TRACKED;
  RETIRED_STARTER_SHA256 names the retired STARTER files with the content
  this template ever seeded. A vendor run into a consumer deletes each
  retired file it finds there and names it -- but only when the consumer's
  own .agent-vendor.lock recorded the hash the file still has on disk, so a
  hand-edited copy is never destroyed. A retired TRACKED file whose bytes
  differ from the recorded hash, or that the lock never recorded (or no lock
  at all), STOPS the run with exit 1 naming it, before anything is copied or
  deleted: all or nothing. A retired STARTER was never hashed, so it is
  deleted only when its bytes equal a version this template shipped; a
  customised one is the consumer's own file and is left in place, named,
  without failing the run.

Provenance and the dirty-source guard:

  `upstream_sha` is this template's own `git rev-parse HEAD` at vendor time.
  A worktree's HEAD is always valid — the hazard is not the worktree, it is
  a DIRTY one: if the source files about to be copied differ from HEAD's
  committed content, recording HEAD's sha would describe a commit that does
  not match the bytes actually copied. So this script checks `git status
  --porcelain` scoped ONLY to the tracked source paths (a dirty file
  elsewhere in the template is irrelevant) and refuses to vendor unless
  `--allow-dirty` is passed, in which case the lock records
  `upstream_dirty: true` rather than silently blending the two.

Wiring (read, never written):

  This script never edits a consumer's .claude/settings.json. A successful
  vendor run ends with a `NOT WIRED:` warning on stdout when the consumer's
  committed settings.json does not run the seat guard on every Bash call
  (GUARD_WIRING_COMMAND below); the run still exits 0 and writes its lock.
  `--check` and `--print-tracked` never print it.

`--check` recomputes every tracked file's sha256 against .agent-vendor.lock
and NAMES every missing or drifted file — never stops at the first one.
Three distinct outcomes, three distinct exit codes, because "could not run
this check" and "ran it and found a violation" must never look the same:

    0   every tracked file matches its recorded hash
    1   the lock exists and names one or more missing/drifted files -- OR
        the lock is absent/unusable on a repo that ALREADY shows other
        adoption markers (plans/SCHEMA.md, or a file a past release
        vendored and this one retired, present on disk): that is not
        "never vendored," it is something wrong with a real adoption, and
        must never look like the harmless skip below (critic gap 3/3b — see
        adoption_markers_present()).
    3   there is nothing to check yet — no (or an unusable) .agent-vendor.lock,
        AND no other adoption marker on disk either. This is a SKIP, not a
        pass: a repo that has genuinely not vendored yet must not go red
        for it, but "this proved nothing" must never be printed as "OK".

    Exit code 2 is DELIBERATELY NEVER returned by this script's own logic
    (see main()/argparse below) — it is reserved, because Python and
    argparse already use it for the two ways this script can fail to even
    RUN: `python3 vendor-queue-tooling.py` on a path that does not exist
    (the interpreter's own "can't open file" error) and a bad flag
    (argparse's own usage-error exit). The call site (CI, see
    .github/workflows/agent-config-checks.yml) must therefore map ONLY
    exit 3 to the loud "SKIPPED" line; exit 2 — "this could not even run"
    — is refused with cannot-run wording, same as exit 1, never treated as
    a skip. If 2 and the deliberate skip code were the same number, a
    caller cannot tell "nothing to check yet" (fine) apart from "the
    script itself is missing or was invoked wrong" (not fine, and must
    block the commit / fail the job).

Self-vendoring (this template vendoring into its OWN repo root; phase 3b
item 7, gap 17 -- dogfooding):

  `target_repo == template_root` (compared as absolute paths) is
  self-vendoring, detected by `cmd_vendor()` and recorded as `"self": true`
  in `.agent-vendor.lock`. Every TRACKED_MANIFEST pair then lives in ONE
  tree instead of two, which changes what `--check` must actually verify:

    * For a CONSUMER (`self: false`, the normal case), `--check` compares
      each destination file's hash against the hash `.agent-vendor.lock`
      recorded at the LAST vendor run. There is nothing else to compare
      against -- a consumer has no `templates/` tree of its own.
    * For SELF-vendoring, comparing against the recorded hash ALONE is not
      enough: it would let `templates/plans/SCHEMA.md` (the canonical
      source) drift arbitrarily far from `plans/SCHEMA.md` (its own live
      copy, right next to it in the same repo) between vendor runs, as
      long as neither file's hash happened to still match what was
      recorded at the last run -- exactly backwards from what
      self-vendoring exists to prove. So when `lock["self"]` is true,
      `cmd_check()` runs TWO checks, both must pass:

      (a) each TRACKED source is compared directly against its
          destination, byte for byte, RIGHT NOW (never via the lock).
      (b) each TRACKED destination is ALSO compared against the hash
          `.agent-vendor.lock` recorded at the LAST vendor run (round 3
          item 4a). Check (a) alone is blind to a whole class of drift:
          most TRACKED_MANIFEST entries are IDENTITY pairs (`src_rel ==
          dest_rel`, e.g. `tools/git-safe-push.sh` maps to itself) --
          there is only ONE file on disk, so a file can never
          fail to match itself no matter how it was hand-edited. Only
          the lock's recorded hash, taken at the last vendor run,
          catches that. This was a real, measured gap: this template's
          own lock sat at 11-of-14 recorded files (three TRACKED
          destinations added later were hand-copied into place rather
          than vendored) with `--check` reporting a clean OK the whole
          time, because check (a) alone cannot see a stale or absent
          lock entry.

      Consequences, all deliberate:

      (i)   A commit that edits a canonical source (`templates/plans/
            SCHEMA.md`) WITHOUT its live copy in the same commit is
            REFUSED by check (a): source and destination now differ.
      (ii)  A commit that edits BOTH consistently, OR hand-edits an
            identity-pair file directly, changes the bytes on disk
            without updating what `.agent-vendor.lock` recorded --
            check (b) now REFUSES it too, naming the file and the
            remedy (re-run `tools/vendor-queue-tooling.py` to refresh
            the lock). There is no edit to a TRACKED file, in self
            mode, that can skip a re-vendor and still pass `--check`.
      (iii) An identical-path pair (`src_rel == dest_rel`, e.g.
            `tools/git-safe-push.sh` -> itself, or this script vendoring
            itself) is trivially always equal under check (a) -- there is
            only one file on disk. The pair that differs by path
            (`templates/plans/SCHEMA.md` -> `plans/SCHEMA.md`) is the real
            check-(a) comparison; check (b) covers every TRACKED
            destination regardless of path shape.

  What `upstream_sha` means for a self-vendor run, and why `--check` never
  depends on it: a self-vendored template cannot name its own future
  commit -- the lock is always written and then committed, so by the time
  anyone reads it, HEAD has already moved past the SHA it names (see
  `upstream_sha_means` in the lock itself). `cmd_vendor()` records the
  actual `git rev-parse HEAD` of the template AT VENDOR TIME (the commit
  whose tree held the bytes just copied), not a placeholder such as
  `"self"` -- that value stays genuinely informative provenance (which
  commit these files were vendored from) even though it can never equal
  HEAD after the lock-writing commit lands. Neither branch of `cmd_check()`
  above ever reads `upstream_sha` for pass/fail purposes -- only the
  per-file hashes in `files` decide the exit code -- so this is purely
  documentation, never a hidden dependency `--check` could break on.

  Consumers are entirely unaffected: `lock["self"]` is only ever true for
  a lock written by a self-vendor run, so a consumer's own `--check` keeps
  taking the original, recorded-hash branch. Must-fail coverage for both
  self-check directions above: `tools/tests/test_vendor_queue_tooling.py`.

Usage:
    vendor-queue-tooling.py <target-repo>                    vendor into target-repo
    vendor-queue-tooling.py <target-repo> --allow-dirty       vendor from a dirty template source
    vendor-queue-tooling.py <target-repo> --check             verify target-repo's copies; never writes
    vendor-queue-tooling.py <this-template-root>              self-vendor (target == template root)
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

LOCK_FILENAME = ".agent-vendor.lock"
UPSTREAM_NAME = "agent-ready-template"

# Exit code cmd_check() uses for "nothing to check yet" (absent or unusable
# lock). Deliberately NOT 2 -- see the module docstring's exit-code table.
CHECK_SKIP_EXIT_CODE = 3

# The one form of hook entry that runs the seat guard on every Bash call, the
# way this template's own .claude/settings.json writes it; a mention of the file
# or the repo-relative path would not run it from every working directory.
GUARD_WIRING_COMMAND = 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/gh_write_guard.py'

# A matcher made only of these characters is a list of exact tool names.
_EXACT_TOOL_NAMES_RE = re.compile(r"[A-Za-z0-9_\- ,|]*")

# (path relative to this template's root, path relative to the target repo)
TRACKED_MANIFEST = [
    ("templates/plans/SCHEMA.md", "plans/SCHEMA.md"),
    ("tools/vendor-queue-tooling.py", "tools/vendor-queue-tooling.py"),
    # OWNER RULING (b)'s CARRIAGE. The ruling says this template ships a
    # markdown-lint config with the plans/records/** exemption and its
    # reasoning, the offline-safe hook block, and the suppression checker
    # with a must-fail test. It shipped all of that for ITSELF only: none of
    # it was in either manifest, so for every consumer the ruling was an
    # essay. The MECHANISM is tracked (a consumer must not silently diverge
    # from the checked-in checker, and one fix travelling by hand while
    # another does not is how the ENOTCACHED bug outlived its own fix in a
    # downstream copy); the POLICY -- which rules are on -- is a starter
    # below, because a consumer's rule set is its own.
    ("tools/check-markdownlint-suppressions.py", "tools/check-markdownlint-suppressions.py"),
    ("tools/tests/test_check_markdownlint_suppressions.py",
     "tools/tests/test_check_markdownlint_suppressions.py"),
    (".githooks/lib/markdown_lint.sh", ".githooks/lib/markdown_lint.sh"),
    # OWNER RULING: git-safe-push.sh is the push-then-prove-ancestry
    # mechanism itself (what .claude/hooks/git_guard.py's and the global
    # resource_guard.py's bare-ref denials both point a caller at), not a
    # policy a consumer tunes -- same class as the suppression checker
    # above, so TRACKED, not STARTER. Same-path pair: this template's own
    # tools/git-safe-push.sh is both the canonical source and its own live
    # copy.
    ("tools/git-safe-push.sh", "tools/git-safe-push.sh"),
    # The GitHub pipeline. tools/queue is one set: queue.py exits 2 without
    # schema.json and imports report_rules by path. `gate-pass` judges with
    # report_rules.py and `doctor` requires it, so a seed-once copy would pin
    # an old gate; both hooks are generated files a consumer must not edit.
    ("tools/queue/queue.py", "tools/queue/queue.py"),
    ("tools/queue/check_report.py", "tools/queue/check_report.py"),
    ("tools/queue/report_rules.py", "tools/queue/report_rules.py"),
    ("tools/queue/schema.json", "tools/queue/schema.json"),
    (".claude/hooks/gh_write_guard.py", ".claude/hooks/gh_write_guard.py"),
    (".claude/hooks/pipeline_marker.py", ".claude/hooks/pipeline_marker.py"),
]

# Consumer destinations an earlier release vendored as TRACKED (each hashed
# into that consumer's lock) and this one no longer ships: the YAML queue
# pipeline's tools, their tests, its consumer test runner and its pre-commit
# fragment, and the cloud verifier-gate workflow (the gate is now a commit
# status the verifier posts). See "Retiring what an earlier release vendored" above.
RETIRED_TRACKED_PATHS = [
    "tools/queue/validate-queue.py",
    "tools/queue/check-done-gate.py",
    "tools/queue/migrate-queue.py",
    "tools/queue/render-queue-docs.py",
    "tools/queue/test_validate_queue.py",
    "tools/queue/test_check_done_gate.py",
    "tools/queue/test_migrate_queue.py",
    "tools/queue/test_render_queue_docs.py",
    "tools/queue/run_all.sh",
    ".githooks/pre-commit.queue.sh",
    ".github/workflows/verifier-gate.yml",
]

# Retired STARTER files never had a lock entry, so they are recognised by
# content: every sha256 this template ever seeded for the path.
RETIRED_STARTER_SHA256 = {
    "plans/.doc-targets": (
        "4deb6b585f4fabcd95a4b9c432b5dee304281cd77d49ae3d23612a409b885f1b",
    ),
}

# Copied only when the destination does not already exist. Never hashed,
# never overwritten, never revisited on a later vendor run.
STARTER_MANIFEST = [
    # The old queue's frozen history: the cutover runbook archives its own
    # entry into merged.yaml, so a vendor run must have seeded both.
    ("templates/plans/completed/merged.yaml", "plans/completed/merged.yaml"),
    ("templates/plans/completed/retired.yaml", "plans/completed/retired.yaml"),
    ("templates/plans/README.md", "plans/README.md"),
    # Nothing reads these at runtime, and the live file is the source so no
    # templates/ copy can drift from it.
    (".github/ISSUE_TEMPLATE/plan.md", ".github/ISSUE_TEMPLATE/plan.md"),
    (".github/PULL_REQUEST_TEMPLATE/plan.md", ".github/PULL_REQUEST_TEMPLATE/plan.md"),
    ("templates/CLAUDE.md", "CLAUDE.md"),
    # The records-exemption ruling's POLICY half: which rules are on, and the plans/records/**
    # exemption with its reasoning. A starter, not tracked: a consumer tunes
    # its own rule set, and a tracked config would make every such edit read
    # as drift.
    (".markdownlint-cli2.yaml", ".markdownlint-cli2.yaml"),
    # Without a .githooks/pre-commit and without `git config core.hooksPath
    # .githooks`, none of the gates fire and the failure mode is silence.
    # The starter's own header carries the config command.
    ("templates/githooks/pre-commit", ".githooks/pre-commit"),
    # plans/records/ is where records land, and .markdownlint-cli2.yaml's
    # ignore points at it. Seeded so it is tracked from the first commit.
    ("templates/plans/records/.gitkeep", "plans/records/.gitkeep"),
    ("templates/gitignore", ".gitignore"),
]

def _rel_to_native(rel):
    return os.path.join(*rel.split("/"))


def sha256_file(path):
    """Return the hex SHA-256 digest of the file at `path`."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_head_sha(repo_root):
    """This template's own HEAD, or None if it cannot be determined
    (not a git repo, or git unavailable) — never raises."""
    try:
        result = subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "HEAD"],
            capture_output=True, text=True,
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def git_dirty_paths(repo_root, rel_paths):
    """Which of rel_paths (relative to repo_root) are dirty (staged,
    unstaged, or untracked) per `git status --porcelain`, scoped to exactly
    those paths. Returns None, not [], when git status could not be run at
    all — a caller must not treat "could not check" as "clean"."""
    try:
        result = subprocess.run(
            ["git", "-C", repo_root, "status", "--porcelain", "--"] + list(rel_paths),
            capture_output=True, text=True,
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    dirty = []
    for line in result.stdout.splitlines():
        if len(line) > 3:
            dirty.append(line[3:].strip())
    return dirty


def _recorded_hashes(target_repo):
    """The per-file hashes target_repo's own lock recorded at its last vendor
    run; {} when it has no usable lock -- which makes every retired file look
    unrecorded, the safe reading."""
    try:
        with open(os.path.join(target_repo, LOCK_FILENAME), "r", encoding="utf-8") as handle:
            lock = json.load(handle)
    except (OSError, ValueError):
        return {}
    files = lock.get("files") if isinstance(lock, dict) else None
    return files if isinstance(files, dict) else {}


def plan_retirements(target_repo):
    """What a vendor run into target_repo must do about the retired files it
    holds. Reads only; returns (delete, kept, problems):

      delete    repo-relative paths safe to delete -- a retired TRACKED file
                whose bytes still match the hash the consumer's own lock
                recorded, or a retired STARTER whose bytes equal a version
                this template shipped;
      kept      retired STARTER paths the consumer changed, so they are its
                own and stay;
      problems  why the run must stop: a retired TRACKED file that is not a
                regular file, differs from its recorded hash, or has none.
    """
    recorded = _recorded_hashes(target_repo)
    delete, kept, problems = [], [], []
    for rel in RETIRED_TRACKED_PATHS:
        full = os.path.join(target_repo, _rel_to_native(rel))
        if not os.path.lexists(full):
            continue
        if os.path.islink(full) or not os.path.isfile(full):
            problems.append(rel + ": not a regular file, so it cannot be checked against its recorded hash")
            continue
        expected = recorded.get(rel)
        if not isinstance(expected, str):
            problems.append(
                rel + ": " + LOCK_FILENAME + " records no hash for it, so there is no way to tell "
                "whether it was hand-edited"
            )
        elif sha256_file(full) != expected:
            problems.append(
                rel + ": it differs from the hash " + LOCK_FILENAME + " recorded, so it was hand-edited"
            )
        else:
            delete.append(rel)
    for rel, shipped in RETIRED_STARTER_SHA256.items():
        full = os.path.join(target_repo, _rel_to_native(rel))
        if not os.path.isfile(full):
            continue
        if sha256_file(full) in shipped:
            delete.append(rel)
        else:
            kept.append(rel)
    return delete, kept, problems


def retire_files(target_repo, delete):
    """Delete each path plan_retirements() cleared, naming every one, then
    prune the directories that leaves empty (never a directory with anything
    in it)."""
    root = os.path.abspath(target_repo)
    for rel in delete:
        full = os.path.join(target_repo, _rel_to_native(rel))
        os.remove(full)
        print("retired " + rel + " (unmodified since it was vendored; this template no longer ships it)")
        parent = os.path.dirname(full)
        while os.path.abspath(parent) != root:
            try:
                os.rmdir(parent)
            except OSError:
                break
            parent = os.path.dirname(parent)


def _matcher_selects_bash(matcher):
    """Whether a PreToolUse entry's `matcher` selects the Bash tool, by the
    hooks documentation's own rules: an absent, empty or `*` matcher selects
    every tool; one of only letters, digits, `_`, `-`, spaces, `,` and `|` is a
    list of exact names; anything else is a regex searched against the name.
    Never a substring test: `BashOutput` is not `Bash`."""
    if not isinstance(matcher, str):
        return False
    if matcher == "" or matcher == "*":
        return True
    if _EXACT_TOOL_NAMES_RE.fullmatch(matcher):
        return "Bash" in re.split(r"[|,]", matcher)
    try:
        return re.search(matcher, "Bash") is not None
    except re.error:
        return False


def guard_is_wired(target_repo):
    """True only when the consumer's committed .claude/settings.json holds a
    PreToolUse entry that selects Bash and has an unconditional command hook
    equal to GUARD_WIRING_COMMAND. Reads that one file (never settings.local.json
    or the user's own settings); any malformed shape reads as not wired."""
    try:
        with open(os.path.join(target_repo, ".claude", "settings.json"), "r", encoding="utf-8") as handle:
            settings = json.load(handle)
        entries = settings["hooks"]["PreToolUse"]
        for entry in entries:
            if not isinstance(entry, dict) or not _matcher_selects_bash(entry.get("matcher", "")):
                continue
            for hook in entry.get("hooks", []):
                if (isinstance(hook, dict) and hook.get("type") == "command" and "if" not in hook
                        and isinstance(hook.get("command"), str)
                        and hook["command"].strip() == GUARD_WIRING_COMMAND):
                    return True
    except Exception:
        return False
    return False


def warn_if_guard_unwired(target_repo):
    """Print a NOT WIRED warning with the command to add when `target_repo`'s settings do not run the gh write guard.

    Never edits settings and never changes the exit code.
    """
    if guard_is_wired(target_repo):
        return
    print(
        "NOT WIRED: .claude/hooks/gh_write_guard.py is not run by this repo's committed "
        ".claude/settings.json, so its refusals (gh pr merge --admin, ruleset and "
        "branch-protection writes, the seat rules) never fire. This script does not edit "
        "that file; add this command to the PreToolUse hooks with matcher Bash:"
    )
    print(GUARD_WIRING_COMMAND)


def cmd_vendor(template_root, target_repo, allow_dirty):
    """Copy the tracked and starter files into `target_repo` and write the drift lock.

    Args:
        template_root: Repo root holding the vendoring source.
        target_repo: Repo to vendor into; may equal `template_root`.
        allow_dirty: Vendor from uncommitted template source, recording
            `upstream_dirty: true` in the lock.

    Returns:
        Exit code 0 on success, 1 when refusing (missing source, missing target
        directory, unsafe retirement, or dirty source without `allow_dirty`);
        a refusal copies and writes nothing.
    """
    # Self-vendoring: this template vendoring itself into its own repo root
    # (target_repo == template_root). Recorded in the lock so `--check` can
    # tell it apart from vendoring into a consumer -- see cmd_check()'s own
    # "self" branch and the module docstring's "Self-vendoring" section.
    is_self = os.path.abspath(template_root) == os.path.abspath(target_repo)

    missing_sources = [
        src for src, _dest in TRACKED_MANIFEST
        if not os.path.isfile(os.path.join(template_root, _rel_to_native(src)))
    ]
    if missing_sources:
        print("ERROR: this template's own source is missing expected file(s) -- cannot vendor:")
        for rel in missing_sources:
            print("  " + rel)
        return 1

    if not os.path.isdir(target_repo):
        print("ERROR: target repo directory does not exist: " + target_repo)
        return 1

    retire_delete, retire_kept, retire_problems = plan_retirements(target_repo)
    if retire_problems:
        print(
            "ERROR: refusing to re-vendor: this release no longer ships the file(s) below, "
            "which an earlier release vendored into this repo, and they cannot safely be "
            "deleted. Nothing was copied, deleted or written."
        )
        for problem in retire_problems:
            print("  " + problem)
        print(
            "Restore each file to the bytes " + LOCK_FILENAME + " recorded, or delete it "
            "yourself if the local edit is no longer wanted, then re-run."
        )
        return 1

    source_rel_paths = [src for src, _dest in TRACKED_MANIFEST]
    dirty = git_dirty_paths(template_root, source_rel_paths)
    upstream_dirty = False
    if dirty is None:
        print(
            "WARNING: could not run `git status` against the template source "
            "(not a git repository, or git unavailable) -- vendoring without "
            "a dirty-source guard; upstream_sha may not describe the copied bytes."
        )
    elif dirty:
        if not allow_dirty:
            print(
                "ERROR: refusing to vendor from a dirty template source -- "
                "upstream_sha would name a commit that does not describe the "
                "bytes about to be copied. Dirty path(s):"
            )
            for rel in dirty:
                print("  " + rel)
            print(
                "Commit the template source first, or pass --allow-dirty to "
                "vendor anyway (the lock will record upstream_dirty: true)."
            )
            return 1
        upstream_dirty = True
        print("WARNING: vendoring from a dirty template source (--allow-dirty). Dirty path(s):")
        for rel in dirty:
            print("  " + rel)

    upstream_sha = git_head_sha(template_root)
    if upstream_sha is None:
        print(
            "WARNING: could not determine the template's git HEAD -- "
            "recording upstream_sha as null."
        )

    retire_files(target_repo, retire_delete)
    for rel in retire_kept:
        print(
            "left " + rel + " in place (this template no longer uses it, but its content is "
            "not what this template shipped, so it is yours to delete)"
        )

    files_map = {}
    for src_rel, dest_rel in TRACKED_MANIFEST:
        src = os.path.join(template_root, _rel_to_native(src_rel))
        dest = os.path.join(target_repo, _rel_to_native(dest_rel))
        dest_dir = os.path.dirname(dest)
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)
        if os.path.abspath(src) != os.path.abspath(dest):
            # copy2, not copyfile: the mode bit matters (see the starter loop
            # below, where a non-executable seeded hook is silently ignored).
            shutil.copy2(src, dest)
        files_map[dest_rel] = sha256_file(dest)
        print("vendored " + dest_rel)

    seeded = 0
    kept = 0
    for src_rel, dest_rel in STARTER_MANIFEST:
        dest = os.path.join(target_repo, _rel_to_native(dest_rel))
        if os.path.exists(dest):
            kept += 1
            print("kept existing " + dest_rel + " (starter file is never overwritten)")
            continue
        # A `.gitkeep` exists for exactly one reason: to make an otherwise
        # empty directory tracked. Seeding one into a directory that already
        # holds real content adds a file whose own text ("delete this once
        # the directory holds real records") is already false on arrival.
        if os.path.basename(dest_rel) == ".gitkeep":
            holder = os.path.dirname(dest)
            if os.path.isdir(holder) and os.listdir(holder):
                kept += 1
                print("skipped starter " + dest_rel + " (" + os.path.dirname(dest_rel)
                      + " already holds content; a .gitkeep would be pointless there)")
                continue
        src = os.path.join(template_root, _rel_to_native(src_rel))
        dest_dir = os.path.dirname(dest)
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)
        # copy2, not copyfile: the mode bit matters. A seeded
        # .githooks/pre-commit that is not executable is IGNORED by git,
        # with nothing but a hint on stderr -- every gate silently off.
        shutil.copy2(src, dest)
        seeded += 1
        print("seeded starter " + dest_rel)

    lock = {
        "upstream": UPSTREAM_NAME,
        # WHAT upstream_sha MEANS: the commit whose tree held the bytes that
        # were copied. It is NOT "the commit this lock is part of", and it
        # cannot be: writing the lock and committing it necessarily moves
        # HEAD past the commit it names. A report claiming upstream_sha ==
        # HEAD after a self-vendor commit is claiming something structurally
        # impossible.
        "upstream_sha_means": "the content of the vendored files as of this upstream commit",
        "upstream_sha": upstream_sha,
        "upstream_dirty": upstream_dirty,
        "self": is_self,
        "files": files_map,
    }
    lock_path = os.path.join(target_repo, LOCK_FILENAME)
    with open(lock_path, "w", encoding="utf-8") as handle:
        json.dump(lock, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(
        "vendored " + str(len(files_map)) + " tracked file(s); seeded " + str(seeded)
        + " starter file(s) (" + str(kept) + " already present, left untouched); retired "
        + str(len(retire_delete)) + " file(s); wrote " + LOCK_FILENAME
    )
    warn_if_guard_unwired(target_repo)
    return 0


def adoption_markers_present(target_repo):
    """True if target_repo LOOKS like it already adopted the vendored tooling
    -- i.e. this is not a repo that "simply never vendored," the one case
    CHECK_SKIP_EXIT_CODE (3) exists to describe without failing a required
    status check over nothing to verify. Checked independently of the lock
    file itself (a missing or corrupt lock is exactly the failure mode this
    guards against): plans/SCHEMA.md, or any file a past release vendored and
    this one retired, being present on disk is enough. A repo with none of
    them really has never vendored, and 3 (skip) is correct for it.

    WHERE EXIT 3 IS ACTUALLY REACHABLE: from CI, on a fork that carries this
    script but has not vendored (or has removed the vendored files).
    """
    for rel in ["plans/SCHEMA.md"] + RETIRED_TRACKED_PATHS:
        if os.path.isfile(os.path.join(target_repo, _rel_to_native(rel))):
            return True
    return False


def cmd_check(target_repo):
    """Verify `target_repo`'s vendored files against its lock; never writes.

    Returns:
        Exit code 0 when every file matches, 1 on drift, a missing file, or a
        missing or unparseable lock in a repo that already adopted the tooling,
        and `CHECK_SKIP_EXIT_CODE` when the repo never vendored, which proves
        nothing about drift.
    """
    lock_path = os.path.join(target_repo, LOCK_FILENAME)

    if not os.path.isfile(lock_path):
        if adoption_markers_present(target_repo):
            print(
                "FAIL: " + LOCK_FILENAME + " is missing at " + lock_path + ", but this repo "
                "already carries adopted queue-tooling files (plans/SCHEMA.md, or a file a past "
                "release vendored and this one retired). This is NOT the same as a "
                "repo that simply never vendored -- something removed or never committed the "
                "lock a real adoption should have written. Re-vendor with "
                "'python3 tools/vendor-queue-tooling.py .' to regenerate it, or restore it, "
                "before this can pass."
            )
            return 1
        print("SKIPPED: no " + LOCK_FILENAME + " at " + lock_path)
        print(
            "This repo has not vendored the queue tooling yet -- there is "
            "nothing to verify. This is a skip, not a pass: it proves "
            "nothing about drift."
        )
        return CHECK_SKIP_EXIT_CODE

    try:
        with open(lock_path, "r", encoding="utf-8") as handle:
            lock = json.load(handle)
    except (OSError, ValueError) as exc:
        if adoption_markers_present(target_repo):
            print(
                "FAIL: " + lock_path + " could not be parsed as JSON (" + str(exc) + "), but "
                "this repo already carries adopted queue-tooling files. A corrupt lock in an "
                "already-adopted repo must never look like the harmless 'never vendored' case "
                "-- re-vendor with 'python3 tools/vendor-queue-tooling.py .' to regenerate it."
            )
            return 1
        print("SKIPPED: " + lock_path + " could not be parsed as JSON: " + str(exc))
        print("Treating it as unusable, not as a recorded pass. This proves nothing about drift.")
        return CHECK_SKIP_EXIT_CODE

    files = lock.get("files") if isinstance(lock, dict) else None
    if not isinstance(files, dict) or not files:
        if adoption_markers_present(target_repo):
            print(
                "FAIL: " + lock_path + " has no non-empty \"files\" map, but this repo already "
                "carries adopted queue-tooling files. Re-vendor with "
                "'python3 tools/vendor-queue-tooling.py .' to regenerate a real lock."
            )
            return 1
        print("SKIPPED: " + lock_path + " has no non-empty \"files\" map -- nothing recorded to verify.")
        return CHECK_SKIP_EXIT_CODE

    is_self = bool(lock.get("self")) if isinstance(lock, dict) else False

    if is_self:
        # SELF-VENDORING: target_repo IS the template's own repo root, so
        # every TRACKED_MANIFEST pair lives in ONE tree. Comparing each
        # destination's hash against a hash recorded at the LAST vendor run
        # (the consumer branch below) would let templates/plans/SCHEMA.md
        # (the canonical source) drift arbitrarily far from plans/SCHEMA.md
        # (its live copy) between vendor runs, as long as neither one's
        # hash happened to match what was recorded -- exactly backwards
        # from what self-vendoring needs to prove. So --check instead
        # compares each TRACKED source directly against its destination,
        # byte for byte, right now, ignoring the recorded per-file hashes
        # entirely for this comparison:
        #
        #   (i)   a commit that edits a canonical source (templates/plans/
        #         SCHEMA.md) WITHOUT its live copy in the same commit is
        #         REFUSED -- source and destination now differ.
        #   (ii)  a commit that edits BOTH consistently no longer passes
        #         immediately by itself: the byte-for-byte comparison right
        #         here does pass, but the LOCK CHECK below this block (item
        #         4a) now also runs and compares every TRACKED destination
        #         against .agent-vendor.lock's recorded per-file hash, so an
        #         edit that was not followed by a re-vendor leaves that hash
        #         stale and --check fails there instead, naming the file and
        #         "stale lock entry" as the remedy. A same-commit consistent
        #         edit needs a re-vendor (re-run this script against the
        #         template root) before --check passes, exactly like any
        #         other TRACKED change.
        #   (iii) an identical-path pair (src_rel == dest_rel, e.g.
        #         tools/git-safe-push.sh -> itself, or this script vendoring
        #         itself) is trivially always equal -- there is only one
        #         file. The pair that actually differs by path
        #         (templates/plans/SCHEMA.md -> plans/SCHEMA.md) is the real
        #         check.
        #
        # Consumers (is_self False) are unaffected: they take the branch
        # below unchanged, comparing against the RECORDED hash, because a
        # consumer repo has no templates/ tree of its own to compare against.
        problems = []
        real_pairs = []       # src_rel != dest_rel: an actual comparison
        identity_entries = [] # src_rel == dest_rel: one file, nothing to compare
        for src_rel, dest_rel in TRACKED_MANIFEST:
            src_full = os.path.join(target_repo, _rel_to_native(src_rel))
            dest_full = os.path.join(target_repo, _rel_to_native(dest_rel))
            if src_rel == dest_rel:
                identity_entries.append(dest_rel)
            else:
                real_pairs.append(dest_rel)
            if not os.path.isfile(dest_full):
                problems.append("missing: " + dest_rel)
                continue
            if not os.path.isfile(src_full):
                problems.append("canonical source missing: " + src_rel + " (destination " + dest_rel + " has nothing to be checked against)")
                continue
            if sha256_file(src_full) != sha256_file(dest_full):
                problems.append(
                    "drifted (canonical source differs from its vendored copy): "
                    + dest_rel + " (source: " + src_rel + ")"
                )

        if problems:
            for problem in problems:
                print(problem)
            print(
                "FAIL: " + str(len(problems)) + " self-vendored file(s) missing or drifted "
                "from their canonical templates/ source. Re-run "
                "tools/vendor-queue-tooling.py to re-vendor and refresh " + LOCK_FILENAME + "."
            )
            return 1

        # THE LOCK ITSELF IS ALSO CHECKED (round 3 item 4a). The byte-for-byte
        # comparison above catches SOURCE and DESTINATION disagreeing, but it
        # is blind to a whole class of drift: most TRACKED_MANIFEST entries
        # are IDENTITY pairs (src_rel == dest_rel, e.g.
        # tools/git-safe-push.sh maps to itself) -- there is only ONE
        # file on disk, so "comparing" it to itself can never detect a
        # hand-edit that was never re-vendored. The lock's recorded hash,
        # taken at the LAST vendor run, is the only record of "what this file
        # looked like when it was last reviewed as vendored" -- so --check
        # must also confirm every TRACKED destination still matches what the
        # lock recorded, and that every TRACKED destination is actually
        # present in the lock at all (a file added to TRACKED_MANIFEST and
        # hand-copied into place, the way this happened for real here, must
        # not silently pass just because source and destination happen to
        # agree). A stale hash or a missing tracked file is a FAIL naming the
        # exact file and the remedy, never a silent "provenance note" -- that
        # softer wording is exactly what let this template's own lock sit at
        # 11-of-14 stale entries with --check reporting OK the whole time.
        remedy = "re-run 'python3 tools/vendor-queue-tooling.py " + target_repo + "' to refresh " + LOCK_FILENAME
        lock_problems = []
        for _src_rel, dest_rel in TRACKED_MANIFEST:
            dest_full = os.path.join(target_repo, _rel_to_native(dest_rel))
            if dest_rel not in files:
                lock_problems.append(
                    "not recorded in " + LOCK_FILENAME + ": " + dest_rel
                    + " (a TRACKED file with no lock entry yet -- " + remedy + ")"
                )
                continue
            if not os.path.isfile(dest_full):
                lock_problems.append(
                    "missing: " + dest_rel + " (" + LOCK_FILENAME + " records a hash for it "
                    "but it is absent on disk -- " + remedy + ")"
                )
                continue
            actual = sha256_file(dest_full)
            if actual != files[dest_rel]:
                lock_problems.append(
                    "stale lock entry: " + dest_rel + " (the hash " + LOCK_FILENAME
                    + " recorded at the last vendor run no longer matches the file on "
                    "disk -- " + remedy + ")"
                )

        if lock_problems:
            for problem in lock_problems:
                print(problem)
            print(
                "FAIL: " + str(len(lock_problems)) + " tracked file(s) missing or stale "
                "against " + LOCK_FILENAME + "'s recorded hash. " + remedy + "."
            )
            return 1

        # SAY WHAT WAS ACTUALLY COMPARED. Most TRACKED entries have src ==
        # dest in self mode (tools/git-safe-push.sh maps to itself),
        # so "N file(s) match" counted a file agreeing with itself as a
        # check. Only the pairs whose paths DIFFER are a comparison; the
        # rest are one file, and the only thing checkable about them is that
        # they exist. Reporting them as matches is the kind of green nobody
        # earned.
        print(
            "OK: " + str(len(real_pairs)) + " canonical->live pair(s) compared byte for "
            "byte and matching (" + ", ".join(sorted(real_pairs)) + ")."
        )
        print(
            "     " + str(len(identity_entries)) + " further tracked file(s) are the SAME "
            "path in both places, so there is nothing to compare -- only their presence "
            "was checked. Their content is gated by this repo's own review, not by this "
            "check."
        )
        print(
            "     " + str(len(files)) + " tracked file(s) also verified against "
            + LOCK_FILENAME + "'s recorded hash (this is what catches a hand-edit to an "
            "identity-pair file, which the byte comparison above cannot see)."
        )
        return 0

    problems = []
    for rel in sorted(files):
        expected = files[rel]
        full = os.path.join(target_repo, _rel_to_native(rel))
        if not os.path.isfile(full):
            problems.append("missing: " + rel)
            continue
        actual = sha256_file(full)
        if actual != expected:
            problems.append("drifted (hash mismatch): " + rel)

    if problems:
        for problem in problems:
            print(problem)
        print(
            "FAIL: " + str(len(problems)) + " vendored file(s) missing or drifted from "
            + LOCK_FILENAME + ". Re-run tools/vendor-queue-tooling.py to re-vendor, "
            "or investigate the hand-edit before committing."
        )
        return 1

    print("OK: " + str(len(files)) + " vendored file(s) match " + LOCK_FILENAME + ".")
    return 0


def _manifest_help_text():
    """Build the TRACKED/STARTER file listing for --help FROM the manifests
    themselves, at call time -- never a hand-copied second list (round 3
    item 6d). Counts are `len(...)`, never a literal number, so this can
    never say "11" while the manifest holds 14."""
    lines = [
        "",
        f"TRACKED ({len(TRACKED_MANIFEST)} files -- hashed into .agent-vendor.lock, "
        "overwritten on every vendor run):",
    ]
    for _src, dest in TRACKED_MANIFEST:
        lines.append("    " + dest)
    lines.append("")
    lines.append(
        f"STARTER ({len(STARTER_MANIFEST)} files -- copied only if missing; "
        "never hashed, never overwritten):"
    )
    for _src, dest in STARTER_MANIFEST:
        lines.append("    " + dest)
    return "\n".join(lines)


def main(argv):
    """Vendor the queue tooling into a repo, or with `--check` verify it.

    Args:
        argv: Command-line arguments, without the program name.

    Returns:
        Exit code from `cmd_vendor` or `cmd_check`; 0 for `--print-tracked`.
    """
    parser = argparse.ArgumentParser(
        description=__doc__ + "\n" + _manifest_help_text(),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--print-tracked", action="store_true",
        help="print each TRACKED destination path, one per line, and exit 0. For "
             "shell callers that need to enumerate what a consumer receives without "
             "hand-keeping a second copy of the manifest.",
    )
    parser.add_argument(
        "target_repo",
        help="path to the repo to vendor the queue tooling into, or (with --check) to verify",
    )
    parser.add_argument(
        "--check", action="store_true",
        help="verify target-repo's vendored files against its .agent-vendor.lock; never writes",
    )
    parser.add_argument(
        "--template-root", default=None,
        help="this template's own repo root, the vendoring source "
             "(default: parent of this script's directory)",
    )
    parser.add_argument(
        "--allow-dirty", action="store_true",
        help="vendor even if the template's own source files are uncommitted; "
             "the lock records upstream_dirty: true instead of a trustworthy sha",
    )
    args = parser.parse_args(argv)

    if args.print_tracked:
        for _src, dest in TRACKED_MANIFEST:
            print(dest)
        return 0

    target_repo = os.path.abspath(args.target_repo)

    if args.check:
        return cmd_check(target_repo)

    if args.template_root:
        template_root = os.path.abspath(args.template_root)
    else:
        template_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    return cmd_vendor(template_root, target_repo, allow_dirty=args.allow_dirty)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
