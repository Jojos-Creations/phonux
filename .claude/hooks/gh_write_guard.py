#!/usr/bin/env python3
# GENERATED FILE -- DO NOT EDIT. Regenerate by running claude-config's tools/publish-template.py (see ADR 0007). Source: ~/.claude/hooks/gh_write_guard.py
"""PreToolUse guard on Bash: refuse the `gh` and `queue` writes section 8 of
PLAN-2026-09-27-git-pipeline-v2.md reserves to one seat, plus two writes no
seat may ever make (PLAN section 12's "Build-time refinements", point 3).

TWO INDEPENDENT LAYERS
-----------------------
1. GLOBAL, every repo, every seat, including the main session and even a
   command naming a repo that has never heard of this pipeline:
     - `gh pr merge ... --admin` is always refused. GitHub cannot tell an
       agent from the owner holding the same token, so the bypass the
       ruleset grants the owner (section 7's `bypass_mode: "pull_request"`)
       must never be reachable from inside Claude at all.
     - a ruleset or branch-protection WRITE via `gh api` -- method PUT,
       POST, PATCH or DELETE, explicit via -X/--method or IMPLIED by
       -f/-F/--field/--raw-field/--input with no method given -- on
       `repos/<o>/<r>/rulesets`, `repos/<o>/<r>/branches/<b>/protection`, or
       `orgs/<o>/rulesets`. A READ of any of these (GET, the default with no
       body flag) is never touched by this rule.
   These two run before anything below and do not consult the marker: a
   command can name a repo that has never migrated with `--repo` or a
   `repos/<o>/<r>/` path, and the old pipeline never uses either verb.

2. SEAT-GATED, only when the TARGET repo's own `.claude/coordinator-
   config.yaml` carries `pipeline: github` (`pipeline_marker.pipeline_mode`,
   imported from this same directory -- see WHY NO SUBPROCESS below). The
   target of a `gh` call is the repo named by `--repo`/`-R` (never on `gh
   api`, which has no such flag) or a
   `repos/<o>/<r>/` path inside the command, resolved to a local checkout
   with `pipeline_marker.resolve_repo_for_remote`; absent either, it is the
   session `cwd`'s own repo. Section 8's table, reproduced as data below:
   only the coordinator or main session may create or edit an issue, create
   or edit a PR's body/title/labels, call `gh pr ready`, or call
   `gh pr update-branch`; only the verifier may post `gh pr review` or call
   `gh pr merge --match-head-commit`; nobody
   but the verifier may call `gh pr merge` at all EXCEPT the main session,
   which may call a PLAIN `gh pr merge` (no `--match-head-commit`) since
   GitHub's own required check is the actual gate there, never this hook
   (section 8's "why the owner can merge by hand" paragraph); every other
   subagent (plan-worker, plan-researcher, plan-auditor, anything else) gets
   read-only `gh`/`git` and commits on `plan/<id>`, nothing that writes
   issue or PR state. The `queue` tool's own subcommands are gated the same
   way, after skipping queue.py's OWN leading options to find the real verb:
   `--repo-root` (and every argparse abbreviation of it, 3+ characters
   counting the dashes; the LAST one wins), `-h`/`--help`, and a bare `--`.
   The documented call shape puts `--repo-root` first, and taking the first
   token as the verb let it skip every rule below. A queue call's target is
   the repo its `--repo-root` names, else the session `cwd`'s repo; a
   `--repo-root` that cannot be resolved with certainty (an unexpanded `$`
   or backtick, a leftover `~`, a glob character, a missing path, no repo at
   or above it) is target "unknown", judged like "github". A leading `~` is
   read both as HOME expansion and as the literal `<cwd>/~...` when that
   exists (zsh leaves it unexpanded after `=`), and the stricter marker
   wins. `--repo`/`-R`
   owner/repo reading is a `gh` rule only: for queue.py `--repo` is an
   abbreviation of `--repo-root`.

   Queue seats, in a "github" or "unknown" target: the reads `log`, `status`,
   `list`, `order`, `lint` and `doctor` are open to EVERY seat, in every
   target mode including "error" (the 2026-09-30 owner ruling, recorded as a
   dated note under plan section 8, which lists the reads in the coordinator
   row only). `ship` with `--confirm` (or an abbreviation of 4+ characters,
   `--co` upward, since argparse accepts them) is verifier-only; `ship`
   without it is verifier, coordinator or main. `gate-pass`, which posts the
   gate commit status, is verifier-only like `ship --confirm`, and joins the
   fail-closed hint words so an unterminated quote next to it is denied.
   Every other verb, an unrecognised verb, and an unrecognised leading option
   (fail closed) are coordinator or main only.

   Commit statuses: a `gh api` call that is not a GET and names a statuses
   endpoint -- `repos/<o>/<r>/statuses/<sha>`, the `repositories/<id>/statuses/`
   alias, with or without a leading slash or the https://api.github.com prefix
   (any scheme or host case, any port, an empty one too) -- is refused for
   EVERY seat, the verifier included (it posts only through
   `queue gate-pass`), when the target's marker is "github" or cannot be
   resolved, and allowed when it is "yaml" or "none". A GET never reaches the
   rule. The method is read from `-X`/`--method` in every spelling gh accepts
   (`-XPOST`, `-X=POST`, a cluster such as `-iXPOST`), or implied POST by a
   body flag (`-fk=v`, `-Fk=v`, `--field`, `--raw-field`, `--input`); `--cache`
   takes a value, so `--cache 1h` never reads as the path, and so does the
   token after a body flag even when it starts with `-` (`-f -X=GET` is a
   POST in gh, never a GET method flag). The ruleset rule above shares this
   parser.
   Accepted over-denials, all of them errors on the safe side: a non-GET
   status write whose owner and repo have no checkout under ~/.claude or a
   direct child of ~/git (git worktrees are not found), the {owner}/{repo}
   placeholder from any cwd, and the repositories/ID alias in every mode
   (its target cannot be resolved). Reads never reach the rule.
   WHERE THE CALL IS FOUND. A gh or queue call is read wherever the shell
   would run it: past subshells, braces, if/while/for/case, `!`, function
   bodies, `$( )`, backticks, `${ }` and bare `<( )`/`>( )` (a double-quoted
   process substitution is inert and is not scanned), leading expansions and
   redirections, VAR= assignments, wrappers (`env`, `nohup`, `time`,
   `timeout`, `xargs`, ...), `bash -c` strings, `eval`, `find -exec`, `python3`
   with its options, `-m` or a globbed script word, and a quoted spelling of
   the command word. A curl, wget, httpie, python or node line that itself
   names a protected GitHub endpoint with a write marker is read as the
   `gh api` write it makes. After `queue ship`, a word the shell may rewrite
   (an expansion or a glob) could be `--confirm`, so it is read as one.
   Anything this scanner cannot read raises and takes the fail-closed path
   below.
   Bypasses left open include (a sample, not the whole open set):
   command-word variable, glued expansion, gh alias, pipe into sh,
   source or script file, python -c subprocess, IFS splitting,
   gh api pulls or issues, cd into another repository,
   brace-expanded command word, wrapper outside the table,
   script held in a variable, arguments on stdin, trap or here-string,
   ANSI-C-quoted command word.
   Only a sandbox network allowlist truly limits HTTP clients, so that rule
   is a speed bump.

   A repo whose marker reads "yaml" or "none" is not on this pipeline yet;
   seat rules do not apply there at all (the OLD pipeline's own tools and
   hooks govern it), which is why the old pipeline's `gh pr merge` for a
   template PR still works unchanged mid-migration. A marker that exists but
   cannot be read, or resolves to neither "github" nor "yaml"
   (`pipeline_mode`'s "error"), or a `--repo`/`-R` target this machine has no
   local checkout for at all, is NOT treated as "no marker" -- it is refused
   outright for every seat-gated verb, because guessing which side of the
   fork a repo is on is exactly the failure section 5's tripwire exists to
   prevent.

SEAT IDENTITY (PLAN section 8, second paragraph)
-------------------------------------------------
A row below is "subagent, agent_type: X" only when BOTH `agent_type` and
`agent_id` are non-empty on the payload -- the same pair `resource_guard.py`
and `turn_budget.py` already key on for the identical reason. `agent_type`
set with `agent_id` empty is a top-level `claude --agent <name>` session,
not a dispatched, independently-auditing subagent, and falls into the
"main session" row: this is precisely what stops a bare `claude --agent
verifier` session from self-granting merge power (PLAN section 8, closing
`refute-2-harness-coupling.md` defect 1).

WHY NO SUBPROCESS, STDLIB ONLY
--------------------------------
This fires on every Bash call. `pipeline_marker.py` reads
`.claude/coordinator-config.yaml` and `.git/config` directly off disk for
the same reason -- a `git`/`gh` subprocess here adds latency to every single
Bash call and a new way to fail open the moment it is slow or missing.

FAIL CLOSED, BUT ONLY WHERE THERE IS SOMETHING TO CLOSE
---------------------------------------------------------
No `gh` or `queue` invocation anywhere in the command text: allow silently,
zero output, no matter what else went wrong parsing the rest of the line --
this hook has nothing to say about a command it was never asked to guard.
A `gh` or `queue` invocation IS present and something throws while working
out whether it is a write this hook must gate (an unterminated quote, an
unclosed substitution and nesting past the depth limit are the demonstrated
shapes, but the guard is deliberately this hook's own try/except, not a
promise that only those throw) -- deny, worded as a parse failure, never a
guess at what the write would have done. The hint that decides this reads
the text without its quote and backslash characters.
"""

