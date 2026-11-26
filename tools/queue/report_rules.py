#!/usr/bin/env python3
"""Shared rule module for the verifier-report contract (git pipeline v2, plan
section 6): parsing the fenced `json verifier-report` block a verifier posts
as a PR review, counting the numbered `Evidence required` bullets a PR body
promises, picking the review (the newest COMMENT review by an allowed login
carrying a report fence) that check should actually judge, and applying
the pass/fail rules against all three.

WHY THIS IS ITS OWN MODULE, NOT INLINED IN A CALLER
------------------------------------------------------------------
Three callers need the exact same rules applied the exact same way:
`queue ship --check` and `queue gate-pass` (both in `tools/queue/queue.py`,
which `gate-pass` refuses to run unless this file is origin/main's own, so a
PR cannot rewrite the judge that passes it), and `tools/queue/check_report.py`,
a thin CLI a human or the coordinator runs by hand. The `gate` subcommand
below lets a human re-run the same judgement on saved inputs. A rule
duplicated in two places drifts the day one copy is patched and the other is
not -- so there is exactly one copy, here, stdlib-only.

WHY THE VOCABULARY LIVES IN schema.json, NOT HERE
--------------------------------------------------
`tools/queue/schema.json`, beside this file, is the one copy of every
name this module depends on -- the fenced block's language tag, the
verdict string, the ten fields plan section 6 defines, the PR body's
`## Brief` heading and its `Evidence required:` label -- and of the label
set and body section names `queue.py` writes. Both modules read it from
`Path(__file__).resolve().with_name("schema.json")`, with no environment
variable or command-line override: an override would let the gate be
pointed at a different vocabulary than the one the repo ships. A missing,
undecodable (not valid UTF-8) or unparseable file is a loud non-zero exit
naming the file, never a fallback
to built-in names, because a fallback would let two copies drift apart
silently. The module-level constants below are read out of it once, so the
functions that use them never repeat a name as a string literal.

THE TWO-PART SHA CHECK
-------------------------
GitHub's native review attribute `commit_id` (the sha the review was
posted against, which GitHub sets and a poster cannot forge) and the JSON
body's own self-reported `audited_sha` field (which the verifier writes
itself and could in principle misreport) are two different things. A
verifier could post at the correct head (so `commit_id` matches) while the
body's own `audited_sha` names a different commit, and a check that only
compared one of the two would miss it. `check_report()` below compares
both, independently, against the same `head_sha`, so either one alone
drifting is its own named failure.

WHO MAY JUDGE
-------------
On a public repo any GitHub account can post a COMMENT review, so a review
counts only when its author's `user.login` is on the `verifier_logins:` list
in `.claude/coordinator-config.yaml` (or the logins a caller passes in). Every
other review is dropped before "newest" is chosen, so a stranger's PASS can
never replace a real FAIL. An empty or absent list refuses: nothing is
trusted by default. `author_association` is deliberately not part of the
test: GitHub reports the organization owner's own reviews on an org repo as
`CONTRIBUTOR`, so requiring OWNER/MEMBER/COLLABORATOR would refuse every real
review there, and the login is the part a stranger cannot forge.

A pull request whose head lives in another repository (a fork) is refused
unless it carries the `owner-approved-fork` label, which only an account with
triage rights on the base repository can add.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# --- schema.json: the one copy of the vocabulary -----------------------------
SCHEMA_PATH = Path(__file__).resolve().with_name("schema.json")

# The roles code depends on. A schema may rename what a role is CALLED, never
# drop or add a role: code that asks for a role the file lacks would crash
# somewhere far from the cause, so the loader refuses up front.
LABEL_ROLES = (
    "plan", "p1", "p2", "p3", "p4", "p5", "accepted", "blocked", "needs_verify", "legacy",
)
ISSUE_SECTION_ROLES = (
    "intent", "touches", "evidence_required", "research", "local_insights", "online_insights",
    "api_docs_needed", "gates",
)
PR_SECTION_ROLES = (
    "entry", "brief", "research", "local_insights", "online_insights", "api_docs_needed",
    "handoff", "evidence_report",
)
FIELD_ROLE_TYPES = {
    "verdict": "string",
    "audited_sha": "string",
    "evidence_checked": "array",
    "bullets_expected": "integer",
}
JSON_TYPE_NAMES = {"string": str, "integer": int, "array": list, "boolean": bool}

_HEADING_RE = re.compile(r"#{2,3} \S[^\n]*")
_COLOR_RE = re.compile(r"[0-9a-fA-F]{6}")
GH_LABEL_DESCRIPTION_MAX = 100


class SchemaError(ValueError):
    """schema.json is missing, unparseable, or structurally wrong; the
    message always names the file."""


def _schema_fail(path, what):
    raise SchemaError("%s: %s" % (path, what))


def _object_at(parent, key, path, where):
    value = parent.get(key) if isinstance(parent, dict) else None
    if not isinstance(value, dict):
        _schema_fail(path, "%s must be a JSON object" % where)
    return value


def _validate_role_map(mapping, roles, path, where):
    missing = [r for r in roles if r not in mapping]
    extra = [r for r in mapping if r not in roles]
    if missing or extra:
        _schema_fail(path, "%s must carry exactly the roles %s (missing %s, unknown %s)" % (
            where, list(roles), missing, extra,
        ))


def _validate_headings(mapping, roles, path, where):
    _validate_role_map(mapping, roles, path, where)
    for role, heading in mapping.items():
        if not isinstance(heading, str) or not _HEADING_RE.fullmatch(heading):
            _schema_fail(path, "%s.%s must be a `## ` or `### ` markdown heading, got %r" % (where, role, heading))
    if len(set(mapping.values())) != len(mapping):
        _schema_fail(path, "%s headings must be unique, since one heading names one section" % where)


def _validate_schema(data, path):
    if not isinstance(data, dict):
        _schema_fail(path, "the top level must be a JSON object")

    labels = _object_at(data, "labels", path, "labels")
    _validate_role_map(labels, LABEL_ROLES, path, "labels")
    seen_names = set()
    for role, label in labels.items():
        where = "labels.%s" % role
        if not isinstance(label, dict):
            _schema_fail(path, "%s must be a JSON object" % where)
        name = label.get("name")
        if not isinstance(name, str) or not name or name != name.strip() or "," in name:
            _schema_fail(path, "%s.name must be a non-empty string with no comma or edge whitespace, got %r" % (where, name))
        if name.lower() in seen_names:
            _schema_fail(path, "%s.name %r repeats another label (GitHub label names are case-insensitive)" % (where, name))
        seen_names.add(name.lower())
        color = label.get("color")
        if not isinstance(color, str) or not _COLOR_RE.fullmatch(color):
            _schema_fail(path, "%s.color must be 6 hex digits with no #, got %r" % (where, color))
        description = label.get("description")
        if not isinstance(description, str) or len(description) > GH_LABEL_DESCRIPTION_MAX:
            _schema_fail(path, "%s.description must be a string of at most %d characters" % (where, GH_LABEL_DESCRIPTION_MAX))

    issue_body = _object_at(data, "issue_body", path, "issue_body")
    marker = issue_body.get("marker")
    if not isinstance(marker, str) or not marker:
        _schema_fail(path, "issue_body.marker must be a non-empty string")
    _validate_headings(_object_at(issue_body, "sections", path, "issue_body.sections"),
                       ISSUE_SECTION_ROLES, path, "issue_body.sections")

    pr_body = _object_at(data, "pr_body", path, "pr_body")
    _validate_headings(_object_at(pr_body, "sections", path, "pr_body.sections"),
                       PR_SECTION_ROLES, path, "pr_body.sections")
    brief_labels = _object_at(pr_body, "brief_labels", path, "pr_body.brief_labels")
    _validate_role_map(brief_labels, ("evidence_required",), path, "pr_body.brief_labels")
    if not isinstance(brief_labels["evidence_required"], str) or not brief_labels["evidence_required"]:
        _schema_fail(path, "pr_body.brief_labels.evidence_required must be a non-empty string")

    report = _object_at(data, "verifier_report", path, "verifier_report")
    for key in ("fence_info_string", "pass_verdict"):
        if not isinstance(report.get(key), str) or not report[key]:
            _schema_fail(path, "verifier_report.%s must be a non-empty string" % key)
    fields = _object_at(report, "fields", path, "verifier_report.fields")
    for name, type_name in fields.items():
        if type_name not in JSON_TYPE_NAMES:
            _schema_fail(path, "verifier_report.fields.%s has unknown type %r (want one of %s)" % (
                name, type_name, sorted(JSON_TYPE_NAMES)))
    roles = _object_at(report, "field_roles", path, "verifier_report.field_roles")
    _validate_role_map(roles, tuple(FIELD_ROLE_TYPES), path, "verifier_report.field_roles")
    for role, name in roles.items():
        if name not in fields:
            _schema_fail(path, "verifier_report.field_roles.%s names %r, which is not in verifier_report.fields" % (role, name))
        if fields[name] != FIELD_ROLE_TYPES[role]:
            _schema_fail(path, "verifier_report.fields.%s must have type %r for role %r" % (name, FIELD_ROLE_TYPES[role], role))
    if len(set(roles.values())) != len(roles):
        _schema_fail(path, "verifier_report.field_roles must name four distinct fields")


def load_schema(path):
    """Read and structurally validate a schema.json; raises SchemaError,
    always naming the file, on anything wrong. No default vocabulary exists
    to fall back on."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise SchemaError("%s is not valid UTF-8: %s" % (path, exc))
    except OSError as exc:
        raise SchemaError("%s could not be read: %s" % (path, exc))
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise SchemaError("%s is not valid JSON: %s" % (path, exc))
    _validate_schema(data, path)
    return data


