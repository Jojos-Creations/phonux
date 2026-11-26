# Merging when no status can be posted

[AGENTS.md §13](../AGENTS.md) has two routes to a merge into main. Where `gh` can post a
commit status and the pull request names a plan issue, the verifier agent's own steps
apply: `queue ship --check`, then `queue gate-pass`, then the pinned merge. This page is the
other route, for the two cases that route cannot serve:

- **A cloud session.** Its proxy refuses the commit-status write `gate-pass` makes.
- **A pull request with no plan issue**, such as one a project thread opened. `ship --check`
  refuses any body without a `## Entry` naming `Closes #n`.

The judge is the same in both routes: `tools/queue/report_rules.py` from `origin/main`,
applied to the newest COMMENT-type review on the pull request that carries a
`verifier-report` fence and whose author login is on the allowlist (a later comment without
a fence, such as "nit: typo", is skipped; a later report of any verdict from an allowed
login governs). Only the status write and the plan trailers are dropped. The merging agent
is still a verifier that did not write the change (§6).

The allowlist is the `verifier_logins:` list in `.claude/coordinator-config.yaml` beside the
judge, so from a checkout level with `origin/main` it is main's. Anyone can post a review on
a public repo, so a review by any other login is dropped before "newest" is chosen: a
stranger's PASS never counts, and never replaces a real FAIL. No list, or an empty one,
refuses every pull request. The login is the whole check, on purpose: GitHub reports the
organization owner's own reviews on an org repo as `author_association: CONTRIBUTOR`, so do
not add an OWNER/MEMBER/COLLABORATOR requirement, which would refuse every real review there.

A pull request whose head is in another repository (a fork) is refused unless it carries the
`owner-approved-fork` label, which only an account with triage rights can add.

A PASS needs all of these, each refused with its own reason:

- the review's author login is allowed, and the pull request is not an unlabelled fork;
- the verdict is `PASS` and `audited_sha` equals the head;
- the review carries a `commit_id` and it equals the head;
- `gate_rerun` is not empty and every entry's `exit_code` is `0`;
- `scope_ok` is `true` and `gaps` is empty;
- every `evidence_checked` entry has `"status": "PASS"`;
- `bullets_expected`, the length of `evidence_checked` and the count of bullets under
  `Evidence required:` agree.

It does not read the entries' `note` text or re-run anything: whether the evidence is true
is the verifier's job, and the judge only refuses a report that does not claim a full pass.

## 1. Post the verifier report as a COMMENT review on the audited sha

The body is the same fenced `verifier-report` block the verifier agent posts. With no plan
issue, use `"issue": 0` and `"entries_audited": []`. `bullets_expected` and the length of
`evidence_checked` must both equal the number of bullets (`1.`, `-` or `*`) under
`Evidence required:` in the pull request body's `## Brief`. A body with no such list counts
0, so both are `0` and `[]`, and `gate_rerun` carries the proof: it must still hold the
gate command with exit code 0.

A COMMENT review, never an approval: GitHub refuses an approval on one's own pull request.
From a cloud session use the GitHub review tool with `event: COMMENT` and
`commitID: <sha>`; elsewhere `gh pr review <pr> --comment --body-file <report>`.

## 2. Judge it with main's judge

From a checkout level with `origin/main`, because the judge and its `schema.json` must be
main's, not the pull request's:

```bash
set -euo pipefail
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
gh api repos/{owner}/{repo}/pulls/<pr>/reviews --paginate --slurp \
  | python3 -c 'import json,sys; print(json.dumps([r for p in json.load(sys.stdin) for r in p]))' > reviews.json
gh api repos/{owner}/{repo}/pulls/<pr> > pr.json
python3 tools/queue/report_rules.py gate --head <sha> --reviews reviews.json --pr pr.json
```

Write `reviews.json` and `pr.json` outside the repo, and fetch them unfiltered: the judge
reads each review's `user.login`, and the pull request's `head.sha`, `head.repo`,
`base.repo`, `labels` and `body`. Only `{"ok": true, "reason": "ok"}` with exit 0 earns the
merge. Exit 1 names the rule that failed; exit 2 means an input could not be read, which
proves nothing.

Judging a consumer repo's pull request from the template's checkout reads the template's
`verifier_logins`. When the consumer's verifier posts under a login not listed there, pass
it instead with `--allowed-reviewer <login>` (repeatable; it replaces the list), read from
the consumer's own `origin/main` config, never from the pull request.

`<sha>` is the pull request's head as read now. If it differs from `audited_sha` in the
report, the judge refuses, and that refusal is correct: the head moved after the audit.

## 3. Merge pinned to that sha, then prove it landed

```bash
gh pr merge --merge --match-head-commit <sha> <pr>
```

Or the GitHub merge tool with `merge_method: merge` and `expectedHeadSha: <sha>`. Never
`--admin`. Then read the pull request back: it must read merged, and its merge commit must
be an ancestor of `origin/main` (`git merge-base --is-ancestor <merge-sha> origin/main` after
a fetch). A tool's success message is not that proof.

## Checked on 2026-10-25

From a cloud session, `gh` reads of reviews and bodies work. The judge returned
`{"ok": true}` for one consumer-repo pull request that carries a PASS review on its head, and
`no COMMENTED review found on the PR` for another, whose verifier left a plain
comment instead: the positive and negative controls for step 2.
