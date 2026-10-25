# phonux

The library's own rules. phonux-app, the app that uses it, is a separate repository.

## Plans

Plans are GitHub issues with the `plan` label in this repository, and accepted work is a pull
request (`pipeline: github` in `.claude/coordinator-config.yaml`); `python3 tools/queue/queue.py`
is the only writer of a plan body. See `plans/README.md`; the config holds the gate.

## Agents merge verified pull requests into main (owner, 2026-10-11)

Rule 13 of agent-ready-template's `AGENTS.md`, carried here because this repo has no `AGENTS.md`. A pull
request into `main` that a separate verifier has passed is merged by the agent, without asking the owner first
and without waiting for a reply. The author never merges its own work: a verifier that did not write the
change does. Never ask "may I merge?", never leave a passed pull request open for permission, never use
`--admin`. Before the merge, main's own judge passes the verifier's PASS review on the exact head: `queue ship
--check` then `gate-pass` where `gh` can post a status; in a cloud session or on a pull request with no plan
issue, `report_rules.py gate` from `origin/main` printing `"ok": true`
([steps](docs/merge-without-status.md)). Then pin that head (`--match-head-commit`, or `expectedHeadSha` on
the merge tool): a merge under the owner's token passes the ruleset even when a required check never ran.
Promoting to the `release` branch is the only merge that needs the owner's approval, and a brief cannot sign
for it.

## Comments

Comments say why: a constraint the code cannot show. Clean as you touch: when your work on a file is verified, cut that file's comments to this standard in its own commit. Files you did not touch are out of scope.

- Delete provenance (ticket or queue ids, dates, "before this file existed"). Git history and CHANGELOG.md already hold it.
- Past-bug stories go in CHANGELOG.md or the commit message, leaving at most a one-line pointer.
- Keep a real constraint as 1-2 lines on the line it governs, or make it a test.
- Design notes go in DESIGN.md, never in a link to an outside tracker.

Doc comments are different: every export from `index.ts` or `fakeHost.ts` carries a TSDoc `/** */` comment, which
API Extractor reads into `etc/*.api.md` (an export without one shows `// (undocumented)` there). A doc comment says
what a consumer may rely on, never why the code is built that way. Rules and the tag set: `DESIGN.md` "Doc comments".

Put this rule in any brief you give a subagent.

## Lint

`npm run lint` (Biome, `biome.json`) is part of the gate and fails on warnings. Fix the line rather than adding
a suppression. Formatting is not enforced. `useExhaustiveDependencies` is off until its hits are fixed one by one,
because each fix changes when an effect re-runs. Python here is vendored from agent-ready-template and linted
there.