def _load_or_exit():
    try:
        return load_schema(SCHEMA_PATH)
    except SchemaError as exc:
        sys.stderr.write("CANNOT LOAD SCHEMA: %s\n" % (exc,))
        if __name__ == "__main__":
            # The `gate` CLI's contract is one JSON line on stdout.
            print(json.dumps({"ok": False, "reason": "CANNOT RUN -- %s" % (exc,)}))
        raise SystemExit(2)


SCHEMA = _load_or_exit()

# --- fenced verifier-report block -------------------------------------------
# The verifier's spec (.claude/agents/verifier.md) fences its report with
# ```json verifier-report ... ```.
_REPORT = SCHEMA["verifier_report"]
FENCE_INFO_STRING = _REPORT["fence_info_string"]
FENCE_RE = re.compile(
    r"```" + re.escape(FENCE_INFO_STRING) + r"[ \t]*\r?\n(.*?)```",
    re.DOTALL,
)

# --- verifier-report schema (plan section 6) --------------------------------
# field name -> expected JSON type, in schema.json's order.
PASS_VERDICT = _REPORT["pass_verdict"]
REPORT_FIELD_TYPES = {name: JSON_TYPE_NAMES[type_name] for name, type_name in _REPORT["fields"].items()}
VERDICT_FIELD = _REPORT["field_roles"]["verdict"]
AUDITED_SHA_FIELD = _REPORT["field_roles"]["audited_sha"]
EVIDENCE_CHECKED_FIELD = _REPORT["field_roles"]["evidence_checked"]
BULLETS_EXPECTED_FIELD = _REPORT["field_roles"]["bullets_expected"]

