# Why: the author never grades its own work

Behind [AGENTS.md §3](../../AGENTS.md) and §6.

## The auditor wrote to production twice in one session, 2026-08-23

The role whose entire job is catching this class of thing silently wrote thirteen rows
into a live schema, twice, in one session. Once from a subprocess call that never passed
its environment through, so the connection did not carry the intended settings. Once from
an uppercase character in a schema name, which the database lower-folds, so the
search-path override never resolved and the connection fell back to the default schema.
Both times it held superuser credentials, so the fallback simply succeeded.

It caught itself afterwards and correctly refused to delete the rows. Its own summary is
the point: it had demonstrated twice in one session that its confidence about what its
code touches was unreliable.

Two habits follow, because a permission floor is not a substitute for care: assert which
schema you are actually connected to *before* writing anything, and count rows before and
after your run. A guard you have never seen refuse is a guard you are trusting rather
than testing.

## Correct data, written without approval, 2026-08-23

The same week, a different agent filled 1,436 real identifier values into a production
table and was entirely within its brief while doing so. The values turned out to be
correct — verified afterwards, every one matching its source byte for byte.

That is precisely why it is worth stating as a rule rather than treating as a near miss.
Correct data written without approval is still data written without approval, and the
next one may not be correct. A brief saying "fill-only writes are fine" is not owner
approval; a coordinator cannot delegate an authority it was never given. The cost of the
rule is one round trip: report the table, the column, the row count, and what the values
derive from, and let the owner decide.

## Evidence gathered through a path that could not observe the property

From one long verification run, 2026-08-15. Every instance passed, and every instance
proved nothing:

- a test asserting CSS class names when the defect was layout geometry;
- a "before" screenshot whose empty columns came from an unfed fixture, not from the code
  under test;
- a password check that succeeded with a deliberately *wrong* password, because the
  database container granted trust locally and the test never crossed the authentication
  boundary it claimed to test;
- a staging command that staged nothing after a push, read as "nothing to do" rather than
  "the thing I expected did not happen".

The question that catches all four is "which code path does this actually traverse?" —
never "did it pass?". A no-op where a change was expected is a signal, not a completion.
When a check passes, confirm the mechanism could have failed, ideally by breaking it on
purpose and watching it go red.

## A claim gaining authority through restatement

In the same run, three wrong facts spread because someone senior repeated them: a stale
"known pre-existing test failure" label, where the failure was hours old and
self-inflicted; and a count of four failing tests that was really eight.

A false premise from the top of a chain is harder to dislodge than one invented
mid-chain — everyone below treats it as settled context, each restatement adds apparent
authority, and nobody re-measures. When inheriting a claim (a baseline number, a "known
issue", a "pre-existing failure"), establish its provenance and date before acting on it.
"Pre-existing" always means relative to something; ask what.

## Why the verifier defaults to FAIL

The whole point of a verification step is catching what a green build misses. An author
reviewing its own work has already decided the work is good, and both failure modes above
look exactly like diligence from the inside. So the verifier is a separate agent, it
re-runs the gate rather than trusting a reported exit code, it checks each evidence claim
individually, and its verdict starts at FAIL until each one survives.
