#!/usr/bin/env python3
r"""Tell an INVOKED command apart from a MENTIONED one.

WHY THIS EXISTS
---------------
Every command-inspecting hook here has independently made the same mistake:
matching a command that appears in the shell string as DATA rather than as
something the shell will run. On 2026-08-22 it fired three times in one day:

  * resource_guard denied a `python3 - <<PY ... PY` patch script because the
    heredoc body contained the words `git worktree add` -- the very command the
    denial message recommends.
  * load_guard denied a `git commit -F -` because the commit MESSAGE described
    a fix and contained the words "cargo test" and "test suites".
  * foreground_guard denied its own test, because the test payload carried a
    poll-loop pattern as a JSON string.

Each was patched locally and differently, so the next hook inherited nothing.
This is the one shared implementation.

WHAT IT STRIPS, AND WHY THAT BOUNDARY
-------------------------------------
Only text that is DEFINITIONALLY data:

  1. heredoc bodies              -- program text fed to another interpreter
  2. `-c` / `-e` script arguments -- python3 -c '...', node -e '...', sh -c '...'
  3. echo/printf arguments        -- output, not execution
  4. search patterns              -- the argument to grep/rg/awk/sed/pgrep, which
                                     names what you are LOOKING FOR, not doing
  5. embedded JSON objects        -- payloads, fixtures, test inputs

It deliberately does NOT strip ordinary quoted arguments. An earlier over-broad
version removed `"$WT"` from `git worktree add --detach "$WT" <sha>`, leaving
the commit-ish to be misread as the target path, and produced a false deny --
the exact failure it was written to prevent. A quoted argument is usually a
real operand. Strip too little and a hook is noisy; strip too much and it is
wrong in a way that is harder to see.

WHY THIS FILE IS NOT A DIRECT re.sub() OVER TWO REGEXES ANY MORE
------------------------------------------------------------------
FOUND 2026-08-24 by the cargo-pool audit, as a side finding: a 160KB command
containing 16,000 unterminated `<<EOF` openers hung every hook that imports
this module (cargo_scratch_guard, load_guard, foreground_guard) past their
registered timeouts -- 51-60s measured, against a 10s registered timeout.
resource_guard was unaffected only because its one call site is gated behind
`"git" in command`, not because its code path differs.

ROOT CAUSE: the old `_HEREDOC` pattern was
    r"(<<-?\s*['\"]?(\w+)['\"]?)([^\n]*)\n.*?\n\s*\2\b"
matched via `.sub()`. For an opener whose tag never closes, the lazy
`.*?` (DOTALL) scans all the way to the end of the string before the whole
attempt fails, and `re.sub` then retries starting one character later. With
k unterminated openers that costs O(k * n) = O(n^2) -- confirmed by direct
measurement of the isolated regex: 0.3s / 1.8s / 7.6s at 1000 / 2000 / 4000
openers, doubling the opener count roughly quadrupling the time, exactly the
O(n^2) signature. The embedded-JSON rule (`_JSON`, matching a lazy `.*?`
hunting for a `}` that may not exist) has the identical shape and the
identical measured blowup (0.005s / 0.019s / 0.074s / 0.302s at 500 / 1000 /
2000 / 4000 unterminated `{"k":` openers) -- found by testing other
pathological shapes after the heredoc one, not reported by the original
audit. `_DASH_C`, `_ECHO` and `_SEARCH` were stress-tested the same way
(unterminated quotes, the bash `'\''` quote-escape idiom repeated 128,000
times, an 800,000-byte single token, 32,000 pipes) and stayed linear --
their terminators are simple character classes, not an unbounded DOTALL
`.*?` hunting for a delimiter that might not be there.

THE FIX has two independent parts, because a cap alone or an algorithm alone
each leave a way to be surprised:

  1. `_strip_heredocs` and `_strip_json` replace the two lazy-`.*?` regexes
     with a manual single forward pass. Each finds its next OPENER with a
     cheap, non-catastrophic regex, then does ONE bounded search for the
     matching closer.

     For `_strip_json`, "no closer anywhere in the remainder" is conclusive
     for the WHOLE REST of the scan, not just this one opener: a JSON
     object's closer is a bare `}`, which is not tied to any per-object
     identifier, so if none exists anywhere after this point, none exists
     after any LATER point either, and stopping the entire scan here is
     exactly what the original lazy `.*?` would also have given up on.

     For `_strip_heredocs`, that reasoning is ONLY half right, and getting
     it fully right needed a second fix (2026-08-24, later the same day, an
     independent audit): a heredoc's closer IS tag-scoped -- "no closer for
     tag AAA anywhere after this opener" says nothing about a WELL-FORMED,
     independent `<<BBB ... BBB` a few lines later, and the ORIGINAL
     `re.sub` -- which retries at the very next character after any failed
     match, all the way through the string -- WOULD still find and strip
     that later BBB block. An earlier version of this fix conflated "safe to
     stop RE-HUNTING THIS SAME OPENER from a later starting point" (true --
     the search space for tag AAA's closer only shrinks going forward) with
     "safe to stop scanning the REST OF THE TEXT FOR ANY HEREDOC" (false),
     and a differential fuzzer against the live regex caught it: 31.2% of
     6,000 generated cases differed, including a case that reproduces the
     EXACT 2026-08-22 incident this module's own docstring opens with (a
     commit message inside one heredoc, sitting near an unrelated, genuinely
     unterminated one, denied for the wrong reason) and a case where a real
     `cargo build` sitting between two same-tagged, individually
     well-formed heredocs stopped being visible to any caller at all -- the
     silent-fail-open failure mode this whole module exists to prevent, not
     merely reintroduced but WORSENED (previously it hung past a timeout and
     failed open LOUDLY via that hang; this version failed open QUIETLY,
     with no hang and no warning). It ALSO carried a second, independent bug
     the same audit found: the "keep the opener text, then re-scan the
     closer line so a same-line follow-on opener (`EOF && cmd2 <<TAG2`) is
     still found" mechanism re-injected the OPENER's OWN `<<TAG` text
     alongside the closer line before re-scanning it, so that re-scan found
     the JUST-EMITTED, already-handled opener text again and re-hunted for
     ANOTHER closer of the SAME tag, silently eating everything up to the
     tag's NEXT appearance (if any) as if it were heredoc body.
     Fixed by keeping the per-opener hunt bounded (still ONE forward search,
     never restarted from a later position for the SAME opener) while
     making both failure paths precise instead of blanket:
       * an opener whose tag has no closer becomes literal, unstripped text
         for THAT ONE LINE ONLY, and the scan CONTINUES onto the very next
         line -- so a later, independent heredoc (same tag or different) is
         still found and correctly stripped, matching what `re.sub`'s
         next-character retry would have found, INCLUDING a second
         opener on the same line;
       * the hunt for a tag's closer is a BISECT into a per-tag index of
         candidate closer lines (`closer_lines` / `_closer_key`), built in
         one O(n) pass before the scan starts -- so an opener whose tag never
         closes costs O(log n), not a walk to end-of-text, whether that tag
         is seen once or sixteen thousand times.
         CORRECTED 2026-09-02 (a THIRD audit; the sentence that stood here
         was false and was itself the defect). It claimed a `dead_tags` memo
         kept this O(n), and named "thousands of DISTINCT never-closing tags"
         as a residual limitation "left to MAX_SCAN_LEN's hard cap". The memo
         only ever short-circuited a REPEATED tag, and the cap does not cover
         the distinct-tag shape at all: 30,361 short distinct openers are
         262,138 bytes, INSIDE the 262,144-byte cap, so the full pipeline ran
         and took 21.7s measured (0.097 / 0.387 / 1.556s at 2k / 4k / 8k
         openers -- quadrupling per doubling, textbook O(n^2)).
         `resource_guard.py` and `cargo_scratch_guard.py` both carry a
         "timeout": 10 in settings.json, so the harness would have killed
         them mid-scan -- and a killed PreToolUse hook produces no decision,
         which is an ALLOW. A cap that does not cover the shape, plus a memo
         that does not cover the shape, described as if between them they
         did, is exactly the "comment assures more than the code delivers"
         pattern this file already records two instances of. The index
         replaces the memo outright rather than sitting beside it;
       * the re-injected "continue scanning from here" text for a follow-on
         opener on the SAME line as a closer is the closer's own tail ONLY
         -- never the original opener's `<<TAG` text -- so a re-scan of
         that line can find a genuine new opener without also
         resurrecting the one that was just closed.
     This is what actually fixes the reported 160KB / 16k-opener case AND
     the differential-fuzz-found correctness regression: it now runs in the
     same O(n) neighbourhood as everything else in this file for the
     reported shape (see the TIMING case in hooks/tests/test_shell_text.py,
     which measures this directly as a real subprocess: 8,000 unterminated
     openers stays under 2s here, against the live module's 5-6s on the same
     payload on this machine -- run BOTH ways with SHELL_TEXT_HOOK_UNDER_TEST,
     the earlier version of this sentence cited timings that did not exist in
     that file, which a 2026-08-25 audit named as the exact class of defect a
     previous audit had already caught once: a comment citing evidence that
     isn't there).
     RE-BASELINED 2026-08-25 (the previous sentence here claimed unqualified
     parity and that is now known false): on WELL-FORMED heredocs -- every
     opener has an exact, matching closer somewhere later in the text -- this
     function's OUTPUT matches the original regex's exactly, verified by a
     20,000-case fuzz differential against `shell_text.py`'s own
     `_HEREDOC.sub`: 0 differences. On MALFORMED heredocs it deliberately
     does NOT match live in two declared, bash-verified ways -- see "DECLARED
     DIVERGENCE FROM LIVE" below, immediately before USAGE. Chasing zero
     differences against live UNCONDITIONALLY would mean reintroducing a bug
     in live that a 2026-08-25 audit proved is a bug, not a spec, by running
     both interpretations through real bash with a stand-in `cargo` on PATH.
  2. `MAX_SCAN_LEN` is a hard cap on top of that, independent of how fast the
     algorithm is proven to be today: a future pathological shape in a regex
     nobody stress-tested is exactly the class of bug this module already
     shipped once. Above the cap, `invocations_only` does NOT try to be
     clever or fast on the excess text -- it SKIPS the masking passes (the
     heredoc / -c/-e / echo / search / JSON stripping above) entirely, and
     says so LOUDLY on stderr (command length, cap). It returns `command`
     itself, UNMASKED, not "".

     FOUND 2026-09-02 (this round's audit): an earlier version of this
     function returned "" above the cap instead. Every current call site
     (`resource_guard.check_git`, `cargo_scratch_guard.find_violations`,
     `foreground_guard.pre`, `load_guard`'s `classify`) treats an EMPTY scan
     as "found nothing to gate on" and allows -- so that version's actual
     effect was a SILENT ALLOW of the oversized command, dressed up as a
     loud stderr note about the cap. Measured directly: a 528,929-byte
     ORDINARY command with no pathological structure at all -- an `echo` of
     60,000 filler tokens, then `; rm -rf` of a real path -- which the O(n)
     algorithm above scans in single-digit milliseconds, went through that
     "" return, and every one of the four consumers above then allowed it:
     `git` vanishes from resource_guard's emptied string, cargo_scratch_guard
     finds no `rm` target in it, foreground_guard's regexes have nothing to
     match, and load_guard's classifier sees an empty probe and enforces no
     ceiling. This is NOT the pathological-input case `MAX_SCAN_LEN` exists
     for -- that input has no pathological structure, and the O(n) algorithm
     handles it comfortably inside the cap's own margin -- so returning ""
     there was not "failing safe on something too expensive to check"; it
     was manufacturing a blind spot on ordinary, cheap-to-scan text for a
     reason that had nothing to do with cost.

     Returning the raw command instead means a caller now scans the FULL
     text, mentions included: a `git worktree add` sitting inside an
     oversized heredoc body, or a `cargo test` named in an oversized echo
     argument, can now read as an invocation above the cap where it would
     not below it. That is a real behaviour change, and it is the SAFE
     direction for a guard: at worst it produces a false DENY (a mention
     misread as an invocation), which costs an agent one retry with a
     shorter command; the previous behaviour produced a false ALLOW (a real
     invocation misread as nothing at all), which is silent and unbounded.
     A guard helper must never hand a caller FEWER signals than the raw
     input carries -- "found nothing" must never be a possible outcome of
     "declined to look". The cap still does real work: it is what keeps this
     module from ever spending unbounded time in the masking passes on a
     future pathological shape nobody has stress-tested yet, exactly as
     before -- only the RETURN VALUE on that path changed, not the decision
     to skip masking. Anything this module cannot afford to mask is still
     worth an operator noticing (the stderr note is unchanged in that
     respect); it is just no longer conflated with "therefore hand back
     nothing at all".

DECLARED DIVERGENCE FROM LIVE (malformed heredocs only; 0 differences on
well-formed input -- see FIX 1 above for the corpus)
------------------------------------------------------------------------
FOUND 2026-08-25 by an audit whose own 20,000-case corpus never generated
either shape and whose "0 differences" claim was therefore only 6.25% true
against a corpus that COULD see one (1,251 differences in 20,000 cases when
generation was widened to include malformed openers). Both families below
were confirmed against REAL bash, with a stand-in `cargo` on PATH, not
reasoned about from the regex alone: in every divergent case tried, `cargo`
did NOT execute, and a well-formed control on the same PATH did -- so no
divergence here is a guard going silently blind to something that actually
runs. This is the omission a positive control caught: the empty-body
divergence a few paragraphs up (search "PRE-EXISTING quirk" in
`_strip_heredocs`'s own docstring) WAS already declared, which proves silence
on these two is an oversight rather than a house style of leaving
divergences undocumented.

  (a) UNBALANCED / MISMATCHED QUOTE OPENERS -- e.g. `<<'EOF` (no closing
      quote anywhere), `<<"EOF'` (closing character is a DIFFERENT quote
      character than the opener).
      LIVE: `['\"]?` appears TWICE in `_HEREDOC`, each independently
      optional, with no requirement that the two consumed characters (if
      any) match each other or even both be present. Confirmed: for both
      shapes above, `_HEREDOC.sub` matches anyway, silently discarding
      whichever quote character sits next to the tag and treating the input
      as an ordinary, cleanly-quoted heredoc with tag `EOF`.
      CANDIDATE: `_HEREDOC_OPEN`'s `(['\"]?)(\w+)\1` requires the trailing
      marker to be the IDENTICAL captured text as the leading one via a true
      backreference. `<<'EOF` has no trailing `'` for `\1` to match at all;
      `<<"EOF'` has a trailing `'` where `\1` demands `"`. Both fail to match
      at that opener, so `_HEREDOC_OPEN` finds no opener there, and
      `_strip_heredocs` leaves that line -- and everything after it, since no
      closer hunt is ever begun -- untouched.
      BASH: confirmed directly, both shapes. `<<'EOF` (or `<<"EOF'`) opens an
      UNTERMINATED QUOTED WORD at the shell's own lexer stage -- an ordinary
      quoting error, not heredoc-specific -- and bash scans the entire rest
      of the script for a matching quote character. Finding none, it reports
      "unexpected EOF while looking for matching `''" (or the double-quote
      equivalent) and refuses to run ANY part of the script, including the
      `cat` that precedes the malformed redirection. Verified live: exit
      code 2, zero commands executed.
      WHY THE CANDIDATE IS CORRECT: the input is not valid shell at all --
      there is no interpretation under which any of this text is a live
      invocation. Live's two independent, unpaired `['\"]?` markers
      manufacture a confident, fully-formed heredoc parse for a script bash
      itself refuses to run, inventing structure that does not exist. The
      candidate's backreference instead fails to match, which is the honest
      outcome: it makes no claim about a heredoc boundary it cannot
      correctly establish. Nothing in this text can ever reach a real
      invocation under either transform, so the divergence changes which of
      two never-executing interpretations a caller sees -- it cannot hide a
      command that runs.

  (b) TAG-PREFIX BACKTRACKING -- named by no round before 2026-08-25.
      Minimal repro, four lines:
          cat <<EOF2
          body
          EOF
          tail
      LIVE yields `'cat <<EOF2 \ntail'` (the bare `EOF` line closes the
      `EOF2` opener). CANDIDATE leaves the input WHOLE, byte-identical.
      LIVE: `_HEREDOC`'s tag group `(\w+)` is captured by a GREEDY,
      backtracking quantifier with no delimiter pinning it to the full
      opener text. When no line anywhere matches the closer pattern for the
      full tag "EOF2", the engine backtracks the CAPTURE ITSELF down to a
      PREFIX -- "EOF" -- pushing the dropped suffix "2" into the following
      "rest of opener line" group as if it were real shell text, then
      successfully closes on the bare `EOF` line. The tag was never "EOF2";
      live silently decided it was "EOF" plus a stray shell fragment "2".
      CANDIDATE: `_HEREDOC_OPEN`'s tag group is followed only by a quote
      backreference (`\1`), never a backreference to the tag itself, so
      nothing forces `(\w+)` to give back characters -- it captures "EOF2" in
      full. `_strip_heredocs` then hunts for a line that IS "EOF2" (or
      "EOF2" plus a non-word character) and finds none anywhere in the
      remainder, so per the tag-blind-short-circuit fix above, the opener
      line is left literal and the scan continues -- finding no other
      opener, the entire four-line input survives untouched.
      BASH: confirmed directly with `bash -x`. `cat <<EOF2` accepts ONLY a
      line that is exactly `EOF2` as its closer; a bare `EOF` line does not
      close it. With no `EOF2` line anywhere, the heredoc is unterminated and
      swallows every remaining line -- `EOF` and `tail` included -- as
      literal data on `cat`'s stdin. `bash -x` traces exactly one command
      (`+ cat`); the rest is `cat`'s own printed output, never executed
      shell. Re-verified with a stand-in `cargo` in the `tail` position: the
      marker log recording an execution was never created.
      WHY THE CANDIDATE IS CORRECT: live's phantom close presents "tail" to
      a caller as real, executing shell text sitting after a closed heredoc
      -- a claim bash disproves. If "tail" held a real invocation such as
      `cargo build --release`, live's transform would show it to e.g.
      load_guard as something to classify, when in the real shell it can
      never run at all -- a live-only FALSE POSITIVE (an over-eager reveal of
      text that is actually inert data), not a defect in the candidate.

USAGE
    from shell_text import invocations_only
    scan = invocations_only(command)   # then match against `scan`, not `command`
"""
import re
import sys
from bisect import bisect_left