# --- PR body shape (plan section 5) -----------------------------------------
BRIEF_HEADING = SCHEMA["pr_body"]["sections"]["brief"]
NEXT_HEADING_RE = re.compile(r"\n##[ \t]")
EVIDENCE_REQUIRED_LABEL = SCHEMA["pr_body"]["brief_labels"]["evidence_required"]
# A bullet is `1.`, `-` or `*`: a Brief written with dashes must count the same
# as a numbered one, or its empty evidence list would match a count of 0.
BULLET_RE = re.compile(r"^[ \t]*(?:\d+\.|[-*])[ \t]")
# The next label in the Brief (`Depends on:`, `Touches:`) ends the evidence
# list, so a dash list under that label is not counted as evidence.
_NEXT_LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z ]*:")
# The status an evidence entry must carry for the report to pass; verifier.md
# writes `{"bullet": 1, "status": "PASS", ...}`, so it is the verdict's own word.
EVIDENCE_PASS_STATUS = PASS_VERDICT
# Field names outside schema.json's four roles. If the schema lacks one, the
# `.get` in check_report yields None and the rule fails closed.
GATE_RERUN_FIELD = "gate_rerun"
GATE_EXIT_FIELD = "exit_code"
SCOPE_OK_FIELD = "scope_ok"
GAPS_FIELD = "gaps"