import fnmatch
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline_marker as pm  # noqa: E402  (see module docstring, WHY NO SUBPROCESS)

# ---------------------------------------------------------------------------
# Finding the invocations. One quote-correct pass turns the command text into
# simple commands of words; a second step reads each command word through the
# shell's own prefixes (assignments, reserved words, wrappers, shells, find,
# python, HTTP clients). A body the shell would run (a substitution, a
# `-c` string, an eval) is scanned as command text, to a depth of _MAX_DEPTH.
# A construct this scanner cannot read raises, and main()'s own fail-closed
# rule then decides: a raise is only ever swallowed where no gh or queue
# write is in sight.
#
# The nine tables below are read at call time, never baked into regexes.
# ---------------------------------------------------------------------------
_MAX_DEPTH = 8
_BRACE_CAP = 32  # a word that expands to more results than this counts as a match

# Words that are not themselves the command; the next word is.
_SKIP_WORDS = ("!", "{", "if", "then", "elif", "else", "while", "until", "do")

# Wrapper name -> (options that take a value, positional words before the command).
_WRAPPERS = {
    "env": (("-u", "-S"), 0),
    "command": ((), 0),
    "builtin": ((), 0),
    "nohup": ((), 0),
    "time": ((), 0),
    "timeout": (("-s", "-k"), 1),
    "exec": (("-a",), 0),
    "xargs": (("-I", "-n", "-P", "-L", "-s", "-E"), 0),
    "nice": (("-n",), 0),
    "stdbuf": (("-i", "-o", "-e"), 0),
    "repeat": ((), 1),
    "setsid": ((), 0),
    "ionice": (("-c", "-n"), 0),
    "doas": (("-u",), 0),
    "sudo": (("-u", "-g", "--user", "--group"), 0),
    "noglob": ((), 0),
}
_SHELLS = ("sh", "bash", "zsh", "dash", "ksh", "ash", "mksh")
_FIND_EXEC = ("-exec", "-execdir", "-ok", "-okdir")
_PY_VALUE_OPTS = ("-W", "-X", "--check-hash-based-pycs")
_HTTP_CLIENTS = ("curl", "wget", "http", "https", "node")
_HTTP_METHODS = ("POST", "PUT", "PATCH", "DELETE")
_HTTP_DATA_FLAGS = ("-d", "-F", "-T", "--data", "--data-raw", "--data-binary",
                    "--data-urlencode", "--data-ascii", "--form", "--form-string", "--json",
                    "--upload-file", "--post-data", "--post-file", "--body-data",
                    "--body-file")
# The endpoint families a client line may not write to, as they follow the host.
_HTTP_PATHS = (r"repos/[^/\s'\"]+/[^/\s'\"]+/statuses",
               r"repos/[^/\s'\"]+/[^/\s'\"]+/rulesets",
               r"repos/[^/\s'\"]+/[^/\s'\"]+/branches/[^/\s'\"]+/protection",
               r"orgs/[^/\s'\"]+/rulesets",
               r"repositories/[^/\s'\"]+/statuses")


class _Tok(str):
    """One shell word with its quotes removed. `dyn`: the shell may rewrite it
    (an expansion, a glob or brace pattern, an ANSI-C escape), so the text is
    not what the command receives. `lead`: length of a leading unquoted
    expansion, which vanishes when it expands to nothing; `tail_dyn`: more
    than that one expansion is present."""
    dyn = False
    lead = None
    tail_dyn = False


