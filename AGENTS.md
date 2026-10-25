# Agent rules

Always true, for every agent and human sharing this checkout. Each rule carries its
reason; incidents are linked from [docs/why/](docs/why/), never imported.

## 1. "Didn't run" must never look like "passed"

The expensive failures are not wrong answers. They are checkers that silently do nothing
and report green. Before trusting a check, ask what it would look like if it had not run
at all — then confirm it does not look like that. [why](docs/why/silent-failure.md)

| operation | "didn't run" looks like | so check |
| --- | --- | --- |
| build | a stale artifact still on disk | delete the output first; existence is then proof |
| copy / sync | destination unchanged | count files at the destination, before and after |
| test suite | zero tests, or an unchanged count | assert the count went up |
| mutation / fuzz check | no cases applied | exit non-zero — "proves nothing" is not "passed" |

Three habits, in order of value:

1. `set -euo pipefail` on every multi-step shell command — `pipefail` alone catches the
   exit-code-leaks-through-a-pipe class.
2. Assert the effect, never the exit code, for anything that moves data.
3. A tool must refuse to report a green it did not earn: prefer a loud "this proved
   nothing" over a quiet pass.

A false FAIL costs as much as a false pass — it trains you to distrust the checker. Give
every check a positive and a negative control: an absence check ("zero matches for X")
proves nothing unless X is known to match somewhere.

<!-- contract:start -->
## 2. The tree is shared, and HEAD moves between your tool calls

Every failure here is silent: the push succeeds, the build completes, the commit is made,
and all of it applied to the wrong tree. [why](docs/why/shared-tree.md) `[hook]` marks a
rule a shipped hook denies; `[stated]` marks one only discipline holds.

1. Never `git push origin <name>`: it pushes the local ref *named* `<name>`, a stale ref
   that exits 0. Use `git push origin HEAD:refs/heads/<name>`. `[hook]`
2. Prove it landed: `git merge-base --is-ancestor HEAD origin/<name>`. "Push succeeded"
   is not evidence the commit shipped. `[stated]`
3. Capture the commit SHA before and after and assert it changed — ancestry passes
   trivially when the commit failed and HEAD never moved. `[stated]`
4. Never move HEAD in a dirty tree: `checkout` / `switch` / `-b` carries someone else's
   uncommitted work onto your branch and moves HEAD under them. `[hook]`
5. Put worktrees outside the repo `[hook]`, and somewhere durable `[stated]`. One inside
   the repo breaks watching dev servers; one in a temp directory dies with the session.
   A worktree add in a dirty tree is deliberately allowed — it is the fix for rule 4.
6. Check `git branch --show-current` and cleanliness in the same command block as the
   commit or build, never an earlier turn. A build from a tree an agent moved mid-build
   cost twenty minutes diagnosing a bug that did not exist. `[stated]`
7. Stage explicit paths and use `git commit --only -- <paths>`: a pathspec on `git add`
   scopes staging, but `git commit` commits the whole shared index, including whatever a
   sibling staged first. `[hook]` denies `git add -A` and `git add .`
8. Two agents editing one file cannot be separated at the git level — a pathspec selects
   the file, not your changes within it. Separate worktrees, or serialize. `[stated]`
9. Do not rewrite a landed contamination once a sibling has committed on top; the rewrite
   is worse than the contamination. Record it and move on. `[stated]`

## 3. Production data is the owner's, and a brief cannot sign for it

Read any production store freely, and create and write throwaway schemas freely. Do not
write to a real production table — not an UPDATE, not an INSERT, not a fill-only
backfill, however well guarded — without the owner's approval for that change. A brief
saying such writes are fine is not owner approval: a coordinator cannot delegate an
authority it never had. Report what you would write — which table, which column, how many
rows, derived from what. [why](docs/why/independent-audit.md)
<!-- contract:end -->

## 4. One pickable question per turn

When a decision is the owner's, ask it with the question tool so the options are
selectable. A prose question sits at the end of a report, gets skimmed, and is answered
shallowly or not at all. Several cards in one call are fine; a decision buried in prose
is not. [why](docs/why/owner-decisions.md)