# --- PR reviews (GitHub REST) ------------------------------------------------
COMMENT_REVIEW_STATE = "COMMENTED"

# --- who may judge -----------------------------------------------------------
CONFIG_RELPATH = (".claude", "coordinator-config.yaml")
VERIFIER_LOGINS_KEY = "verifier_logins"
# Only an account with triage rights on the base repository can add a label.
FORK_APPROVED_LABEL = "owner-approved-fork"
# A GitHub user login, or an app's `name[bot]`.
_LOGIN_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?")
_LOGINS_KEY_RE = re.compile(r"^" + VERIFIER_LOGINS_KEY + r"\s*:(.*)$")
_LOGINS_ITEM_RE = re.compile(r"^\s+-\s*(.*)$")


class AllowlistError(ValueError):
    """`verifier_logins` is absent, empty or malformed, so no reviewer can be trusted; the message
    names the key and where it was read from."""


def _strip_scalar(raw):
    text = raw.strip()
    if text[:1] in ("'", '"'):
        end = text.find(text[0], 1)
        return text[1:end] if end != -1 else text[1:]
    hash_at = text.find("#")
    return (text[:hash_at] if hash_at != -1 else text).strip()


def parse_verifier_logins(text, source):
    """Return the logins listed under the top-level `verifier_logins:` block list in a config's text.

    Read line by line with the standard library, never a YAML parser: only a column-0 key counts, and
    each item is one `  - <login>` line. Raises AllowlistError naming `source` when the key is absent,
    duplicated, lists nothing, or holds an item that is not a GitHub login.
    """
    lines = text.splitlines()
    key_at = [i for i, line in enumerate(lines) if _LOGINS_KEY_RE.match(line)]
    if not key_at:
        raise AllowlistError("%s has no top-level %s: list, so no reviewer is allowed" % (source, VERIFIER_LOGINS_KEY))
    if len(key_at) > 1:
        raise AllowlistError("%s lists %s: more than once" % (source, VERIFIER_LOGINS_KEY))
    inline = _strip_scalar(_LOGINS_KEY_RE.match(lines[key_at[0]]).group(1))
    if inline not in ("", "[]"):
        raise AllowlistError("%s: %s must be a block list, one `  - <login>` per line, found %r"
                             % (source, VERIFIER_LOGINS_KEY, inline))
    logins = []
    for line in lines[key_at[0] + 1:]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[:1] not in (" ", "\t"):
            break
        item = _LOGINS_ITEM_RE.match(line)
        if item is None:
            raise AllowlistError("%s: %s holds a line that is not a `- <login>` item: %s"
                                 % (source, VERIFIER_LOGINS_KEY, line.strip()))
        login = _strip_scalar(item.group(1))
        if not _LOGIN_RE.fullmatch(login):
            raise AllowlistError("%s: %s item %r is not a GitHub login" % (source, VERIFIER_LOGINS_KEY, login))
        logins.append(login)
    if not logins:
        raise AllowlistError("%s: %s lists no login, so no reviewer is allowed" % (source, VERIFIER_LOGINS_KEY))
    return logins