# Above this many characters, do not attempt invocations_only's scan at all.
# 256 KiB is comfortably above any real single shell command this project has
# ever produced (the reported attack was 160KB and is now handled well inside
# this cap by the O(n) algorithm below; this cap exists for shapes nobody has
# stress-tested yet, not for the one that is already fixed).
MAX_SCAN_LEN = 256 * 1024


def _cap_exceeded(command):
    sys.stderr.write(
        "shell_text.invocations_only: command is %d bytes, over the %d-byte "
        "scan cap -- SKIPPING the heredoc/-c//-e/echo/search/JSON masking "
        "passes and returning the RAW, UNMASKED command text instead. This "
        "command was NOT checked for heredoc bodies, -c/-e script text, "
        "echo/printf output, search patterns or embedded JSON, so a caller "
        "may now see MORE than normal masking would have shown it (a "
        "mention inside a heredoc or echo argument can read as an "
        "invocation) -- that is the safe direction for a guard: at worst a "
        "false deny, never the silent allow an emptied scan would produce.\n"
        % (len(command), MAX_SCAN_LEN)
    )


# 2. Inline script arguments to an interpreter. Stress-tested against 128,000
# repetitions of the bash quote-escape idiom and an unterminated string with
# no closing quote anywhere: stays linear (the alternation's two branches
# never compete for the same starting character, so there is no ambiguous
# backtracking to blow up).
_DASH_C = re.compile(
    r"\b(?:python3?|node|deno|ruby|perl|bash|sh|zsh)\s+(?:-\w+\s+)*"
    r"-(?:c|e)\s+('(?:[^']|'\\'')*'|\"(?:[^\"\\]|\\.)*\")",
    re.S)

