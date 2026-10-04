# plans/SCHEMA.md -- git pipeline v2 body-shape reference

This is the body-shape reference for the GitHub pipeline: what
`tools/queue/queue.py` writes into a plan issue's body and a plan PR's body,
and what `queue lint` checks for. A plan's state is read from GitHub and is
never stored in a file, so there is no queue file for this reference to
describe.

No GENERATED fence: there is no YAML file this reference is rendered from
or checked against. `tools/queue/queue.py` names this file's own path in
one constant (`SCHEMA_REFERENCE_RELPATH`) and derives its own
`LINT_SECTIONS` list of every section name below -- a test
(`tools/tests/test_queue_tool_lint.py`) asserts every name in that list
appears here, so the doc and the checker cannot silently drift apart.

## The issue body (candidate stage only, until acceptance)

Written once by `queue stub`, updated in place by `queue research` until
`queue accept` freezes it for good. Starts with a machine marker,
`<!-- plan:v1 -->`, and an `id:` line, then six sections:

- `## Intent` -- one paragraph, what the entry is for.
- `## Touches` -- a bullet list of path globs the work will edit.
- `## Evidence required` -- a NUMBERED bullet list. The numbering is load-
  bearing: `report_rules.count_evidence_bullets` and `check_report.py`
  both count it against a verifier's own claimed `bullets_expected`.
- `## Research` -- three subsections, each optional until state
  `researched`:
  - `### Local insights`
  - `### Online insights`
  - `### API docs needed`
- `## Gates` -- `Depends on:` (a comma-separated `#<n>` list of issue
  numbers this entry depends on, or `none`; written by `queue research
  --prereq`, since native `blockedBy` has no `gh` read path), `resources:`
  and `gate_override:`, the latter two each a JSON array; a distinct
  heading from the PR body's own `Gates:` line below, which is a field
  inside `## Brief`, not a section of its own.

A body missing the `<!-- plan:v1 -->` marker is `UNPARSEABLE #<n>`, never
read as a silent stub (`queue lint`). A placeholder bullet (a bare
`<TODO>` or similar angle-bracket token) under `## Touches` or
`## Evidence required` is caught by the same lint pass, never read as
researched.

## The PR body (the record from acceptance on)

Written once by `queue accept` (copying the issue's own sections
verbatim), then appended to exactly once more by `queue implemented` --
nothing else ever touches this body again (its `ALREADY IMPLEMENTED`
pre-check refuses a second write). There is no `## Verifier verdict`
section: the verdict lives only as a PR review comment, bound to a sha
(plan section 6), never in the body, so it can never be silently
overwritten by a later push.

- `## Entry` -- `Closes #<n>  (\`<id>\`)`, the one link between the PR and
  its issue that GitHub itself tracks natively
  (`closingIssuesReferences`); a write that silently drops it is
  `ISSUE UNLINKED`.
- `## Brief` -- `Intent`, `Priority`, `Touches`, `Evidence required`
  (renumbered, still load-bearing), `Depends on`, and `Gates:
  resources=[...] gate_override=[...]` -- all copied from the issue's own
  sections at accept time and never edited again.
- `## Research` -- the same three subsections as the issue body, copied
  verbatim at accept time.
- `## Handoff` -- holds the sentinel `<written by \`queue implemented\`>`
  and a `- [ ] partial   (Split into: #<m> if checked)` checkbox line
  until `queue implemented` overwrites the whole section (dropping the
  sentinel is what makes a second call refuse `ALREADY IMPLEMENTED`).
- `## Evidence report` -- blank until `queue implemented` writes the
  implementer's report verbatim.

## Read-back, always

Every body write in this pipeline re-`GET`s what it just wrote and
byte-compares before calling itself done -- `WRITE NOT PERSISTED` on a
mismatch, never a silent "saved" (GitHub's own PATCH on an oversized body
is a verified silent no-op, HTTP 200, nothing written). Every PR body
write also re-checks `closingIssuesReferences` still names the issue
(`ISSUE UNLINKED` on a mismatch, but only after one re-read: GitHub's API
has an open report of returning that field empty on a transient basis,
cli/cli#11841, and a transient empty read must not be mistaken for a real
unlink). See `tools/queue/queue.py`'s own module docstring for the full
invariant and which function enforces it.
