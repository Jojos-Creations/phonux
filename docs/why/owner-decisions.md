# Why: one pickable question per turn

Behind [AGENTS.md §4](../../AGENTS.md).

## Prose questions do not get answered

A question in prose is unpickable. It sits at the end of a report, gets skimmed, and is
answered shallowly or not at all. Tool options are selectable, so they actually get
answered — and the format forces the choices to be made concrete before asking.

Batching is fine. Several cards in one call is not the problem; a decision buried in prose
is.

## The failure mode is not forgetting the rule

The rule gets followed correctly whenever the moment *feels* like a decision, and then
broken at the end of a long status report, where a question reads as a conversational
closer rather than a decision point. Writing down the disguises does not prevent them: a
description of both of the ones below was on file when the last one happened.

What catches it is a literal string check on your own outgoing text. Before sending any
message, scan the last three sentences for a question mark, or for "want me to", "should
I", "or would you rather", "let me know if". If one is there, stop and convert it into a
question-tool call. No exceptions for "it is just a small check-in" or "the report already
explains it".

## The two disguises

- **The rider.** One question with a conditional second clipped on: "want me to do X? if
  so, should I also…". That is two questions. The second only exists if the answer is
  yes, so it belongs in the next turn.
- **The tucked-in loose end.** A long status report ending with a small extra ask. The
  report buries it, and the ask gets answered shallowly or not at all.

## Altitude: context in insider terms reads as no context at all

A question can carry a full context paragraph and still be unanswerable, because the
paragraph is written in codebase vocabulary — engine names, threshold stacks, internal
file terms. This happens most easily when the finding came out of deep code reading,
because the investigation's own vocabulary leaks straight into the question. The
translation has to be done deliberately, after the investigation, not assumed to happen
on the way out.

How to apply: before any option list, give one concrete everyday illustration of the
problem — what someone using the thing would actually see. Define every term of art the
moment it appears. State costs as consequences rather than implementation. Put the
recommendation first.

The test: could someone who has never opened the repo pick an option confidently? If a
sentence names a file, a flag, a table or a function, it does not belong in the question.