_PLAIN_RE = re.compile(r"[^\s'\"\\$`;&|<>()#]+")
_DYN_PLAIN_RE = re.compile(r"[*?\[]|\{[^}]*(?:,|\.\.)")
_PAREN_SPECIAL_RE = re.compile(r"[\\'\"`()]")
_BRACE_SPECIAL_RE = re.compile(r"[\\'\"`{}$]")
_DQ_SPECIAL_RE = re.compile(r"[\\\"$`]")
_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!\-]")
_VAR_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_FD_RE = re.compile(r"^(?:[0-9]+|\{[A-Za-z_][A-Za-z0-9_]*\})$")
_PY_RE = re.compile(r"^python(?:[0-9]+(?:\.[0-9]+)*[a-z]?)?$")
_BRACE_GROUP_RE = re.compile(r"\{([^{}]*,[^{}]*)\}")
_REDIRECTS = ("<<<", "<<-", ">>", ">&", ">|", "<&", "<>", "<<", "<", ">")


class _DepthError(Exception):
    pass


def _find_backtick(text, j):
    """Index of the backtick closing the one that opened just before `j`."""
    n = len(text)
    while j < n:
        k = text.find("`", j)
        if k < 0:
            break
        s = k
        while s > j and text[s - 1] == "\\":
            s -= 1
        if (k - s) % 2 == 0:
            return k
        j = k + 1
    raise ValueError("unterminated backtick")


def _skip_dq(text, j):
    """Index past the double quote that closes the one at `j`."""
    n = len(text)
    j += 1
    while j < n:
        m = _DQ_SPECIAL_RE.search(text, j)
        if m is None:
            break
        k = m.start()
        c = text[k]
        if c == '"':
            return k + 1
        if c == "\\":
            j = k + 2
        elif c == "`":
            j = _find_backtick(text, k + 1) + 1
        elif text[k + 1:k + 2] == "(":
            j = _match_paren(text, k + 1) + 1
        else:
            j = k + 1
    raise ValueError("unterminated double quote")


def _match_paren(text, i):
    """Index of the parenthesis closing the one at `i`, past quoted text."""
    depth = 0
    j = i
    while True:
        m = _PAREN_SPECIAL_RE.search(text, j)
        if m is None:
            raise ValueError("unterminated parenthesis")
        k = m.start()
        c = text[k]
        if c == "\\":
            j = k + 2
        elif c == "'":
            e = text.find("'", k + 1)
            if e < 0:
                raise ValueError("unterminated single quote")
            j = e + 1
        elif c == '"':
            j = _skip_dq(text, k)
        elif c == "`":
            j = _find_backtick(text, k + 1) + 1
        else:
            if c == "(":
                depth += 1
            else:
                depth -= 1
                if depth == 0:
                    return k
            j = k + 1


def _match_brace(text, i):
    """Index of the brace closing the one at `i`, past quoted text."""
    depth = 0
    j = i
    while True:
        m = _BRACE_SPECIAL_RE.search(text, j)
        if m is None:
            raise ValueError("unterminated brace")
        k = m.start()
        c = text[k]
        if c == "\\":
            j = k + 2
        elif c == "'":
            e = text.find("'", k + 1)
            if e < 0:
                raise ValueError("unterminated single quote")
            j = e + 1
        elif c == '"':
            j = _skip_dq(text, k)
        elif c == "`":
            j = _find_backtick(text, k + 1) + 1
        elif c == "$":
            j = _match_paren(text, k + 1) + 1 if text[k + 1:k + 2] == "(" else k + 1
        else:
            if c == "{":
                depth += 1
            else:
                depth -= 1
                if depth == 0:
                    return k
            j = k + 1


class _Lexer(object):
    """Splits command text into simple commands, each a list of _Tok words.
    Separators, subshell parentheses and redirections (with their targets)
    never reach a command; every substitution body is scanned on the spot."""

    def __init__(self, text, depth, out, comments):
        self.text = text
        self.depth = depth
        self.out = out
        self.comments = comments
        self.cmds = []
        self.words = []
        self.parts = []
        self.started = False
        self.events = 0
        self.lead = None
        self.dyn = False
        self.drop_next = False

    def sub(self, body, comments=True):
        _scan_text(body, self.depth + 1, self.out, comments)

    def end_word(self, drop=False):
        if not self.started:
            return
        value = "".join(self.parts)
        if self.drop_next:
            self.drop_next = False
        elif not drop:
            tok = _Tok(value)
            if self.dyn:
                tok.dyn = True
            if self.lead is not None and self.lead <= len(value):
                tok.lead = self.lead
                tok.tail_dyn = self.events > 1
            self.words.append(tok)
        self.parts = []
        self.started = False
        self.events = 0
        self.lead = None
        self.dyn = False

    def end_command(self):
        self.end_word()
        self.drop_next = False
        if self.words:
            self.cmds.append(self.words)
            self.words = []

    def add(self, s, dyn=False, expansion=False):
        if expansion and not self.started:
            self.lead = len(s)
        self.started = True
        self.parts.append(s)
        if dyn:
            self.dyn = True
            self.events += 1

    def dollar(self, i, in_dq):
        """Read the expansion at text[i] == "$"; return the index after it."""
        text = self.text
        nx = text[i + 1:i + 2]
        if nx == "(":
            if text[i + 2:i + 3] == "(":
                outer = _match_paren(text, i + 1)
                try:
                    inner = _match_paren(text, i + 2)
                except ValueError:
                    inner = -1
                if inner == outer - 1:
                    self.sub(text[i + 3:inner])
                    self.add(text[i:outer + 1], True, True)
                    return outer + 1
            end = _match_paren(text, i + 1)
            self.sub(text[i + 2:end])
            self.add(text[i:end + 1], True, True)
            return end + 1
        if nx == "{":
            end = _match_brace(text, i + 1)
            body = text[i + 2:end]
            if body[:1] in (" ", "\t", "\n", "|"):
                self.sub(body)
            else:
                self.sub(body, comments=False)
            self.add(text[i:end + 1], True, True)
            return end + 1
        if nx == "'" and not in_dq:
            j = i + 2
            while True:
                k = text.find("'", j)
                if k < 0:
                    raise ValueError("unterminated ANSI-C quote")
                s = k
                while s > j and text[s - 1] == "\\":
                    s -= 1
                if (k - s) % 2 == 0:
                    break
                j = k + 1
            body = text[i + 2:k]
            if "\\" in body:
                self.add(text[i:k + 1], True)
            else:
                self.add(body)
            return k + 1
        if nx == '"' and not in_dq:
            return i + 1
        m = _NAME_RE.match(text, i + 1)
        if m is not None:
            self.add(text[i:m.end()], True, True)
            return m.end()
        self.add("$")
        return i + 1

    def double_quote(self, i):
        text = self.text
        self.started = True
        j = i + 1
        while True:
            m = _DQ_SPECIAL_RE.search(text, j)
            if m is None:
                raise ValueError("unterminated double quote")
            k = m.start()
            self.parts.append(text[j:k])
            c = text[k]
            if c == '"':
                return k + 1
            if c == "\\":
                nx = text[k + 1:k + 2]
                if nx == "":
                    raise ValueError("unterminated double quote")
                if nx in ('$', "`", '"', "\\"):
                    self.parts.append(nx)
                elif nx != "\n":
                    self.parts.append("\\" + nx)
                j = k + 2
            elif c == "`":
                end = _find_backtick(text, k + 1)
                self.sub(_unescape_backtick(text[k + 1:end]))
                self.add(text[k:end + 1], True)
                j = end + 1
            else:
                j = self.dollar(k, True)

    def run(self):
        text = self.text
        n = len(text)
        i = 0
        while i < n:
            m = _PLAIN_RE.match(text, i)
            if m is not None:
                chunk = m.group()
                self.add(chunk, _DYN_PLAIN_RE.search(chunk) is not None)
                i = m.end()
                continue
            c = text[i]
            if c in " \t\r\f\v":
                self.end_word()
                i += 1
            elif c == "\n":
                self.end_command()
                i += 1
            elif c == "'":
                k = text.find("'", i + 1)
                if k < 0:
                    raise ValueError("unterminated single quote")
                self.started = True
                self.parts.append(text[i + 1:k])
                i = k + 1
            elif c == '"':
                i = self.double_quote(i)
            elif c == "\\":
                nx = text[i + 1:i + 2]
                if nx == "\n":
                    pass
                elif nx:
                    self.add(nx)
                else:
                    self.add("\\")
                i += 2
            elif c == "$":
                i = self.dollar(i, False)
            elif c == "`":
                end = _find_backtick(text, i + 1)
                self.sub(_unescape_backtick(text[i + 1:end]))
                self.add(text[i:end + 1], True, True)
                i = end + 1
            elif c == "#":
                if self.started or not self.comments:
                    self.add("#")
                    i += 1
                else:
                    k = text.find("\n", i)
                    i = n if k < 0 else k
            elif c == ";":
                self.end_command()
                i += 1
            elif c == "|":
                self.end_command()
                i += 2 if text[i + 1:i + 2] in ("|", "&") else 1
            elif c == "&":
                if text[i + 1:i + 2] == ">":
                    self.end_word()
                    self.drop_next = True
                    i += 3 if text[i + 2:i + 3] == ">" else 2
                else:
                    self.end_command()
                    i += 2 if text[i + 1:i + 2] == "&" else 1
            elif c == "(" or c == ")":
                self.end_command()
                i += 1
            else:  # "<" or ">"
                if text[i + 1:i + 2] == "(":
                    end = _match_paren(text, i + 1)
                    self.sub(text[i + 2:end])
                    self.add(text[i:end + 1], True)
                    i = end + 1
                    continue
                if self.started and _FD_RE.match("".join(self.parts)):
                    self.end_word(drop=True)
                else:
                    self.end_word()
                for op in _REDIRECTS:
                    if text.startswith(op, i):
                        i += len(op)
                        break
                self.drop_next = True
        self.end_command()
        return self.cmds


