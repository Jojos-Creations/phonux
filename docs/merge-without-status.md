# Merging when no status can be posted

The merge rule in [CLAUDE.md](../CLAUDE.md) ("Agents merge verified pull requests into
main") has two routes to a merge into main. Where `gh` can post a commit status and the pull
request names a plan issue, the verifier agent's own steps apply: `queue ship --check`, then
`queue gate-pass`, then the pinned merge. This page is the other route, for the two cases
that route cannot serve:

- **A cloud session.** Its proxy refuses the commit-status write `gate-pass` makes.
- **A pull request with no plan issue**, such as one a project thread opened. `ship --check`
  refuses any body without a `## Entry` naming `Closes #n`.

The judge is the same in both routes: `tools/queue/report_rules.py` from `origin/main`,
applied to the newest COMMENT-type review on the pull request. Only the status write and the
plan trailers are dropped. The merging agent is still a verifier that did not write the
change.

## 1. Post the verifier report as a COMMENT review on the audited sha

The body is the same fenced `verifier-report` block the verifier agent posts. With no plan
issue, use `"issue": 0` and `"entries_audited": []`. `bullets_expected` and the length of
`evidence_checked` must both equal the number of numbered bullets under `Evidence required:`
in the pull request body's `## Brief`. A body with no such list counts 0, so both are `0` and
`[]`, and `gate_rerun` carries the proof.

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
gh api repos/{owner}/{repo}/pulls/<pr> --jq .body > body.txt
python3 tools/queue/report_rules.py gate --head <sha> --reviews reviews.json --pr-body body.txt
```

Write `reviews.json` and `body.txt` outside the repo. Only `{"ok": true, "reason": "ok"}`
with exit 0 earns the merge. Exit 1 names the rule that failed; exit 2 means an input could
not be read, which proves nothing.

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

The route was first run in sku-scanner from a cloud session: `gh` reads of reviews and bodies
work there, and the judge returned `{"ok": true}` for sku-scanner #93, which carries a PASS
review on its head, and `no COMMENTED review found on the PR` for sku-scanner #90, whose
verifier left a plain comment instead: the positive and negative controls for step 2. This
repo's `tools/queue/report_rules.py` and `schema.json` were byte-identical to sku-scanner's
and agent-ready-template's on that date, so the same judge applies here.