# 3. echo / printf arguments -- output, never execution.
_ECHO = re.compile(
    r"\b(?:echo|printf)\s+(?:-\w+\s+)*"
    r"('[^']*'|\"(?:[^\"\\]|\\.)*\")",
    re.S)

# 4. The pattern argument to a search tool: what you are looking FOR.
_SEARCH = re.compile(
    r"\b(?:grep|egrep|fgrep|rg|ag|ack|pgrep|pkill|awk|sed)\b"
    r"(?:\s+-{1,2}[\w-]+)*\s+"
    r"('[^']*'|\"(?:[^\"\\]|\\.)*\"|[^\s|;&)]+)",
    re.S)

# TEMPLATE-LOCAL ADDITION (agent-ready-template, ship-hooks-load-and-foreground
# draft, 2026-09-13): this rule does NOT exist in claude-config's promoted
# shell_text.py (verified: zero occurrences of "MESSAGE_ARG" or "--message"
# anywhere under ~/.claude). It ported forward from the OLD 138-line
# template-only shell_text.py this file replaces, where it existed as rule
# "6. message arguments" specifically to support THIS TEMPLATE'S git_guard.py
# (also template-only; no claude-config equivalent) -- e.g.
# `git commit -m "chore: stop running git add -A in CI"` must not read as an
# invocation of `git add -A`. Dropping it silently while doing the wholesale
# shell_text.py replacement this entry's plan record calls for would have
# regressed an already-shipped, unrelated hook and broken its already-merged
# test (test_git_guard.py::test_allow_add_mentioned_only_in_dash_m_commit_message)
# -- caught by running that suite after the swap, not assumed. Kept as an
# explicit, commented local extension on top of the otherwise-faithful
# upstream port, rather than silently folded back in or silently dropped.
# Same shape as _DASH_C/_ECHO above (bounded quantifiers, no unbounded lazy
# `.*?` hunting an optional terminator), so it does not reintroduce the
# O(n^2) risk the rest of this module's history is about.
_MESSAGE_ARG = re.compile(
    r"(?:-m|--message|--body|--title)\s+"
    r"('(?:[^']|'\\'')*'|\"(?:[^\"\\]|\\.)*\")",
    re.S)

