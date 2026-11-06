# Why: "didn't run" must never look like "passed"

Behind [AGENTS.md §1](../../AGENTS.md), §10 and §12. Anonymised incidents, kept because a
rule whose reason is lost cannot be safely deleted when the reason expires.

## The original three, one day, 2026-08-18

1. **A stale artifact.** The compiler errored, but a binary from an earlier build was
   still on disk. It ran and printed PASS — verifying older code than the one under test.
2. **An exit code through a pipe.** A sync command was given a progress flag its platform
   build did not support, so it printed usage and copied nothing. The command was piped
   into `tail`, so `$?` was tail's exit code. A total no-op displayed as `exit 0`.
   Trusting it would have cleared 27 GB of media that existed in exactly one place.
3. **The wrong thing mutated.** A mutation-testing gate mutated comments instead of code,
   so a semantically identical mutant "survived" and a sound gate was called weak.

`pipefail` alone would have caught the second, which is why it leads the habit list.

## The checker itself is wrong, in both directions, 2026-08-25

Five in one session. The operation under test was fine every time; the verification was
not, and it gave a false verdict both ways.

- A check looked for an artifact by a filename it reconstructed rather than observed; the
  toolchain adds a prefix. It reported FAIL on a clean, successful build.
- A path containing a space word-split through `xargs`, so a freshness comparison ran
  against an empty timestamp and printed OK for no reason.
- `grep -c ... || echo 0` yielded `"0\n0"` on zero matches; the numeric comparison
  errored, the branch fell through, and the `else` printed PASS. A genuine failure would
  have printed PASS too.
- A running process held a library open, so the build wrote a numbered variant beside it.
  A name-keyed check failed a good build — and a test run could load the stale original
  and pass against code that was never built.
- A grep verifying that stale advice had been removed matched a *quotation* of the claim
  rather than the claim.

A false FAIL is not the safe direction: one of these burned about forty minutes, and each
one erodes trust in the checker, so the next real failure gets waved through.

## Exit codes that carry no information

- A test runner's custom reporter called `process.exit(0)` whenever nothing had *failed*.
  A run that found zero test files exited 0. Reproduced directly, 2026-08-24: the runner
  itself said "No test files found, exiting with code 1" and the reporter overrode it. A
  name filter matching nothing behaved the same way. Assert the test count, never `$?`.
- `lsof +D` on one platform exits non-zero on every call, match or not. Measured over 120
  runs: 60/60 non-zero with a live holder, 60/60 non-zero without. Only stdout
  discriminates. The exit-code form of the check would have deleted a directory a live
  process was building in.
- A language's bare `assert` compiles to a no-op under optimization, so a test binary
  printed PASS and exited 0 regardless of what its assertions said. This is why the
  template's own hook tests use real assertion methods rather than the `assert` statement.

## A negative check needs a positive control

2026-08-24: an audit brief asked an agent to prove zero added matches for three tokens.
Two of them occurred nowhere in the tree at all, so those checks could not fail. The
brief was written by the same person who had spent the night hunting checks that silently
do nothing.

The asymmetry is easy to miss. A positive assertion that fails tells you something is
wrong; a negative assertion that passes tells you nothing unless you know the search was
capable of finding a hit. So: name a location where the pattern does occur and require it
be found there, or require a non-zero count against a known-bad reference, or ask for the
count across the whole tree so "0 in the diff" and "0 anywhere" stay distinguishable.

## A build cache shared between two trees, 2026-08-23

Two source trees were pointed at one compiler cache directory. The toolchain's fingerprint
for a workspace-local unit did not include the tree's absolute path, so the second tree
reused whatever the first had built: no compile line, no warning, no error, and a build
log that reads exactly like a successful one.

Proven in both directions in a single session. A deliberately broken tree reported PASS,
because it never recompiled and ran the good tree's artifact. With the build order
reversed, a pristine tree reported FAIL against the broken tree's artifact. Both verdicts
were about the wrong tree.

It bites hardest where two trees exist precisely to be compared — a mutation run against
its baseline, a fix branch against the branch it fixes — which is also where the result
is trusted most. Nothing enforces the separation, so the rule is the only guard: one cache
directory per tree, deleted before the run, so a build that never happened shows up as a
missing artifact rather than as a pass.

## What this does not do

It does not eliminate the class. It converts silent failures into loud ones. Every
incident above was caught by inspecting the effect, and every one would have shipped if
the report had been trusted.
