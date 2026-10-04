# .githooks/lib/markdown_lint.sh -- staged-markdown lint + inline-suppression
# check, meant to be SOURCED from this repo's own .githooks/pre-commit (not
# run standalone). Written in PORTABLE POSIX sh -- no arrays, no `local`,
# no `[[ ]]`, no here-strings -- so the one canonical copy is sourceable
# from a `#!/bin/sh` hook as well as a bash one.
# It was bash-only, which is why a downstream repo with an sh hook kept its own
# hand-copied duplicate of this block; the two then drifted, and a fix landed
# in one of them and not the other.
#
# Expects `repo_root` to already be set by the sourcing script.
# `staged_paths_for_gate` is still set by older hooks but is no longer read
# (the fragment derives its own ACMR list).
#
# WHY STAGED FILES ONLY, NOT THE WHOLE TRACKED SET: linting everything on
# every commit -- including commits that touch no markdown at all -- is
# exactly the kind of slow, over-broad hook that gets disabled, which
# checks nothing for anyone from then on.
#
# WHY `npm exec --offline` AS THE AVAILABILITY PROBE, rather than checking
# for node_modules: this template has no package.json at all, so
# `markdownlint-cli2` is never a local install -- "installed" here
# genuinely means "resolvable without a network round trip", which is
# exactly what `--offline` tests: it answers from npm's local cache
# (~/.npm/_npx, shared across every worktree on this machine) and fails
# FAST -- no socket opened -- when nothing is cached.
#
# A MISSING LINTER MUST BE LOUD but must NOT block a legitimate commit --
# the alternative (blocking) makes this repo unusable for doc-only work on
# a machine that has never run `npx markdownlint-cli2` with network. CI
# (.github/workflows/agent-config-checks.yml) always has network and is the
# actual backstop for a commit this hook could not check.
# Its own ACMR list, not the hook's `staged_paths_for_gate`: consumers pass
# ACMRD on purpose for their deletion guards, and markdownlint-cli2 opens the
# WORKING-TREE file, so a deleted path would crash with ENOENT reported as a
# lint failure. A bare assignment (no pipe, no `|| true`) so a git failure
# aborts the hook loudly.
staged_acmr=$(git -C "$repo_root" diff --cached --name-only --diff-filter=ACMR)
staged_md_files=$(printf '%s\n' "$staged_acmr" | grep -E '\.md$' || true)
if [ -n "$staged_md_files" ]; then
	# Still needed: ACMR can name a path removed from disk after it was staged.
	# An if body, not `[ ] && printf`: dash and bash --posix inherit `set -e`
	# into `$(...)`, and a loop whose last test fails aborts the sourcing hook.
	staged_md_files=$(printf '%s\n' "$staged_md_files" | while IFS= read -r f; do
		if [ -n "$f" ] && [ -f "$repo_root/$f" ]; then
			printf '%s\n' "$f"
		fi
	done)