def read_verifier_logins(config_path):
    """Return `parse_verifier_logins` of the file at `config_path`; AllowlistError when it cannot be read."""
    try:
        text = Path(config_path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise AllowlistError("cannot read %s (%s), so no reviewer is allowed" % (config_path, exc)) from None
    return parse_verifier_logins(text, config_path)


def check_logins(logins):
    """Return `logins` as a list once each is a GitHub login; AllowlistError when one is not or none is given."""
    logins = list(logins or [])
    bad = [login for login in logins if not isinstance(login, str) or not _LOGIN_RE.fullmatch(login)]
    if bad:
        raise AllowlistError("not a GitHub login: %s" % ", ".join(repr(b) for b in bad))
    if not logins:
        raise AllowlistError("no allowed reviewer login was given")
    return logins


def is_allowed_login(login, allowed_logins):
    """True when `login` is one of `allowed_logins`, compared case-insensitively as GitHub does."""
    if not isinstance(login, str) or not login:
        return False
    return login.lower() in {a.lower() for a in allowed_logins if isinstance(a, str)}


def review_login(review):
    """The author login of a review in REST shape (`user.login`), or None."""
    user = review.get("user") if isinstance(review, dict) else None
    login = user.get("login") if isinstance(user, dict) else None
    return login if isinstance(login, str) else None


def allowed_reviews(reviews, allowed_logins):
    """The reviews whose author is on `allowed_logins`, in their original order; an empty allowlist keeps none."""
    return [r for r in reviews if isinstance(r, dict) and is_allowed_login(review_login(r), allowed_logins)]


def fork_problem(is_cross_repository, label_names):
    """None when the pull request may be judged, else why not: its head is in another repository and it
    lacks the FORK_APPROVED_LABEL, or it does not say where its head is (`is_cross_repository` not a bool)."""
    if is_cross_repository is False:
        return None
    if is_cross_repository is not True:
        return "the pull request does not say whether its head is in another repository, so it is refused"
    if FORK_APPROVED_LABEL in {n.lower() for n in label_names or [] if isinstance(n, str)}:
        return None
    return ("the pull request's head is in another repository (a fork); the judge refuses it unless someone "
            "with triage rights adds the %r label" % FORK_APPROVED_LABEL)


def rest_pr_fork_problem(pr):
    """fork_problem() for a pull request object from GitHub REST `GET /repos/{o}/{r}/pulls/{n}`.

    A head repository that is null (a deleted fork) counts as a fork."""
    base_repo = (pr.get("base") or {}).get("repo") if isinstance(pr.get("base"), dict) else None
    head = pr.get("head") if isinstance(pr.get("head"), dict) else {}
    head_repo = head.get("repo")
    if not isinstance(base_repo, dict) or not isinstance(base_repo.get("full_name"), str):
        cross = None
    elif not isinstance(head_repo, dict) or not isinstance(head_repo.get("full_name"), str):
        cross = True
    else:
        cross = head_repo["full_name"].lower() != base_repo["full_name"].lower()
    labels = [label.get("name") for label in pr.get("labels") or [] if isinstance(label, dict)]
    return fork_problem(cross, labels)

# A submitted_at this old sorts behind every real review; used only when a
# review is missing or has an unparseable submitted_at, so a malformed
# timestamp never wins "newest" by accident.
_MIN_DATETIME = datetime.min.replace(tzinfo=timezone.utc)


def _type_ok(value, expected_type):
    """isinstance(), except bool is never accepted where int is expected --
    JSON's `true`/`false` decode to Python bool, which is a subclass of int,
    so a plain isinstance(value, int) check would silently accept `"pr":
    true` as a valid pr number."""
    if expected_type is bool:
        return isinstance(value, bool)
    if expected_type is int:
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, expected_type)