# --- 1. heredoc bodies -------------------------------------------------
# Only the OPENER is matched with a regex; it is a simple, non-backtracking
# shape (no nested unbounded quantifiers). The tag is NOT always at end of
# line: `cmd <<'MSG' | tr -d x` is common, and so is `cmd <<EOF && next`.
# Anything after the tag on the opener line is REAL shell -- a pipe, an &&,
# a redirect -- so it is preserved; only the body dies.
_HEREDOC_OPEN = re.compile(r"<<-?\s*(['\"]?)(\w+)\1")

# FAMILY (d), FOUND BY FREE FUZZING 2026-08-25 -- `<<`/`<<-` at END OF LINE
# with NOTHING else (not even a tag) before the newline, the tag itself
# sitting on a LATER line. Live's `_HEREDOC` is `<<-?\s*['\"]?(\w+)`, and
# `\s` matches "\n" like any other whitespace, so live's tag search crosses
# the line break (and any further BLANK lines, themselves pure whitespace)
# to find it. `_strip_heredocs` splits the text into lines FIRST (see its
# own docstring below for why splitting at all is already a declared
# behaviour change), so `_HEREDOC_OPEN` structurally cannot see past a
# newline -- confirmed dangerous, not merely untidy: `bash -n` on
# `cat <<\nEOF\ncargo build --release\nEOF\ntail\n` gives "syntax error near
# unexpected token 'newline'", exit 2, ZERO commands run, not even `cat` --
# so the body is inert data and REVEALING it (what the unfixed candidate
# did) is the wrong direction, exactly family (c)'s polarity and fixed for
# the same stated reason: "safe direction is not a reason to keep it".
# `_HEREDOC_DANGLING` finds the trailing `<<`/`<<-`; `_TAG_LINE` finds the
# tag on whichever later, non-entirely-blank line holds it, with the SAME
# quote backreference `_HEREDOC_OPEN` already uses (not live's independent,
# unpaired `['\"]?` twice) -- an unbalanced quote wrapping a cross-line tag
# gets the SAME declared family (a) treatment as an unbalanced quote
# wrapping a same-line one, rather than a second, ad hoc rule.
_HEREDOC_DANGLING = re.compile(r"<<-?\s*$")
_TAG_LINE = re.compile(r"^\s*(['\"]?)(\w+)\1")