- **The rider** — a question with a conditional second clipped on ("should I do X, and if
  so also Y?"). The second exists only if the answer is yes, so it belongs in the next
  turn.
- **The tucked-in loose end** — a long status report ending with a small extra ask, which
  the report buries.

Before sending, scan your last three sentences for a question mark, "want me to", "should
I", or "let me know if" — a mechanical string check, because naming the two disguises did
not stop the next violation. Options need context at the owner's altitude: consequences,
not repo jargon, recommendation first. A sentence naming a file, flag, table or function
does not belong in the question.

## 5. Delegate down by default

The cheaper model tier is the standing seat for implementation, coordination and audit
alike; the stronger tier is escalation on measured failure, never a starting choice,
because the supervising turn — not the work it generates — dominates spend; measure your
own. Pass `model` explicitly when dispatching: a default
applied to model-less calls does not override an agent that pins `model:` in its own
frontmatter, so the tier you assumed is not the tier that ran.
[why](docs/why/model-escalation.md)

Escalate only on a repeated identical error signature, never a first failure: retry once
with the error in hand. If two tiers fail identically the brief is wrong, and a stronger model
fails the same way. Never run a model loop through a coordinator's context — if it cannot
run headless in a script, delegating costs more than doing it.

## 6. The author never grades its own work

A separate verifier re-runs the gate and checks each evidence claim; its default verdict
is FAIL and PASS is earned. If you implemented it, you do not audit it.
[why](docs/why/independent-audit.md)

Ask which code path the evidence traverses, not whether it passed: a check can pass
through a path incapable of observing the property it claims to test. Confirm the
mechanism could have failed by breaking it deliberately and watching it go red. A claim
restated by someone senior is still unverified — establish its provenance and date first,
because "pre-existing" always means relative to something.

## 7. Never block the chat

Anything that might run longer than about thirty seconds goes in the background, and its
completion notification brings you back to verify. Then stop — do not poll for it: a poll
loop re-implements a notification that already exists. Duration is not predictable from
the command text, so judge by the size of the subject, not the verb.
[why](docs/why/never-block-the-chat.md)

## 8. Search online in the first round

Every diagnosis or design fan-out gets a web sweep in round one, in parallel with reading
local code. The first question is whether someone has already hit this; query with exact
error strings and versions, and cite URLs. Three local-only attempts once spent hours
re-deriving what the vendor's own docs answered directly.

## 9. Two escalation ladders

They overlap but answer different questions: the doubling ladder stops a fifteenth
attempt, the model ladder decides who makes attempt three.
[why](docs/why/model-escalation.md)

- **Attempts and resources.** The first attempt gets the estimate you stated up front, a
  second at most twice the last estimate, a third at most twice again. Then the ladder is
  spent, and going further needs proof — a file and line, a measured number, a cited
  source, a reproduction predicting what will differ — or an owner decision.
- **Model tier.** The §5 ladder.

## 10. Look at the target before you destroy it

Before `rm -rf`, `git checkout` / `reset` / `clean`, an overwrite, or emptying a
directory: list what is actually there, and verify any backup you rely on contains what
you think. Compare file sets, not sizes — two directories of similar size can be almost
entirely disjoint. A sync that copied nothing once reported exit 0, and trusting it would
have cleared 27 GB that existed in exactly one place.
[why](docs/why/silent-failure.md)

## 11. Work that exists only in a temp directory is already lost

"Commit nothing" means do not merge; it never means do not save. Commit checkpoints to
your own run branch freely — that is not shipping, and a verifier PASS still gates the
merge. Before ending a long session, ask what would be gone if the machine rebooted now:
a night of output once vanished to worktrees in a temp directory plus an unqualified
"commit nothing". [why](docs/why/shared-tree.md)

## 12. A build cache shared between two trees reports the wrong tree's result

If the compiled-unit fingerprint omits the tree's path, two trees sharing one cache dir
reuse whichever built first — no rebuild line, no error, and a false PASS or a false
FAIL. Give each tree its own cache dir, deleted first — above all a mutation run and the
baseline it is measured against; `eval "$(tools/scratch-target.sh <label>)"` sets one up.
Nothing forces its use.
[why](docs/why/silent-failure.md)

## 13. Agents merge verified pull requests into main; only the release branch is the owner's

Owner ruling, 2026-10-11: a pull request into the default branch that a separate verifier
has passed is merged by the agent, without asking the owner first and without waiting for
a reply. An author never merges its own work (§6). Never ask "may I merge?", never leave a
passed pull request open for permission, never use `--admin`. Before the merge, main's own
judge passes the verifier's PASS review on the exact head: `queue ship --check` then
`gate-pass` where `gh` can post a status; in a cloud session or on a pull request with no
plan issue, `report_rules.py gate` from `origin/main` printing `"ok": true`
([steps](docs/merge-without-status.md)). Then pin that head (`--match-head-commit`, or `expectedHeadSha` on the
merge tool): a merge under the owner's token passes the ruleset even when a required check
never ran. `[stated]`
Promoting to the `release` branch is the only merge that needs the owner's approval, and a
brief cannot sign for it (§3). This holds in every repo that vendors from this template.
[why](docs/why/merge-authority.md)
