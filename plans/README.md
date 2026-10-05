# Plans

Plans in this repo are GitHub issues and pull requests, not files. An issue
with the `plan` label is a candidate and holds its own research; accepting it
opens a draft pull request whose body becomes the record; the verifier re-runs
the gate, posts a review naming the exact commit it checked, and on PASS merges
the pull request, which closes the issue. A finished plan is a merged pull
request, or a closed issue if it was retired. [SCHEMA.md](SCHEMA.md) in this
directory is the body-shape reference for those issue and pull request bodies
-- read it before filing an entry.

The marker `pipeline: github` in `.claude/coordinator-config.yaml` says this
repo is on that pipeline, and `python3 tools/queue/queue.py` is the only
sanctioned writer of a plan body.

## The queue tool

`python3 tools/queue/queue.py [--repo-root .] <verb>`. The verbs:

| verb | what it does |
| --- | --- |
| `stub` | file a new plan issue (label `plan`, default priority `p3`); `--touches` and `--evidence` fill its Touches and Evidence required sections |
| `research` | append Local, Online and API-docs research to a plan issue (`--local`, `--online`, `--api-docs`); `--prereq` writes its Depends-on line |
| `audit-record` | post a plan-audit verdict comment, `APPROVED` or `REVISE` |
| `accept` | open `plan/<id>`, open the draft pull request, freeze the issue |
| `implemented` | write the Handoff and Evidence report into the pull request |
| `ship` | `--check` prints the preflight and the merge command, or refuses with `STALE CHECK RUN` when a failed `verifier-gate` check run on the head would block the merge; `--confirm` re-proves the merge; neither merges |
| `gate-pass` | judge a pull request's newest PASS review with `origin/main`'s own `tools/queue`, then post the `verifier-gate` commit status on its head, refusing first on a `STALE CHECK RUN`; the only way to write that status |
| `block`, `unblock` | add or remove the `blocked` label together with its comment |
| `retire`, `retire-pr` | close an issue as not planned, or a pull request unmerged |
| `log` | add a dated comment to an issue or pull request |
| `status`, `list`, `order` | read the live queue (`--json` for `status` and `list`) |
| `lint` | check plan issues for a missing marker or placeholder bullets; `--offline` checks that `SCHEMA.md` still names every section |
| `doctor` | report disagreements between the marker, the workflow and GitHub's own state, including a `STALE CHECK RUN` on an open pull request into main |
| `init` | create the label set and check the repo; `--print-ruleset` prints the default-branch ruleset JSON, then the release ruleset JSON |
| `migrate` | one-time cutover from an old YAML queue |

The reads (`status`, `list`, `order`, `lint`, `doctor`) and `log` are open to
every seat. `ship` without `--confirm` is open to the verifier, the coordinator
and the main session; `ship --confirm` and `gate-pass` are the verifier's alone.
Every other verb is the coordinator's or the main session's.
`.claude/hooks/gh_write_guard.py` enforces the split once it is wired into
`.claude/settings.json`; a vendor run prints `NOT WIRED` while it is not.

## States

A state is read from GitHub, never stored in a file.

| state | what GitHub shows |
| --- | --- |
| stub | open issue, label `plan`, not yet researched: Touches, Evidence required or all three Research subsections still empty or placeholder |
| researched | the same issue with those sections and `## Research` filled in |
| accepted | label `accepted`, branch `plan/<id>`, an open draft pull request closing the issue |
| implemented | the pull request is ready, with `## Handoff` and `## Evidence report` filled in |
| verified | a verifier review with `verdict: PASS` bound to the head commit, and a green `verifier-gate` commit status |
| merged | the pull request merged and the issue closed |
| blocked | label `blocked` with a `**Blocked**` comment |
| retired | issue closed as not planned, or pull request closed unmerged |

## Priority

Priority is a label, `p1` to `p5`, on the plan issue; `queue stub` sets `p3`
and `--priority N` picks another. What each number means is repo policy, the
same as phonux-app's:

- 1 = blocks everything else queued;
- 2 = next in a required sequence;
- 3 = default, independent work;
- 4 = polish or wrap-up, wanted but not blocking;
- 5 = explicitly deferred (a phase-2 sketch), not to be dispatched without a
  fresh owner decision.

## What stays in files

This repo started on the pipeline and never had a YAML queue, so
`completed/merged.yaml`, `completed/retired.yaml` and `records/` are the empty
starters the vendoring tool seeds; nothing writes them, because a plan's record
is its pull request body.

## The gate

`strict_gate` in `.claude/coordinator-config.yaml` lists the gate, and CI
(`.github/workflows/ci.yml`) runs the same commands on pull requests into
`release` and on dispatch. A pull request into main gets only the `verifier-gate`
status, so a verifier PASS rests on the verifier's local re-run. Besides the typecheck, tests, build, API report and pack smoke, it runs
`queue.py lint --offline` and the vendored-tooling drift check
(`tools/vendor-queue-tooling.py . --check`). To refresh the vendored tooling,
run `python3 tools/vendor-queue-tooling.py <this repo>` from a checkout of
agent-ready-template.

## Turning the gates on

Vendoring copies the tooling in. It does **not** switch anything on: git
looks for hooks in `.git/hooks/` until told otherwise, and that setting lives
in `.git/config`, which is not carried in a commit. Until you run this, once
per clone (and again after every `git worktree add`), the markdown check
below never fires — and the failure mode is silence, not an error.

```sh
git config core.hooksPath .githooks
git config --get core.hooksPath   # must print: .githooks
```

Vendoring seeds `.githooks/pre-commit` for you if this repo had none; it
sources `.githooks/lib/markdown_lint.sh` (staged-markdown lint plus the inline
`markdownlint-disable` audit). If you already had a `.githooks/pre-commit`,
yours was left exactly as it was — add that `.` line to it yourself.

One escape hatch exists and it announces itself on stderr, because a gate
that was skipped proved nothing: `SKIP_MARKDOWN_LINT=1` disables the
markdown checks for one commit. It should never be set in CI.

Prove the hook is live before trusting it: stage a markdown file with a
deliberate lint error (a skipped heading level) and check the commit is
refused, or that it prints a line saying the lint was SKIPPED and why.