def _cross_line_tag(lines, next_nonblank, idx, start):
    r"""If `lines[idx]` (searched from column `start`) ends in a dangling
    `<<`/`<<-` opener whose tag was not found on this same line, return
    `(tag, tag_line_idx, tag_end_col)` for the first later line that is not
    ENTIRELY whitespace, if that line's own leading run (after its own
    indentation) is a validly-quoted tag. Otherwise None.

    `next_nonblank[i]` is precomputed ONCE per `_strip_heredocs` call (see
    there) as the smallest `j >= i` with `lines[j].strip() != ""` (or `n` if
    none) -- an O(1) lookup here rather than a fresh forward scan on every
    call, which is what keeps a line carrying MANY dangling `<<` opener
    attempts (a plausible adversarial shape, mirroring the very issue this
    module exists to fix) from re-walking the same trailing blank run once
    per opener and reintroducing an O(n^2) blowup.
    """
    if not _HEREDOC_DANGLING.search(lines[idx], start):
        return None
    j = next_nonblank[idx + 1]
    if j >= len(lines):
        return None
    tm = _TAG_LINE.match(lines[j])
    if not tm:
        return None
    return tm.group(2), j, tm.end()


# The ONE tag a given line could ever close, or None. See `_closer_key`.
_CLOSER_KEY = re.compile(r"\w+")


def _closer_key(line):
    r"""The single tag `line` can close, or None if it can close no tag.

    `_heredoc_closer_tail(line, tag)` succeeds exactly when `tag` equals this
    key, so an index built from this function answers "which lines can close
    tag T" without testing every line against every tag. The equivalence is
    not an approximation, it is forced by the two functions' own shapes:

      * every tag this module ever hunts for comes from a `(\w+)` capture
        (`_HEREDOC_OPEN` group 2, `_TAG_LINE` group 2), so a tag is a
        non-empty run of word characters and nothing else;
      * `_heredoc_closer_tail` requires the lstripped line to START with the
        tag AND the character right after it (if any) to be neither
        alphanumeric nor `_` -- which is precisely "not a word character",
        since Python's `\w` is documented as str.isalnum() plus underscore;
      * those two together say the tag is the MAXIMAL leading word-character
        run of the lstripped line -- which is what this returns.

    So: key == tag <=> `_heredoc_closer_tail` returns a tail. A line whose
    lstripped form does not start with a word character (blank, `# ...`,
    `)`, ...) closes nothing and is not indexed at all.
    """
    stripped = line.lstrip()
    m = _CLOSER_KEY.match(stripped)
    return m.group(0) if m else None


def _heredoc_closer_tail(line, tag):
    r"""If `line`, after only leading whitespace, is exactly `tag` followed by
    a non-word character or end of line, return what follows the tag
    (preserved verbatim -- e.g. a trailing ` | tr -d x`). Otherwise None.

    Mirrors the original regex's `\\s*TAG\\b` at a line boundary: `\\s*` can
    span blank lines before the closer (a blank line simply fails this check
    and the caller keeps hunting on the next one), and `\\b` after the tag is
    "not immediately followed by another word character", i.e. the tag is
    not merely a prefix of a longer identifier on that line.
    """
    stripped = line.lstrip()
    if not stripped.startswith(tag):
        return None
    after = stripped[len(tag):]
    if after and (after[0].isalnum() or after[0] == "_"):
        return None
    return after


