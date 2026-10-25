# Why: never block the chat

Behind [AGENTS.md §7](../../AGENTS.md). Kept because a rule whose reason is lost cannot
be safely deleted when the reason expires.

In one measured session the work was correctly backgrounded twenty-two times, and every
bit of blocking came from the poll loops that followed: each one re-implemented the
completion notification that already exists. A backgrounded command hands control back
at once and the harness re-invokes the agent when it exits, so a loop that re-checks it
adds latency and spends context without adding information. The measurements are in the
docstring of `.claude/hooks/foreground_guard.py`; this note keeps only the headline count,
so the other figures stay in one place.

Duration is not predictable from the command text, so the rule judges by the size of the
subject (a full test suite, a build, a fetch over many items), not by the verb.
