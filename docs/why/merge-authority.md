# Why: agents merge to main, the owner promotes to release

Behind [AGENTS.md §13](../../AGENTS.md).

## The owner asked repeatedly and the answer kept being "ask first", 2026-10-11

The owner stated, several times and in several repos, that agents may merge verified pull
requests into the default branch and that only promotion to `release` needs a decision.
Nothing in `AGENTS.md` said so. The server side never objected: the default-branch ruleset
requires a pull request, zero approvals and no status check, so a merge was always
permitted. What stopped it was silence in the instructions. An agent with no written
authority reads a merge as an outward-facing action and defers, and the author thread that
wrote the work correctly declined to merge it, which left a verified pull request waiting
for a human who had already delegated the decision.

The separation that remains is the one in §6: the verifier merges, the author does not. The
`release` ruleset keeps its one required approval, which is the owner's gate.

## A ruleset check does not stop a merge made with the owner's token, 2026-10-12

A vendoring repo whose main ruleset required `verifier-gate` saw an agent merge go through
with the check never run: the merge used the owner's account, and the Admin role is on the
ruleset's bypass list in pull-request mode, so GitHub cannot tell the agent from the owner.
This template's own main ruleset requires no status check at all (pull request, no
force-push, no deletion), so its merges of PR 125 and PR 126 had nothing to skip. Either
way the verifier step is held by the agent, not by GitHub, so §13 names the steps the
merging agent runs itself and marks them `[stated]`. Removing Admin from the bypass list
would make GitHub hold it, but also changes how the owner merges, so it stays the owner's
decision.

## Thread pull requests could not reach the gate at all, 2026-10-25

The rule as written on 2026-10-12 required `queue ship --check` and `gate-pass` before every
agent merge. Pull requests from the plan queue met it. Pull requests opened by project
threads in cloud sessions never could: `ship --check` refuses a body with no plan issue, and
a cloud session's proxy refuses the commit status `gate-pass` posts. So every such pull
request, verified or not, waited for the owner (sku-scanner #88 was merged by hand; #90 was
verified PASS on 2026-10-23 and still open two days later), which is the outcome the 10-11
ruling existed to end. The owner chose, 2026-10-25, to keep the judge and drop the stamp
for those cases: the verifier's report is judged offline by `origin/main`'s
`report_rules.py`, which needs only `gh` reads, and the merge is pinned to the judged head.
The status was never what held the line here, since an owner-token merge bypasses it.