def _strip_heredocs(text):
    r"""O(n) replacement for the old `_HEREDOC.sub(...)`.

    Splits on literal "\\n" only (not str.splitlines(), which would ALSO
    break on \\r, \\x0b, \\x0c and Unicode line separators the original
    regex's literal `\\n` never treated as a line end -- an additional,
    gratuitous divergence from the original on top of the one below, not a
    reason to accept it). CORRECTED 2026-08-25: an earlier version of this
    sentence asserted that splitting on "\\n" avoids "a silent behaviour
    change" outright. That was false, and saying it plainly is the fix, per
    this project's own recorded pattern of comments that assure more than
    the code delivers. Splitting AT ALL -- regardless of which characters
    count as a line end -- is itself a behaviour change for one shape: a
    `<<`/`<<-` opener at the very end of a line with its TAG on a LATER
    line. The original regex's `\\s*` matches "\\n" like any other
    whitespace, so it can find that tag across the break; a per-line
    `_HEREDOC_OPEN.search` structurally cannot, once the text has already
    been cut into independent line strings. That is FAMILY (d) below,
    handled explicitly by `_cross_line_tag` rather than left as an
    undeclared gap -- which is what it was for one round after a fuzz run
    found it. Each line is visited a small, bounded number of times: once
    as a candidate opener, and at most once more if it turns out to be the
    tail of a closer line that itself starts a new heredoc on the same
    physical line (e.g. `EOF && cmd2 <<TAG2`), which the original `re.sub`
    would also re-scan from the position right after the first match. The
    inner "hunt for a closer" is a BISECT into `closer_lines`, a per-tag
    index of candidate closer positions built in one O(n) pass before the
    scan starts, so total work is O(n log n) regardless of how many openers
    fail to close and regardless of whether they share a tag -- see
    `closer_lines` below and the module docstring's "THE FIX" section
    (item 1) for why the per-opener short-circuit this replaced was not
    enough, and why the naive re-injection of a closed
    opener's own text was a second, independent bug an audit caught.

    THREE DEFECTS independent audits found in earlier versions of this
    function, all fixed here:

    1. PHANTOM RE-OPENER. The earlier version re-injected `prefix` (the
       OPENER's own `<<TAG` text) together with the closer's tail into
       `lines[j]` before re-scanning that line for a same-line follow-on
       opener. Since `prefix` still literally contains `<<TAG`, the re-scan
       found IT again and mis-read it as a BRAND NEW opener for the tag that
       had JUST been closed, hunting for (and silently eating, as if it were
       heredoc body) everything up to that tag's NEXT appearance -- a real
       `cargo build` sitting between two independent, well-formed, same-
       tagged heredocs disappeared entirely. Fixed by finalising
       `prefix + rest_of_line + " "` straight into `out` (never re-scanned)
       and re-injecting ONLY the closer's own tail for the follow-on check.

    2. TAG-BLIND SHORT-CIRCUIT. The earlier version treated "no closer for
       tag T found in the remainder" as license to stop the ENTIRE scan and
       copy the rest of the text through untouched -- correct reasoning for
       `_strip_json` (a bare `}` is not tied to any per-object identifier,
       so if none exists after this point none exists after any later point
       either) but WRONG for heredocs, whose closers ARE tag-scoped: a
       failed hunt for tag AAA says nothing about a well-formed, independent
       `<<BBB ... BBB` a few lines later, which the ORIGINAL `re.sub`
       (retrying at the very next character after any failed match) would
       still find and strip. Fixed by making the failure PER-TAG: an opener
       whose tag has no closer becomes literal text for THAT ONE LINE, and
       the scan continues onto the next line so a later, independent
       heredoc is still found.

    3. QUADRATIC ON DISTINCT NEVER-CLOSING TAGS (found 2026-09-02, the third
       audit of this function). Defect 2's fix short-circuited a REPEATED
       dead tag via a `dead_tags` memo, and the text here said the remaining
       shape -- thousands of DISTINCT never-closing tags -- was "left to
       `MAX_SCAN_LEN`'s hard cap". It was not: 30,361 openers of the form
       `<<T<i>` total 262,138 bytes, six bytes UNDER the 262,144-byte cap, so
       nothing skipped and every one of those 30,361 tags paid its own walk
       to end-of-text. Measured 21.7s, with 0.097 / 0.387 / 1.556s at 2k / 4k
       / 8k openers -- time quadrupling per doubling. Two consumers
       (`resource_guard.py`, `cargo_scratch_guard.py`) carry a 10s PreToolUse
       timeout in settings.json, so in the harness that scan does not finish
       slowly, it gets KILLED -- and a killed hook emits no decision, which
       every consumer reads as ALLOW. Fixed by replacing the memo with
       `closer_lines`: one O(n) pass indexes each line under the single tag
       it could close (`_closer_key`), and each hunt becomes a `bisect_left`
       for the first candidate at or after idx+2. Same answers, O(log n) per
       opener instead of O(remaining), and no shape-specific special case to
       be wrong about next time.

    FAMILY (d), FOUND BY FREE FUZZING 2026-08-25 -- SAME POLARITY AS FAMILY
    (c), fixed for the same stated reason ("safe direction is not a reason
    to keep it"). A line can end in a dangling `<<`/`<<-` with no tag on it
    at all:
        cat <<
        EOF
        cargo build --release
        EOF
        tail
    Splitting on "\\n" before searching (see this function's own docstring
    above) means a per-line `_HEREDOC_OPEN.search` never sees the tag "EOF"
    on the line after the opener, so the unfixed candidate left the whole
    thing untouched -- REVEALING "cargo build --release" as if it were a
    command. `bash -n` on this exact input: "syntax error near unexpected
    token 'newline'", exit 2, zero commands run, not even `cat` -- verified
    with a stand-in `cargo` on PATH whose marker log was never created, so
    masking the body (what live already does) is correct and revealing it
    is not. Fixed by `_cross_line_tag`, called only when the ordinary
    same-line search fails and the line ends in a bare `<<`/`<<-`: it looks
    at the next line that is not ENTIRELY blank (mirroring `\\s*`'s own
    ability to absorb blank lines, since a blank line contributes nothing
    but a newline to that whitespace run) and treats a validly-quoted tag
    found there exactly as if it had been found on the opener's own line.
    """
    lines = text.split("\n")
    n = len(lines)
    # next_nonblank[i] = smallest j >= i with lines[j].strip() != "", or n if
    # none. Computed ONCE, in one O(n) backward pass, so `_cross_line_tag`
    # is an O(1) lookup no matter how many dangling `<<` openers the text
    # carries -- without this, a text with many dangling openers each
    # followed by a long blank run would re-walk that run once per opener,
    # reintroducing the O(n^2) shape this whole module exists to avoid.
    next_nonblank = [n] * (n + 1)
    for i in range(n - 1, -1, -1):
        next_nonblank[i] = i if lines[i].strip() != "" else next_nonblank[i + 1]
    # tag -> ASCENDING list of line indices that could close that tag, built
    # ONCE in one O(n) pass (see `_closer_key` for why exactly one tag per
    # line). This is what makes the closer hunt below a bisect instead of a
    # forward scan, and it is what fixes the O(n^2) blowup a 2026-09-02 audit
    # measured (see this function's docstring, defect 3).
    #
    # SAFE AGAINST THE `lines[j] = collapsed` MUTATION BELOW, and this is a
    # proof rather than a hope: the only write to `lines` is at index `j`,
    # immediately followed by `idx = j`; `idx` never decreases (the other two
    # branches leave it alone or advance it); and EVERY closer lookup starts
    # at `idx + 2`. So every position this index is ever consulted for is
    # strictly greater than every position that has been, or will have been,
    # rewritten by then. The original forward scan read the same live `lines`
    # list and was protected by the same fact -- it, too, never re-read a
    # rewritten line -- so indexing the ORIGINAL contents reproduces its
    # answers exactly rather than approximating them.
    closer_lines = {}
    for i, ln in enumerate(lines):
        key = _closer_key(ln)
        if key is not None:
            closer_lines.setdefault(key, []).append(i)
    out = []
    idx = 0
    # idx -> offset within lines[idx] from which the NEXT opener search must
    # start. A line that was just reconstructed by collapsing a closed
    # heredoc has its OWN now-dead `<<TAG` text sitting before this offset --
    # skipping straight to the closer's tail is what finds a genuine
    # same-line follow-on opener (`EOF && cmd2 <<TAG2`) without the re-scan
    # mistaking the just-closed tag's own text for a brand new opener
    # (defect 1, above: re-injecting `prefix` bare, with no offset, made the
    # re-scan re-discover it as a fresh opener and re-hunt for another
    # closer of the SAME tag, silently eating real text up to its next
    # appearance). Absent for any line reached without a prior collapse, in
    # which case the search starts at 0, same as before this fix existed.
    search_from = {}
    while idx < n:
        line = lines[idx]
        start = search_from.get(idx, 0)
        m = _HEREDOC_OPEN.search(line, start)
        if m:
            tag = m.group(2)
            end_pos = m.end()
        else:
            # FAMILY (d): the tag was not on THIS line at all -- see if a
            # dangling `<<`/`<<-` here has its tag on a later one.
            cross = _cross_line_tag(lines, next_nonblank, idx, start)
            if cross is None:
                out.append(line)
                idx += 1
                continue
            tag, tag_line_idx, end_pos = cross
            # The dangling opener's own line, and any purely-blank lines up
            # to (not including) the tag's line, are real preserved shell
            # text either way (closer found or not) -- append them now,
            # unchanged, then continue as if `idx` had always pointed at the
            # tag's own line. "\n".join(out) below puts the same single
            # newline back between each of these entries that the original
            # text had, so this reconstructs live's own preserved
            # `group(1)` (which embeds those newlines verbatim) without
            # needing a second code path to build it.
            out.append(line)
            for k in range(idx + 1, tag_line_idx):
                out.append(lines[k])
            idx = tag_line_idx
            line = lines[idx]
        prefix = line[:end_pos]        # the opener itself, e.g. "<<EOF"
        rest_of_line = line[end_pos:]  # real shell tail on the SAME line
        # The ORIGINAL regex's pattern is `(...)([^\n]*)\n.*?\n\s*\2\b` --
        # TWO separate literal `\n` tokens, one ending the opener line and a
        # SECOND one immediately before the tag, with the lazy `.*?` (which
        # CAN itself span newlines) sandwiched between them. That structure
        # can never match with the closer on the line IMMEDIATELY following
        # the opener: an empty-body heredoc (`cat <<EOF\nEOF\ntail\n`, tag on
        # the very next line, nothing between) genuinely does not match the
        # original regex AT ALL -- confirmed empirically, not assumed -- so
        # a tag reappearing at idx+1 must be skipped over as forced "body"
        # (exactly as the original's own `.*?` would silently consume it
        # while hunting for a LATER occurrence), and the search for a real
        # closer starts at idx+2.
        #
        # The candidate closer positions for THIS tag are already known (see
        # `closer_lines` above), so this is a binary search for the first one
        # at or after idx+2, not a walk to end-of-text. `_heredoc_closer_tail`
        # is still what produces the tail, so there is exactly one definition
        # of "this line closes that tag" -- the index only decides WHERE to
        # ask. The loop past the bisect position exists so that if a future
        # change ever did invalidate an entry, the scan keeps looking instead
        # of silently reporting "no closer" (which would mask a heredoc body
        # as real shell); with today's code it never iterates more than once,
        # for the reason given in `closer_lines`'s own comment.
        positions = closer_lines.get(tag)
        j = None
        closer_tail = None
        if positions:
            p = bisect_left(positions, idx + 2)
            while p < len(positions):
                cand = positions[p]
                closer_tail = _heredoc_closer_tail(lines[cand], tag)
                if closer_tail is not None:
                    j = cand
                    break
                p += 1
        if closer_tail is None:
            # No closer for THIS TAG anywhere in the remainder -- this one
            # opener's line is left as literal, unstripped text (matching
            # what the original regex's failed match attempt at this exact
            # position would also leave untouched), and the scan continues
            # PAST THIS OPENER ON THE SAME LINE, so a second opener on the
            # same line is still found -- which is what `re.sub`'s
            # next-character retry does. A REPEATED opener for this same tag
            # costs nothing extra: `closer_lines` has no entry for it (or
            # none at or after that opener), so its own lookup is another
            # bisect, not another scan -- which is why the `dead_tags` memo
            # an earlier version kept here is gone rather than kept as a
            # second, weaker mechanism saying the same thing.
            #
            # FAMILY (c), FOUND BY FREE FUZZING 2026-08-25 -- and this is
            # the bug that advancing to the next LINE caused. A line can
            # carry two openers:
            #     cat <<AAA && cat <<BBB
            # The module's own docstring calls `cmd <<EOF && next` common.
            # If AAA never closes but BBB does, advancing to the next line
            # never finds BBB, so BBB's body -- inert heredoc text -- is
            # handed to the guards as though it were commands. bash -x on
            # that input traces only `+ cat`, so the text really is data,
            # and revealing it is a FALSE-DENY vector: precisely the failure
            # this module's docstring opens with three incidents of.
            #
            # Note the polarity is OPPOSITE to families (a) and (b): there
            # the candidate is right and live is wrong; here live was right.
            # A divergence being "safe direction" is not a reason to keep
            # it -- over-revealing is how the 2026-08-22 commit-message deny
            # happened.
            search_from[idx] = end_pos
            continue
        # Body (the lines strictly between opener and closer, including any
        # blank ones the original's `\s*` absorbed) dies. The opener line's
        # tail and the closer line's tail are real shell text and survive,
        # joined by a single space exactly as the original regex's
        # replacement `group(1) + group(3) + " "` did (which also collapses
        # the newlines immediately bounding the heredoc into that one
        # space) -- kept as ONE reconstructed line (never split across two
        # `out` entries), so no newline is introduced where the original
        # regex would not have put one.
        collapsed = prefix + rest_of_line + " " + closer_tail
        lines[j] = collapsed
        # The next search of this (now reconstructed) line must start AFTER
        # the dead `prefix + rest_of_line + " "` portion -- exactly where
        # `closer_tail` begins -- so it can only ever find a GENUINE new
        # opener inside the closer's own tail, never the one just closed.
        search_from[j] = len(prefix) + len(rest_of_line) + 1
        idx = j
    return "\n".join(out)