def parse_report(review_body):
    """Extract and JSON-parse the fenced ```json verifier-report block from a
    PR review body. Returns the parsed dict, or None if no such fence exists
    or its contents do not parse as JSON -- never raises, since a malformed
    or absent fence is exactly the "missing or malformed" case callers must
    treat as a hard refusal, not an exception to catch themselves."""
    if not isinstance(review_body, str):
        return None
    match = FENCE_RE.search(review_body)
    if match is None:
        return None
    try:
        parsed = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return parsed


def _brief_section(pr_body):
    """The text of the PR body's `## Brief` section, from just after the
    heading to (not including) the next top-level `## ` heading, or end of
    string if `## Brief` is the last section."""
    start = pr_body.find(BRIEF_HEADING)
    if start == -1:
        return ""
    rest = pr_body[start + len(BRIEF_HEADING):]
    end_match = NEXT_HEADING_RE.search(rest)
    return rest[:end_match.start()] if end_match else rest


def count_evidence_bullets(pr_body):
    """Count the bullets (`1.`, `-` or `*`) under the PR body's `## Brief`
    section's `Evidence required:` label (plan section 5's PR body shape:
    `Evidence required:` followed by a `1. <bullet>` list), up to the next
    `Label:` line or the end of the section. Returns 0 if the
    section or label is absent -- an empty count, not an error, since a
    malformed body is caught by other checks (schema validity, bullets_expected
    equality), not by this counter refusing to run."""
    section = _brief_section(pr_body)
    label_at = section.find(EVIDENCE_REQUIRED_LABEL)
    if label_at == -1:
        return 0
    rest = section[label_at + len(EVIDENCE_REQUIRED_LABEL):]
    count = 0
    for line in rest.splitlines():
        if _NEXT_LABEL_RE.match(line):
            break
        if BULLET_RE.match(line):
            count += 1
    return count


def _parse_submitted_at(value):
    if not value:
        return _MIN_DATETIME
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return _MIN_DATETIME
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def newest_comment_review(reviews, allowed_logins):
    """Given every page of GET /repos/{o}/{r}/pulls/{n}/reviews concatenated
    (GitHub paginates 30 per page by default, 100 max, oldest first -- see
    docs.github.com/en/rest/pulls/reviews), return the newest review by an
    allowed login whose `state` is COMMENTED, by `submitted_at`. Returns None
    if no such review exists. A caller must paginate to the end itself: this
    function trusts the list it is given is complete and does not fetch anything."""
    comment_reviews = [r for r in allowed_reviews(reviews, allowed_logins) if r.get("state") == COMMENT_REVIEW_STATE]
    if not comment_reviews:
        return None
    return max(comment_reviews, key=lambda r: _parse_submitted_at(r.get("submitted_at")))


def newest_report_review(reviews, allowed_logins):
    """Return the newest COMMENTED review by an allowed login whose body carries
    a verifier-report fence, by `submitted_at`, or None. A review by any other
    login is dropped first, so it never governs. A later comment with no fence
    ("nit: typo") is not a report and must not hide the report before it; a
    later report of any verdict, even one with unparseable JSON, does govern,
    so a newer FAIL beats an older PASS. Never raises on a malformed list."""
    candidates = [
        r for r in allowed_reviews(reviews if isinstance(reviews, list) else [], allowed_logins)
        if r.get("state") == COMMENT_REVIEW_STATE
        and isinstance(r.get("body"), str) and FENCE_RE.search(r["body"])
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda r: _parse_submitted_at(r.get("submitted_at")))