def _unescape_backtick(body):
    return re.sub(r"\\([`\\$])", r"\1", body)


def _scan_text(text, depth, out, comments=True):
    if depth > _MAX_DEPTH:
        raise _DepthError("command nesting deeper than %d" % _MAX_DEPTH)
    for words in _Lexer(text, depth, out, comments).run():
        _interpret(words, 0, len(words), depth, out)


def _walk_opts(words, i, end, valopts):
    """(index past the leading options, [(option, value)] for the value options)."""
    vals = []
    while i < end:
        t = words[i]
        if t == "--":
            return i + 1, vals
        if len(t) < 2 or t[0] != "-":
            return i, vals
        if t in valopts:
            if i + 1 < end:
                vals.append((str(t), str(words[i + 1])))
            i += 2
            continue
        if t[1] == "-":
            name, eq, val = t.partition("=")
            if name in valopts:
                if eq:
                    vals.append((name, val))
                elif i + 1 < end:
                    vals.append((name, str(words[i + 1])))
                    i += 1
            i += 1
            continue
        took_next = False
        for k in range(1, len(t)):
            if "-" + t[k] in valopts:
                if k + 1 < len(t):
                    vals.append(("-" + t[k], str(t[k + 1:])))
                elif i + 1 < end:
                    vals.append(("-" + t[k], str(words[i + 1])))
                    took_next = True
                break
        i += 2 if took_next else 1
    return i, vals


def _skip_wrapper(words, i, end, name, depth, out):
    """Index of the word after a wrapper and its options, or None when the
    wrapper does not run what follows (`command -v`) or the rest was scanned."""
    valopts, positional = _WRAPPERS[name]
    start = i + 1
    j, vals = _walk_opts(words, start, end, valopts)
    if name == "command":
        for t in words[start:j]:
            if t[:1] == "-" and t[1:2] != "-" and ("v" in t or "V" in t):
                return None
    if name == "env":
        pieces = [v for opt, v in vals if opt == "-S"]
        if pieces:
            _scan_text(" ".join(pieces + [str(t) for t in words[j:end]]), depth + 1, out)
            return None
    return j + positional


def _shell_script(words, i, end, depth, out):
    """Scan the `-c` string of a shell, past its own options."""
    j = i + 1
    c_seen = False
    while j < end:
        t = words[j]
        if t == "--":
            j += 1
            break
        if len(t) > 1 and t[0] in "-+":
            if t in ("-o", "+o", "-O", "+O", "--rcfile", "--init-file"):
                j += 2
                continue
            if t[0] == "-" and t[1] != "-" and "c" in t[1:]:
                c_seen = True
            j += 1
            continue
        break
    if c_seen and j < end:
        _scan_text(str(words[j]), depth + 1, out)


def _find_exec(words, i, end, depth, out):
    terminator = None
    for j in range(i + 1, end):
        if words[j] not in _FIND_EXEC:
            continue
        if terminator is None:
            terminator = [end] * (end + 1)
            for k in range(end - 1, i, -1):
                terminator[k] = k if words[k] in (";", "+") else terminator[k + 1]
        _interpret(words, j + 1, terminator[j + 1], depth, out)


def _brace_expand(word):
    """The results of expanding the comma groups in `word`, or None when more
    than _BRACE_CAP would be produced (counted as they appear, so a word of
    forty groups never builds its product)."""
    pending = [word]
    done = []
    while pending:
        w = pending.pop()
        m = _BRACE_GROUP_RE.search(w)
        if m is None:
            done.append(w)
        else:
            pending.extend(w[:m.start()] + alt + w[m.end():] for alt in m.group(1).split(","))
        if len(pending) + len(done) > _BRACE_CAP:
            return None
    return done