# --- 5. embedded JSON objects -------------------------------------------
# Payloads and fixtures. Same lazy-`.*?`-hunting-an-optional-terminator shape
# as the old heredoc rule, and the same O(n^2) blowup on many unterminated
# `{"key":` openers (measured: 0.005s/0.019s/0.074s/0.302s at 500/1000/2000/
# 4000 openers -- quadrupling time as the count doubles). Fixed the same way:
# a cheap opener regex, then one bounded forward search for the next `}`,
# never re-attempted per character.
_JSON_OPEN = re.compile(r"\{\s*\"[\w-]+\"\s*:")


def _strip_json(text):
    out = []
    pos = 0
    while True:
        m = _JSON_OPEN.search(text, pos)
        if not m:
            out.append(text[pos:])
            break
        out.append(text[pos:m.start()])
        close = text.find("}", m.end())
        if close == -1:
            # No closing brace anywhere in the remainder -- exactly the
            # heredoc reasoning: the original's lazy `.*?` would also never
            # complete a match from here or later, so leave it untouched.
            out.append(text[m.start():])
            break
        out.append(" ")
        pos = close + 1
    return "".join(out)


def strip_heredocs_only(text):
    """Public export of JUST the heredoc-body stripper (item 1 of "THE FIX"
    above), for a caller that needs heredoc masking in isolation rather than
    the full `invocations_only()` pipeline (echo/search/JSON/-c/-e masking
    too, none of which such a caller wants applied twice).

    ADDED 2026-08-24 (round 4 of the load-guard classifier fix) because
    `load_guard.candidate.py`'s own `_extract_shell_dash_c_payloads` carried
    a byte-for-byte PRIVATE COPY of this module's OLD quadratic `_HEREDOC`
    regex, specifically to get this one piece of behaviour in isolation.
    "I need heredoc-only masking" is an argument for exporting a narrower
    function, not for forking the whole regex into a private copy -- which is
    exactly what went wrong: the fork could not benefit from the O(n) fix
    above, and independently reintroduced the identical quadratic blowup on
    the same 16,000-opener payload this module exists to fix (measured:
    candidate 140.58s, WORSE than LIVE's 85.08s, because it ran the quadratic
    pass twice -- once via `invocations_only`, once on the raw fork; with
    this export used instead, 68.91s and comfortably under the 60s harness
    timeout once load_guard's own call site is updated to use it).

    Deliberately does NOT enforce `MAX_SCAN_LEN` itself -- a second,
    independent cap check inside a narrower helper is one more place for it
    to drift from `invocations_only`'s own cap; a caller that needs the cap
    applied to THIS input checks it itself first, the same way
    `invocations_only` does for its own input.
    """
    return _strip_heredocs(text)