fi
if [ -n "$staged_md_files" ]; then
	if [ "${SKIP_MARKDOWN_LINT:-0}" = "1" ]; then
		printf '%s\n' 'SKIPPED: markdownlint-cli2 did NOT run (SKIP_MARKDOWN_LINT=1). This staged markdown was not checked; this proved nothing.' >&2
	elif ! npm exec --offline --package=markdownlint-cli2 -c 'exit 0' >/dev/null 2>&1; then
		printf '%s\n' '' >&2
		printf '%s\n' 'MARKDOWN LINT SKIPPED: markdownlint-cli2 is not available offline here' >&2
		printf '%s\n' '  (no cached copy in ~/.npm/_npx, none in node_modules), and this hook will' >&2
		printf '%s\n' '  not reach out to the network on every commit to fetch it.' >&2
		printf '%s\n' '  This commit was NOT checked against .markdownlint-cli2.yaml -- the same' >&2
		printf '%s\n' '  config .github/workflows/agent-config-checks.yml enforces in CI. CI will' >&2
		printf '%s\n' '  be the first place a violation in this staged markdown surfaces.' >&2
		printf '%s\n' '  Run `npx markdownlint-cli2` once anywhere on this machine (needs network)' >&2
		printf '%s\n' '  to warm the shared cache and get local checking back in every worktree.' >&2
	else
		# `.markdownlint-cli2.yaml`'s own `globs:`/`ignores:`/`config:` still
		# apply -- `--no-globs` only replaces the FILE-DISCOVERY glob list
		# with our own staged-file list.
		# POSITIONAL PARAMETERS, NOT A BASH ARRAY. This fragment is sourced
		# by whatever pre-commit a repo has, and a real downstream one is
		# `#!/bin/sh` -- an array here made the canonical copy unsourceable
		# exactly where it was most needed, so that repo kept a hand-copied
		# duplicate of this block instead, and the two drifted. A hook has no
		# positional parameters of its own, so consuming them is safe; the
		# `while ... done < <heredoc>` form runs in the CURRENT shell (not a
		# subshell, as a pipe would), so what it sets survives the loop.
		set --
		while IFS= read -r f; do
			[ -n "$f" ] && set -- "$@" ":$f"
		done <<MARKDOWN_LINT_STAGED_EOF
$staged_md_files
MARKDOWN_LINT_STAGED_EOF
		md_lint_status=0
		( cd "$repo_root" && npx --offline markdownlint-cli2 --no-globs -- "$@" ) || md_lint_status=$?
		if [ "$md_lint_status" -ne 0 ]; then
			printf '%s\n' '' >&2
			printf '%s\n' 'COMMIT REFUSED: markdownlint-cli2 found issues in staged markdown (above).' >&2
			printf '%s\n' '  Fix them, or bypass deliberately with SKIP_MARKDOWN_LINT=1 git commit ...' >&2
			exit 1
		fi
	fi
fi

# --- inline lint suppressions must earn themselves. The config turns
# several rules off repo-wide, each with a reason, reviewed in one place. An
# inline `<!-- markdownlint-disable MDxxx -->` is invisible from the config
# and unchecked without this: it must be scoped to named rules, carry a
# reason comment, and -- the part that matters -- still be load-bearing.
# tools/check-markdownlint-suppressions.py STRIPS the suppression, re-lints
# the real file, and requires the named rules to actually fire. A
# suppression that suppresses nothing looks exactly like one doing real
# work.
#
# Exit 3 means "could not run" (markdownlint not resolvable offline) and
# warns without blocking, matching how the lint block above treats the same
# condition. Exit 1 (a real failure) and exit 2 (examined zero files) both
# refuse the commit.
if [ -n "$staged_md_files" ]; then
	if [ "${SKIP_MARKDOWN_LINT:-0}" = "1" ]; then
		printf '%s\n' 'SKIPPED: check-markdownlint-suppressions.py did NOT run (SKIP_MARKDOWN_LINT=1). Inline suppressions were not verified load-bearing; this proved nothing.' >&2
	else
		set --
		while IFS= read -r f; do
			[ -n "$f" ] && set -- "$@" "$f"
		done <<MARKDOWN_SUPP_STAGED_EOF
$staged_md_files
MARKDOWN_SUPP_STAGED_EOF
		supp_status=0
		python3 "$repo_root/tools/check-markdownlint-suppressions.py" \
			--repo-root "$repo_root" "$@" || supp_status=$?
		if [ "$supp_status" = "3" ]; then
			printf '%s\n' '' >&2
			printf '%s\n' 'SUPPRESSION CHECK SKIPPED: it needs markdownlint to prove a' >&2
			printf '%s\n' '  suppression is still load-bearing, and markdownlint is not' >&2
			printf '%s\n' '  resolvable offline here. CI remains the backstop.' >&2
		elif [ "$supp_status" != "0" ]; then
			printf '%s\n' '' >&2
			printf '%s\n' 'COMMIT REFUSED: inline markdownlint suppression problem (above).' >&2
			exit 1
		fi
	fi
fi