def _script_matches(word):
    """True when `word` names (or may glob to) the queue tool's script."""
    candidates = _brace_expand(word)
    if candidates is None:
        return True
    for cand in candidates:
        base = os.path.basename(cand)
        if base in ("queue", "queue.py"):
            return True
        if any(ch in base for ch in "*?[") and (
                fnmatch.fnmatchcase("queue.py", base) or fnmatch.fnmatchcase("queue", base)):
            return True
    return False


def _python(words, i, end, depth, out):
    _http(words, i, end, "python", out)
    j = i + 1
    while j < end:
        t = words[j]
        if t == "--":
            j += 1
            break
        if len(t) < 2 or t[0] != "-":
            break
        if t[1] == "-":
            name, eq, _ = t.partition("=")
            j += 2 if (name in _PY_VALUE_OPTS and not eq) else 1
            continue
        step = 1
        for k in range(1, len(t)):
            c = t[k]
            if c == "c":
                return  # python -c: its string is not scanned
            if c == "m":
                module = t[k + 1:] or (str(words[j + 1]) if j + 1 < end else "")
                if module.rsplit(".", 1)[-1] == "queue":
                    out.append(("queue", list(words[j + (1 if t[k + 1:] else 2):end])))
                return
            if "-" + c in _PY_VALUE_OPTS:
                if k + 1 == len(t):
                    step = 2
                break
        j += step
    if j < end and _script_matches(str(words[j])):
        out.append(("queue", list(words[j + 1:end])))


def _http(words, i, end, base, out):
    """Synthesise a `gh api` write when a client line itself names a protected
    GitHub endpoint with a write marker."""
    text = " ".join(words[i + 1:end])
    pattern = r"api\.github\.com(?::[0-9]*)?/((?:%s)(?:[/?#][^\s'\"]*)?)" % "|".join(_HTTP_PATHS)
    m = re.search(pattern, text, re.IGNORECASE)
    if m is None:
        return
    if _http_write(words, i, end, base, text):
        out.append(("gh", ["api", "-X", "POST", m.group(1)]))


def _http_write(words, i, end, base, text):
    if base not in ("curl", "wget"):
        if re.search(r"\b(?:%s)\b" % "|".join(_HTTP_METHODS), text):
            return True
        if re.search(r"\.(?:post|put|patch|delete)\s*\(", text, re.IGNORECASE):
            return True
        return bool(re.search(r"(?:^|\s)[\w.\[\]-]+(?::=|=[^=]|@)", text)) \
            and base in ("http", "https")
    method = None
    data = False
    j = i + 1
    while j < end:
        t = words[j]
        j += 1
        if len(t) < 2 or t[0] != "-":
            continue
        if t[1] == "-":
            name, eq, val = t.partition("=")
            if name in ("--request", "--method"):
                if eq:
                    method = val
                elif j < end:
                    method = str(words[j])
                    j += 1
            elif name in _HTTP_DATA_FLAGS:
                data = True
            continue
        for k in range(1, len(t)):
            c = t[k]
            if "-" + c in _HTTP_DATA_FLAGS:
                data = True
                break
            if c == "X":
                if k + 1 < len(t):
                    method = t[k + 1:]
                elif j < end:
                    method = str(words[j])
                    j += 1
                break
            if c in "AbcCDeEHKmoPQrtuUwxyYz":
                if k + 1 == len(t):
                    j += 1
                break
    if method is not None:
        return method.lstrip("=").upper() in _HTTP_METHODS
    return data


def _interpret(words, i, end, depth, out):
    """Find the gh or queue call a simple command (words[i:end]) runs, if any."""
    while i < end:
        w = words[i]
        if w.lead is not None:
            if w.lead >= len(w):
                i += 1
                continue
            if w.tail_dyn:
                return
            v = str(w[w.lead:])
        else:
            v = str(w)
            if _VAR_ASSIGN_RE.match(v):
                i += 1
                continue
        if v in _SKIP_WORDS:
            i += 1
            continue
        if v == "function":
            i += 2
            continue
        base = os.path.basename(v)
        if base in _WRAPPERS:
            i = _skip_wrapper(words, i, end, base, depth, out)
            if i is None:
                return
            continue
        if base in _SHELLS:
            _shell_script(words, i, end, depth, out)
        elif base == "eval":
            _scan_text(" ".join(words[i + 1:end]), depth + 1, out)
        elif base == "find":
            _find_exec(words, i, end, depth, out)
        elif _PY_RE.match(base):
            _python(words, i, end, depth, out)
        elif base == "gh":
            out.append(("gh", list(words[i + 1:end])))
        elif base in ("queue", "queue.py"):
            out.append(("queue", list(words[i + 1:end])))
        elif base in _HTTP_CLIENTS:
            _http(words, i, end, base, out)
        return


def find_invocations(command_text):
    """[("gh", rest_tokens), ("queue", rest_tokens), ...] for every simple
    command in `command_text` that invokes `gh` or the `queue` tool, wherever
    the shell would run it. May raise on text this scanner cannot read --
    left uncaught on purpose, see the module docstring's FAIL CLOSED section."""
    out = []
    _scan_text(command_text, 0, out)
    return out


# ---------------------------------------------------------------------------
# `gh api` method/path parsing, shared by the global ruleset check and by
# seat-rule target resolution (a `repos/<o>/<r>/...` endpoint path is one of
# the two ways a command can name its target repo).
# ---------------------------------------------------------------------------
_API_VALUE_FLAGS = ("-X", "--method", "-H", "--header", "-q", "--jq",
                     "--input", "--hostname", "-t", "--template", "-p", "--preview",
                     "--cache")
_API_BODY_FLAGS = ("-f", "--field", "-F", "--raw-field")
# gh api's short flags: `i` is the only boolean one. In a single-dash cluster
# (`-iXPOST`) the first of these takes the rest of the token, minus a leading
# "=", as its value, else the next token.
_API_CLUSTER_VALUE_CHARS = "XfFHqtp"


def _short_cluster_flag(tok):
    """(flag, attached value) for a single-dash cluster, or (None, "") when it
    holds only boolean shorthands."""
    for j in range(1, len(tok)):
        if tok[j] in _API_CLUSTER_VALUE_CHARS:
            rest = tok[j + 1:]
            return tok[j], (rest[1:] if rest.startswith("=") else rest)
    return None, ""


