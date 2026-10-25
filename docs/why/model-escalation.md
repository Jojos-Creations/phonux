# Why: delegate down, and escalate only on evidence

Behind [AGENTS.md §5](../../AGENTS.md) and §9.

## The supervisor costs more than the work

The finding that generalises: **the supervising turn, not the generated tokens, dominates
spend.** Nearly all of it is the context re-read on every turn, so the unit of cost in
agentic work is the *turn*, not the token, and per-turn cost scales with context size and
with the supervising model's tier. A coordinator can therefore cost several times what
the work it supervises costs, which inverts the intuition that the expensive tier should
sit at the top.

Three consequences follow from the shape alone, whatever the prices are:

- A free local worker saves only the cost of one cheap subagent. If using it adds even a
  fraction of an extra coordinator turn, it costs more than it saves.
- Executor choice is nearly irrelevant to cost. Pick the executor on reliability.
- Never run a model loop through the coordinator's context. If it cannot run headless in
  a script, delegating costs more than doing it.

> **Measured once, on one setup, 2026-08-17. Re-measure before relying on it.** A
> 3,403-turn session cost about $555, of which $465 was cache reads; output tokens were 7%
> of spend. One turn at the expensive tier with 450K of context cost about $0.66, against
> about $0.16 for a complete cheap subagent doing a whole task end to end from a cold
> context — a ratio of roughly 4:1. Model prices, cache-read pricing and tier names all
> move, and your context sizes are not these. The ratio your repo actually has is the one
> that should decide its coordinator tier.

The template's default is therefore the cheaper tier in *every* standing seat —
implementation, coordination and audit alike — with the stronger tier as escalation on
measured failure: a named hard call, or the same failure signature twice. Not a starting
choice. It moved there on 2026-08-28: the stronger tier had been standing in the
coordinating and auditing seats, paying the ratio above on every turn, and no measurement
ever justified the price. Change the default in the `model:` frontmatter of the agents
in `.claude/agents/`.

## Tool-list width is a second per-turn cost driver

An agent's `tools:` list is scoping for blast radius (narrower is safer), but it is also
a cost lever independent of that. Anthropic's own prompt-caching docs state the cache
prefix is built in a fixed order — tools, then system, then messages, each level building
on the ones before it — so an agent's tool definitions are the *first* thing cached, and
the first thing whose size sets what gets re-read (at 0.1x price, still nonzero) on every
following turn, not paid once at dispatch. ([Anthropic prompt-caching
docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), retrieved
2026-09-14.)

A 2026-09-13 same-repo measurement of two same-length agents differing only in tool
breadth found a real cost gap, but a dedicated re-check could not reproduce the specific
47% figure, and it should not be cited as re-derived. What the re-check did confirm: two
same-role, same-repo transcripts (verifier, 4 tools) showed near-identical first-turn
cache-creation sizes, consistent with a fixed prefix built once and re-read every turn.
What it also found: a cross-role, cross-project comparison runs backwards — a 6-tool role
measured 31,595 starting tokens against a *different* 6-tool role at 16,240 — because
each project's own CLAUDE.md and system content dominates prefix size and swamps tool
count. Only a same-project, same-session pair isolates tool-list width; a cross-project
comparison is not a valid test of this and should not be treated as one. To re-run the
comparison yourself: pick two dispatched-agent transcripts from the *same* repo and the
*same* coordinator session, differing in `tools:` breadth but otherwise comparable (role,
turn count), and compare each one's first-turn `cache_creation_input_tokens` and its
per-turn `cache_read_input_tokens` — a transcript pair pulled from two different projects
or two different sessions is not a valid input to this comparison.

The counter-consideration belongs in the same breath: a tool list cut too narrow makes an
agent fail outright or work around the missing tool, and that failure-and-retry costs
more than the multiplier saves. Scope a tool list for both reasons — blast radius and
per-turn prefix size — not for either alone.

## The frontmatter pin beats the caller's default

A harness that quietly defaults model-less dispatches to a cheap tier does *not* override
an agent that pins `model:` in its own frontmatter — the pin wins. So a dispatch believed
to be cheap can run at the expensive tier for a whole task, and an agent you meant to
escalate keeps whatever tier its own file names, with nothing in either transcript saying
which one ran. An explicit `model` at the call site beats both, so pass it, and treat
frontmatter as what decides when you do not. It is the failure shape this whole repo is
about: the result looks identical whether or not the thing you asked for happened.

## A brief defect mimics a capability ceiling

A local model produced flawless output in one language and consistently broken output in
another, which read as a hard capability limit. It was not: the brief omitted one type
detail that the first language inferred and the second required. Once the brief named it,
the same model produced correct output.

This is the general shape. If two different model tiers fail *identically*, the signal is
not that the task is hard — it is that the specification is incomplete, and a stronger
model will fail the same way at several times the price. That is why the escalation order
is: retry once with the error in hand (one feedback round flips a large share of failures
with no model change), escalate on a *repeated identical* error signature, and suspect
the brief when two tiers agree on how to fail.

## The rule that has never had an exception

Local or cheap-tier output never merges unverified. Every local arm ever measured on this
setup — every round, every model — shipped a broken self-test while its implementation
was fine. Chat-only models cannot run their tests. Something agentic, or the gate itself,
runs them before anything lands.

## The doubling ladder

The template's default budget rule: if a task gets revoked, it may ask for twice the last
estimate, up to two extra times. After that it has to justify a further attempt with
proof, or the owner decides. Change the multiplier or the number of rungs in
[AGENTS.md §9](../../AGENTS.md) if this repo's work has a different shape.

| claim | budget | on expiry |
| --- | --- | --- |
| 1st | whatever you estimated, stated up front | revoked; may re-claim |
| 2nd | at most 2× the last estimate | revoked; may re-claim |
| 3rd | at most 2× again | ladder spent |
| further | needs proof or an owner decision | — |

"Proof" means a file and line, a measured number, a cited source, or a reproduction that
predicts what will be different this time — not renewed confidence. It exists because a
plan reached a fifteenth attempt without anything forcing that conversation.

The two ladders answer different questions and are kept separate on purpose. The doubling
ladder governs the attempt and resource budget: it is what stops attempt nineteen. The
model ladder governs tier: it is what decides who makes attempt three. They overlap only
in the retry space.