def check_report(report, pr_body, head_sha, commit_id=None, require_commit_id=False):
    """Apply every plan-section-6 rule to a parsed verifier-report against
    the PR body it was posted for and the sha it must be judged against.
    Returns (ok, reason): ok is a bool, reason is a human-readable string
    naming the first rule that failed, or "ok" on success. Never raises on a
    malformed report -- a schema violation is a named reason, not an
    exception the caller must also handle.

    A PASS needs all of: the verdict, `audited_sha` equal to the head, a
    non-empty `gate_rerun` whose every entry has exit code 0, `scope_ok`
    true, empty `gaps`, every evidence entry's status PASS, and the three
    evidence counts equal. `commit_id` is the review's own sha; a caller that
    has a real review passes `require_commit_id=True`, so a review with no
    commit_id fails instead of skipping the check. `check_report.py`, which
    judges report text with no review behind it, leaves it False."""
    if report is None:
        return False, "missing or malformed verifier-report fence"
    if not isinstance(report, dict):
        return False, "verifier-report fence did not parse to a JSON object"

    for field, expected_type in REPORT_FIELD_TYPES.items():
        if field not in report:
            return False, "verifier-report missing required field %r" % (field,)
        if not _type_ok(report[field], expected_type):
            return False, "verifier-report field %r has the wrong type (expected %s)" % (
                field, expected_type.__name__,
            )

    if report[VERDICT_FIELD] != PASS_VERDICT:
        return False, "%s is %r, not %s" % (VERDICT_FIELD, report[VERDICT_FIELD], PASS_VERDICT)

    audited_sha = report[AUDITED_SHA_FIELD]
    if audited_sha != head_sha:
        return False, "%s %s does not match head sha %s" % (AUDITED_SHA_FIELD, audited_sha, head_sha)

    if require_commit_id and not commit_id:
        return False, "review has no commit_id, so it cannot be tied to head sha %s" % (head_sha,)
    if commit_id is not None and commit_id != head_sha:
        return False, "review commit_id %s does not match head sha %s" % (commit_id, head_sha)

    gate_rerun = report.get(GATE_RERUN_FIELD)
    if not isinstance(gate_rerun, list) or not gate_rerun:
        return False, "%s is empty: no gate command was re-run, so a PASS proves nothing" % (GATE_RERUN_FIELD,)
    for index, entry in enumerate(gate_rerun, 1):
        exit_code = entry.get(GATE_EXIT_FIELD) if isinstance(entry, dict) else None
        if not _type_ok(exit_code, int):
            return False, "%s entry %d has no integer %s" % (GATE_RERUN_FIELD, index, GATE_EXIT_FIELD)
        if exit_code != 0:
            return False, "%s entry %d exited %d, not 0" % (GATE_RERUN_FIELD, index, exit_code)

    if report.get(SCOPE_OK_FIELD) is not True:
        return False, "%s is %r, not true" % (SCOPE_OK_FIELD, report.get(SCOPE_OK_FIELD))

    gaps = report.get(GAPS_FIELD)
    if not isinstance(gaps, list) or gaps:
        return False, "%s is not an empty list: a PASS names no gaps" % (GAPS_FIELD,)

    bullets_expected = report[BULLETS_EXPECTED_FIELD]
    evidence_checked = report[EVIDENCE_CHECKED_FIELD]
    for index, entry in enumerate(evidence_checked, 1):
        status = entry.get("status") if isinstance(entry, dict) else None
        if status != EVIDENCE_PASS_STATUS:
            return False, "%s entry %d has status %r, not %s" % (
                EVIDENCE_CHECKED_FIELD, index, status, EVIDENCE_PASS_STATUS)
    actual_bullets = count_evidence_bullets(pr_body)
    if not (len(evidence_checked) == bullets_expected == actual_bullets):
        return False, (
            "evidence count mismatch: len(%s)=%d, %s=%d, "
            "count_evidence_bullets(pr_body)=%d -- all three must be equal"
            % (EVIDENCE_CHECKED_FIELD, len(evidence_checked), BULLETS_EXPECTED_FIELD, bullets_expected,
               actual_bullets)
        )

    return True, "ok"