def _parse_api_call(args):
    """(method, path) for the arguments after `gh api`. `method` is upper-
    cased and defaults to "GET", except it becomes the IMPLIED "POST" the
    plan names when a body flag (-f/-F/--field/--raw-field/--input) is
    given with no explicit -X/--method anywhere in the call."""
    method = None
    path = None
    implied_post = False
    i = 0
    n = len(args)
    while i < n:
        tok = args[i]
        if tok in ("-X", "--method"):
            if i + 1 < n:
                method = args[i + 1].upper()
                i += 2
                continue
            i += 1
            continue
        if tok.startswith("--method="):
            method = tok.split("=", 1)[1].upper()
            i += 1
            continue
        if tok in _API_BODY_FLAGS or tok == "--input":
            implied_post = True
            i += 2  # the next token is the value even when it starts with "-", as in gh
            continue
        if any(tok.startswith(f + "=") for f in _API_BODY_FLAGS + ("--input",)):
            implied_post = True
            i += 1
            continue
        if tok in _API_VALUE_FLAGS:
            if i + 1 < n:
                i += 2
                continue
            i += 1
            continue
        if any(tok.startswith(f + "=") for f in _API_VALUE_FLAGS if f.startswith("--")):
            i += 1
            continue
        if tok.startswith("-") and tok[1:2] not in ("", "-"):
            flag, value = _short_cluster_flag(tok)
            if flag is not None and value == "" and i + 1 < n:
                value = args[i + 1]
                i += 1
            if flag == "X":
                method = value.upper()
            elif flag in ("f", "F"):
                implied_post = True
            i += 1
            continue
        if tok.startswith("-"):
            i += 1
            continue
        if path is None:
            path = tok
        i += 1
    if method is None:
        method = "POST" if implied_post else "GET"
    return method, (path or "")


_API_URL_PREFIX_RE = re.compile(r"^https?://api\.github\.com(:[0-9]*)?/", re.IGNORECASE)


def _normalize_api_path(path):
    return _API_URL_PREFIX_RE.sub("", path, count=1).lstrip("/")


_RULESETS_RE = re.compile(r"^repos/[^/]+/[^/]+/rulesets(/|$)")
_PROTECTION_RE = re.compile(r"^repos/[^/]+/[^/]+/branches/[^/]+/protection(/|$)")
_ORG_RULESETS_RE = re.compile(r"^orgs/[^/]+/rulesets(/|$)")


def _is_protected_admin_path(path):
    p = _normalize_api_path(path)
    return bool(
        _RULESETS_RE.match(p) or _PROTECTION_RE.match(p) or _ORG_RULESETS_RE.match(p)
    )


_OWNER_REPO_RE = re.compile(r"^repos/([^/]+)/([^/]+)")


def _extract_owner_repo(gh_tokens):
    """"owner/repo" named by `--repo`/`-R` in a `gh` call other than `gh api`,
    or by a `repos/<o>/<r>/...` endpoint on a `gh api` call, or None (meaning:
    use the session cwd's own repo instead, per the plan's fallback rule)."""
    is_api = bool(gh_tokens) and gh_tokens[0] == "api"
    if not is_api:  # gh api has no --repo/-R: that text is a flag value there, never a target
        for i, tok in enumerate(gh_tokens):
            if tok in ("--repo", "-R") and i + 1 < len(gh_tokens):
                val = gh_tokens[i + 1]
                if "/" in val:
                    return val
            if tok.startswith("--repo="):
                return tok.split("=", 1)[1]
    if is_api:
        _, path = _parse_api_call(gh_tokens[1:])
        m = _OWNER_REPO_RE.match(_normalize_api_path(path))
        if m:
            return "%s/%s" % (m.group(1), m.group(2))
    return None


def _target_mode(gh_tokens, cwd):
    """"github" | "yaml" | "none" | "error" for the repo a `gh` invocation
    targets. "error" covers both `pipeline_mode`'s own unreadable-config
    case AND a named `--repo`/`-R` target this machine has no local
    checkout for at all -- both are "cannot tell which side of the fork
    this is on", never treated as "no marker". A `queue` call uses
    `_queue_target_mode` instead: queue.py has no `--repo`."""
    owner_repo = _extract_owner_repo(gh_tokens)
    if owner_repo:
        root = pm.resolve_repo_for_remote(owner_repo)
        if root is None:
            return "error"
        return pm.pipeline_mode(root)
    root = pm.find_repo_root(cwd)
    if root is None:
        return "error"
    return pm.pipeline_mode(root)


# ---------------------------------------------------------------------------
# GLOBAL checks -- every repo, every seat, no marker read at all.
# ---------------------------------------------------------------------------

def check_gh_global(tokens):
    if not tokens:
        return None
    if tokens[0] == "pr" and len(tokens) > 1 and tokens[1] == "merge":
        rest = tokens[2:]
        if "--admin" in rest or any(t.startswith("--admin=") for t in rest):
            return ("gh_write_guard: `gh pr merge --admin` is refused for every "
                    "Claude seat, in every repo. The ruleset's admin bypass is the "
                    "owner's own escape hatch, never this harness's (plan section 7/8).")
    if tokens[0] == "api":
        method, path = _parse_api_call(tokens[1:])
        if method in ("PUT", "POST", "PATCH", "DELETE") and _is_protected_admin_path(path):
            return ("gh_write_guard: `gh api` %s on `%s` is a ruleset or branch-"
                    "protection write, refused for every Claude seat, in every "
                    "repo. Reads (GET) of the same path stay allowed "
                    "(plan section 7/8/12)." % (method, path))
    return None


_STATUSES_RE = re.compile(r"^(repos/[^/]+/[^/]+|repositories/[^/]+)/statuses(/|$)")


def check_gh_statuses(tokens, cwd):
    """Deny a non-GET `gh api` call to a commit-statuses endpoint, for every
    seat, when the target is a github-marker repo or cannot be resolved."""
    if not tokens or tokens[0] != "api":
        return None
    method, path = _parse_api_call(tokens[1:])
    if method == "GET":
        return None
    p = _normalize_api_path(path)
    if not _STATUSES_RE.match(p):
        return None
    if p.startswith("repositories/"):
        mode = "error"  # the alias names no owner/repo, so no marker can be read for it
    else:
        mode = _target_mode(tokens, cwd)
    if mode in ("yaml", "none"):
        return None
    return ("gh_write_guard: `gh api` %s on `%s` writes a commit status, refused "
            "for every Claude seat in a github-pipeline repo (or one whose "
            "target cannot be resolved); the verifier posts the gate status "
            "only through `queue gate-pass`. Reads (GET) stay allowed." % (method, path))


# ---------------------------------------------------------------------------
# SEAT checks -- only reached once `_target_mode` says "github"; "error"
# is handled by the caller before this runs at all.
# ---------------------------------------------------------------------------