def invocations_only(command):
    r"""Return `command` with data-bearing regions blanked out.

    Replaces each region with a space so token boundaries survive: removing it
    entirely could join two unrelated words into a phrase that matches.

    Above MAX_SCAN_LEN this SKIPS the masking passes and says so on stderr,
    but returns `command` itself, UNMASKED -- never "". A guard helper must
    never hand a caller FEWER signals than the raw input carries: an empty
    scan reads to every consumer here as "nothing to gate on" and silently
    ALLOWS, which is the unsafe direction. Handing back the raw text instead
    can at worst make a caller see a MENTION as if it were an invocation (a
    false deny) -- safe, and rare, against a false ALLOW of an oversized
    dangerous command, which is silent and unbounded. See the module
    docstring's "THE FIX" section, item 2, for the incident that found this.
    """
    if not command:
        return command or ""
    if len(command) > MAX_SCAN_LEN:
        _cap_exceeded(command)
        return command
    out = command
    out = _strip_heredocs(out)
    out = _strip_json(out)
    for rx in (_DASH_C, _ECHO, _SEARCH, _MESSAGE_ARG):
        out = rx.sub(" ", out)
    return out


def mentions_only(command):
    """The complement: what was stripped. Useful for hooks that want to
    explain to the agent WHY something did not trip a rule."""
    stripped = invocations_only(command)
    return command if stripped == command else stripped