def _load_json_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _load_text_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


# The config beside this checkout's tools/queue, which docs/merge-without-status.md requires be origin/main's.
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2].joinpath(*CONFIG_RELPATH)


def _gate_result(ok, reason, code):
    print(json.dumps({"ok": ok, "reason": reason}))
    return code


def _cmd_gate(args):
    try:
        reviews = _load_json_file(args.reviews)
        pr = _load_json_file(args.pr)
        pr_body = _load_text_file(args.pr_body) if args.pr_body else None
    except (OSError, json.JSONDecodeError) as exc:
        return _gate_result(False, "CANNOT RUN -- %s" % (exc,), 2)

    if not isinstance(reviews, list):
        return _gate_result(False, "CANNOT RUN -- --reviews did not contain a JSON array", 2)
    if not isinstance(pr, dict):
        return _gate_result(False, "CANNOT RUN -- --pr did not contain a JSON object (GET .../pulls/<n>)", 2)
    if pr_body is None:
        pr_body = pr.get("body") if isinstance(pr.get("body"), str) else ""

    try:
        if args.allowed_reviewer:
            allowed = check_logins(args.allowed_reviewer)
        else:
            allowed = read_verifier_logins(args.config or DEFAULT_CONFIG_PATH)
    except AllowlistError as exc:
        return _gate_result(False, "NO ALLOWED REVIEWER -- %s" % (exc,), 1)

    pr_head = (pr.get("head") or {}).get("sha") if isinstance(pr.get("head"), dict) else None
    if pr_head != args.head:
        return _gate_result(False, "--pr's head sha %s is not --head %s" % (pr_head, args.head), 1)

    problem = rest_pr_fork_problem(pr)
    if problem is not None:
        return _gate_result(False, problem, 1)

    review = newest_report_review(reviews, allowed)
    if review is None:
        return _gate_result(False, "no COMMENTED review with a verifier-report fence found on the PR from an allowed "
                                   "reviewer (%s)" % ", ".join(allowed), 1)

    report = parse_report(review.get("body", ""))
    ok, reason = check_report(report, pr_body, args.head, commit_id=review.get("commit_id"),
                              require_commit_id=True)
    return _gate_result(ok, reason, 0 if ok else 1)


def main(argv=None):
    """Run the `gate` subcommand, which judges saved PR reviews against a PR and head sha.

    Only reviews by an allowed login count: `--allowed-reviewer` (repeatable) when given, else the
    `verifier_logins:` list in `--config` (default: this checkout's `.claude/coordinator-config.yaml`).
    A fork pull request is refused unless it carries the `owner-approved-fork` label.

    Args:
        argv: Command-line arguments; `None` reads `sys.argv`.

    Returns:
        The subcommand's exit code: 0 on PASS, 1 on a rule failure (including no allowed reviewer and
        a fork), 2 when an input cannot be read or has the wrong JSON shape.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    gate = subparsers.add_parser(
        "gate",
        help="check the newest COMMENT review by an allowed reviewer carrying a verifier-report fence against the PR",
    )
    gate.add_argument("--head", required=True, help="the PR's current head sha (40hex)")
    gate.add_argument("--reviews", required=True, help="path to a JSON file: every page of GET .../reviews, concatenated")
    gate.add_argument("--pr", required=True, help="path to a JSON file: GET .../pulls/<n>, for the head and fork checks")
    gate.add_argument("--pr-body", help="path to a text file holding the PR's raw body (default: --pr's body)")
    gate.add_argument("--allowed-reviewer", action="append", metavar="LOGIN",
                      help="a login whose reviews count (repeatable); replaces the config's verifier_logins")
    gate.add_argument("--config", help="the coordinator-config.yaml to read verifier_logins from")
    gate.set_defaults(func=_cmd_gate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