def _has_flag(args, names):
    eq_prefixes = tuple("%s=" % n for n in names)
    return any(t in names or t.startswith(eq_prefixes) for t in args)


def _check_gh_seat_rule(verb, args, seat):
    """One reason string to deny, or None to allow -- PLAN section 8's
    table, reproduced as code. Only called once the target repo's marker
    already reads "github"."""
    if verb == "pr_merge":
        has_match_head = _has_flag(args, ("--match-head-commit",))
        if seat == "verifier":
            if has_match_head:
                return None
            return ("gh_write_guard: the verifier seat may only `gh pr merge` "
                    "with --match-head-commit (plan section 8).")
        if seat == "coordinator":
            return ("gh_write_guard: the coordinator seat may never `gh pr merge` "
                    "-- only the verifier merges (owner ruling, plan section 8).")
        if seat == "main":
            if has_match_head:
                return ("gh_write_guard: `gh pr merge --match-head-commit` is "
                        "refused outside the verifier seat (plan section 8).")
            return None  # plain merge: GitHub's own required check is the gate
        return "gh_write_guard: this seat may not run `gh pr merge` (plan section 8)."

    if verb == "pr_review":
        if seat == "verifier":
            return None
        return ("gh_write_guard: only the verifier seat may post `gh pr review` "
                "(the verdict review; plan section 8).")

    if verb == "pr_edit":
        touches_body_or_title = _has_flag(args, ("--body", "--body-file", "--title"))
        if touches_body_or_title:
            if seat in ("coordinator", "main"):
                return None
            return ("gh_write_guard: only the coordinator or main session may "
                    "edit a PR's body or title (plan section 8).")
        if seat in ("coordinator", "main"):
            return None
        return ("gh_write_guard: only the coordinator or main session may edit "
                "PR labels (plan section 8).")

    if verb in ("pr_create", "pr_ready", "pr_update_branch"):
        if seat in ("coordinator", "main"):
            return None
        label = {"pr_create": "gh pr create", "pr_ready": "gh pr ready",
                  "pr_update_branch": "gh pr update-branch"}[verb]
        return ("gh_write_guard: only the coordinator or main session may run "
                "`%s` (plan section 8)." % label)

    if verb in ("issue_edit", "issue_create"):
        if seat in ("coordinator", "main"):
            return None
        label = "gh issue edit" if verb == "issue_edit" else "gh issue create"
        return ("gh_write_guard: only the coordinator or main session may run "
                "`%s` -- the issue is frozen from acceptance on (plan section 5/8)."
                % label)

    return None


_GH_VERB_TABLE = {
    ("pr", "merge"): "pr_merge",
    ("pr", "review"): "pr_review",
    ("pr", "edit"): "pr_edit",
    ("pr", "create"): "pr_create",
    ("pr", "ready"): "pr_ready",
    ("pr", "update-branch"): "pr_update_branch",
    ("issue", "edit"): "issue_edit",
    ("issue", "create"): "issue_create",
}


def check_gh_seat(tokens, seat, cwd):
    if len(tokens) < 2:
        return None
    verb = _GH_VERB_TABLE.get((tokens[0], tokens[1]))
    if verb is None:
        return None  # a read, or a gh subcommand this table does not gate

    mode = _target_mode(tokens, cwd)
    if mode == "error":
        return ("gh_write_guard: this target repo's pipeline marker could not "
                "be read (`.claude/coordinator-config.yaml` missing, unreadable, "
                "or naming a repo with no local checkout); refusing "
                "`gh %s %s` rather than guessing which seat rules apply."
                % (tokens[0], tokens[1]))
    if mode != "github":
        return None  # not on this pipeline yet: the old rules govern instead

    return _check_gh_seat_rule(verb, tokens[2:], seat)


# Verb table for a github or unknown target. The reads are open to every seat
# in every target mode (the 2026-09-30 owner ruling, a dated note under plan
# section 8, which lists them in the coordinator row only). Every write verb
# is coordinator/main; `ship` is its own case, verifier-only with --confirm.
# A verb in neither set fails closed for a subagent seat.
_ANY_SEAT_QUEUE_VERBS = frozenset({"log", "status", "list", "order", "lint", "doctor"})
_COORDINATOR_QUEUE_VERBS = frozenset({
    "stub", "research", "audit-record", "accept", "implemented", "block",
    "unblock", "retire", "retire-pr", "init", "migrate",
})


def _is_abbrev(name, full, min_len):
    """`name` is `full` or an argparse-style abbreviation of it, at least
    `min_len` characters long counting the dashes. queue.py leaves
    argparse's `allow_abbrev` on, so `--r` reaches `--repo-root`."""
    return len(name) >= min_len and full.startswith(name)


class _QueueArgv(object):
    """queue.py's own leading argv, parsed the way its top-level argparse
    reads it. `help`: argparse prints help and exits 0. `bad_option`: the
    first unrecognised leading option, or None. `verb`: the first
    non-option token (or the one after a bare `--`), or None when there is
    none. `args`: everything after the verb. `repo_root`: the LAST
    `--repo-root` value seen before the verb, or None."""

    def __init__(self, help=False, bad_option=None, verb=None, args=(), repo_root=None):
        self.help = help
        self.bad_option = bad_option
        self.verb = verb
        self.args = list(args)
        self.repo_root = repo_root


def _parse_queue_argv(tokens):
    repo_root = None
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        if tok == "--":
            if i + 1 < n:
                return _QueueArgv(verb=tokens[i + 1], args=tokens[i + 2:], repo_root=repo_root)
            return _QueueArgv(repo_root=repo_root)
        if not tok.startswith("-"):
            return _QueueArgv(verb=tok, args=tokens[i + 1:], repo_root=repo_root)
        if tok == "-h" or _is_abbrev(tok, "--help", 3):
            return _QueueArgv(help=True, repo_root=repo_root)
        name, eq, value = tok.partition("=")
        if _is_abbrev(name, "--repo-root", 3):
            if eq:
                repo_root = value
                i += 1
            elif i + 1 < n:
                repo_root = tokens[i + 1]  # argparse takes the next token verbatim
                i += 2
            else:
                return _QueueArgv(repo_root=repo_root)  # argparse exits 2, runs nothing
            continue
        return _QueueArgv(bad_option=tok, repo_root=repo_root)
    return _QueueArgv(repo_root=repo_root)


def _queue_confirm(args):
    """True when a token after the verb is `--confirm`, `--confirm=...`, or
    an abbreviation argparse would accept as it (`--co` upward), or when a
    token the shell rewrites (an expansion, a glob, an ANSI-C escape) could
    become one: that is read as `--confirm`, so only the verifier may run it."""
    return any(getattr(tok, "dyn", False) or _is_abbrev(tok.partition("=")[0], "--confirm", 4)
               for tok in args)


# Characters that mean the shell would have rewritten the path this guard is
# reading literally, so what queue.py actually receives is not knowable here.
_UNRESOLVABLE_CHARS = ("$", "`", "*", "?", "[", "{")


def _queue_target_mode(repo_root_value, cwd):
    """"github" | "yaml" | "none" | "error" | "unknown" for a `queue` call.
    No `--repo-root`: the cwd's repo, as for a `gh` call. With one: the repo
    at or above it, resolved against `cwd`. "unknown" (only ever produced
    here) means the value cannot be resolved with certainty; the caller
    judges it like "github". A missing path is checked before
    `find_repo_root`, which walks up from a missing path to the cwd's repo
    and would silently read the wrong marker. A leading `~` is read both
    ways (HOME expansion, and the literal `<cwd>/~...` when that exists) and
    the strictest mode wins: zsh leaves `~` unexpanded after `=` and inside
    quotes, and this guard cannot see quoting."""
    if repo_root_value is None:
        root = pm.find_repo_root(cwd)
        if root is None:
            return "error"
        return pm.pipeline_mode(root)
    if any(ch in repo_root_value for ch in _UNRESOLVABLE_CHARS):
        return "unknown"
    expanded = os.path.expanduser(repo_root_value)
    if expanded.startswith("~"):
        return "unknown"
    candidates = [Path(cwd) / expanded]  # an absolute `expanded` replaces cwd
    if repo_root_value.startswith("~"):
        literal = Path(cwd) / repo_root_value
        if literal.exists():  # a missing literal is not where queue.py can run
            candidates.append(literal)
    return max((_path_mode(p) for p in candidates), key=_MODE_STRICTNESS.__getitem__)


_MODE_STRICTNESS = {"error": 3, "github": 2, "unknown": 2, "yaml": 1, "none": 1}


def _path_mode(path):
    if not path.exists():
        return "unknown"
    root = pm.find_repo_root(path)
    if root is None:
        return "unknown"
    return pm.pipeline_mode(root)


def check_queue_seat(tokens, seat, cwd):
    parsed = _parse_queue_argv(tokens)
    verb = parsed.verb
    if parsed.help or (verb is None and parsed.bad_option is None):
        return None  # argparse exits without running anything
    if verb in _ANY_SEAT_QUEUE_VERBS:
        return None  # allowed for every seat regardless of marker/mode
    shown = verb if verb is not None else parsed.bad_option

    mode = _queue_target_mode(parsed.repo_root, cwd)
    if mode == "error":
        return ("gh_write_guard: this target repo's pipeline marker could not "
                "be read; refusing `queue %s` rather than guessing which seat "
                "rules apply." % shown)
    if mode in ("yaml", "none"):
        return None  # the tripwire (pipeline_marker.py) already governs this repo
    where = ("" if mode == "github" else
             " (its --repo-root could not be resolved with certainty, so it is "
             "treated as a github-pipeline repo)")

    if verb == "ship":
        if _queue_confirm(parsed.args):
            if seat == "verifier":
                return None
            return ("gh_write_guard: only the verifier seat may run "
                    "`queue ship --confirm` (plan section 8)." + where)
        if seat in ("verifier", "coordinator", "main"):
            return None
        return "gh_write_guard: this seat may not run `queue ship` (plan section 8)." + where

    if verb == "gate-pass":
        if seat == "verifier":
            return None
        return ("gh_write_guard: only the verifier seat may run `queue gate-pass`, "
                "the one route to the gate status (plan section 8)." + where)

    if seat in ("coordinator", "main"):
        return None
    if verb in _COORDINATOR_QUEUE_VERBS:
        return ("gh_write_guard: only the coordinator or main session may run "
                "`queue %s` (plan section 8)." % verb + where)
    return ("gh_write_guard: `queue %s` is not a recognised queue verb or option; "
            "refusing it for this seat rather than guessing (fail closed)."
            % shown + where)


# ---------------------------------------------------------------------------
# Fail-closed heuristic: used ONLY when something above throws. Deliberately
# textual and cheap -- by construction this path never got as far as a real
# tokenization, so it cannot rely on one.
# ---------------------------------------------------------------------------
_GH_OR_QUEUE_HINT_RE = re.compile(r"(?<![A-Za-z0-9_.-])(gh|queue|queue\.py)\b")
_WRITE_VERB_HINT_RE = re.compile(
    r"\b(merge|review|edit|ready|create|update-branch|label|accept|implemented|"
    r"block|unblock|retire|ship|stub|research|audit-record|init|migrate|gate-pass|api)\b"
)
_QUOTE_CHARS_RE = re.compile(r"['\"\\]")


def _looks_like_state_write(command_text):
    # Quote and backslash characters are dropped first: a word the shell would
    # read as gh (g''h, g\h) must hint the same as gh itself.
    text = _QUOTE_CHARS_RE.sub("", command_text)
    return bool(_GH_OR_QUEUE_HINT_RE.search(text) and _WRITE_VERB_HINT_RE.search(text))


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def _run_checks(command, cwd, seat):
    for kind, rest in find_invocations(command):
        if kind == "gh":
            reason = check_gh_global(rest)
            if reason:
                deny(reason)
            reason = check_gh_statuses(rest, cwd)
            if reason:
                deny(reason)
            reason = check_gh_seat(rest, seat, cwd)
            if reason:
                deny(reason)
        elif kind == "queue":
            reason = check_queue_seat(rest, seat, cwd)
            if reason:
                deny(reason)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never block on a malformed payload

    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command") or ""
    if not command:
        sys.exit(0)

    cwd = payload.get("cwd") or os.getcwd()
    agent_type = payload.get("agent_type") or ""
    agent_id = payload.get("agent_id") or ""
    # See SEAT IDENTITY above: agent_type alone (agent_id empty) is a
    # top-level `--agent` session, not a dispatched subagent -- main session.
    seat = agent_type if (agent_type and agent_id) else "main"

    try:
        _run_checks(command, cwd, seat)
    except SystemExit:
        raise
    except Exception:
        if _looks_like_state_write(command):
            deny("gh_write_guard: an internal error occurred while parsing this "
                 "command, and a gh/queue write verb appears to be present; "
                 "refusing rather than guessing (fail closed).")
        # else: no recognisable gh/queue write verb -- allow silently, per
        # the module docstring's FAIL CLOSED section.
    sys.exit(0)


if __name__ == "__main__":
    main()
