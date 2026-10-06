#!/usr/bin/env python3
"""Shared rule module for the verifier-report contract (git pipeline v2, plan
section 6): parsing the fenced `json verifier-report` block a verifier posts
as a PR review, counting the numbered `Evidence required` bullets a PR body
promises, picking the review that check should actually judge, and applying
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
NUMBERED_BULLET_RE = re.compile(r"^[ \t]*\d+\.[ \t]")

# --- PR reviews (GitHub REST) ------------------------------------------------
COMMENT_REVIEW_STATE = "COMMENTED"

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
    """Count the numbered bullets under the PR body's `## Brief` section's
    `Evidence required:` label (plan section 5's PR body shape: `Evidence
    required:` followed by a `1. <bullet>` numbered list). Returns 0 if the
    section or label is absent -- an empty count, not an error, since a
    malformed body is caught by other checks (schema validity, bullets_expected
    equality), not by this counter refusing to run."""
    section = _brief_section(pr_body)
    label_at = section.find(EVIDENCE_REQUIRED_LABEL)
    if label_at == -1:
        return 0
    rest = section[label_at + len(EVIDENCE_REQUIRED_LABEL):]
    return sum(1 for line in rest.splitlines() if NUMBERED_BULLET_RE.match(line))


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


def newest_comment_review(reviews):
    """Given every page of GET /repos/{o}/{r}/pulls/{n}/reviews concatenated
    (GitHub paginates 30 per page by default, 100 max, oldest first -- see
    docs.github.com/en/rest/pulls/reviews), return the newest review whose
    `state` is COMMENTED, by `submitted_at`. Returns None if no COMMENT
    review exists. A caller must paginate to the end itself: this function
    trusts the list it is given is complete and does not fetch anything."""
    comment_reviews = [r for r in reviews if r.get("state") == COMMENT_REVIEW_STATE]
    if not comment_reviews:
        return None
    return max(comment_reviews, key=lambda r: _parse_submitted_at(r.get("submitted_at")))


def check_report(report, pr_body, head_sha, commit_id=None):
    """Apply every plan-section-6 rule to a parsed verifier-report against
    the PR body it was posted for and the sha it must be judged against.
    Returns (ok, reason): ok is a bool, reason is a human-readable string
    naming the first rule that failed, or "ok" on success. Never raises on a
    malformed report -- a schema violation is a named reason, not an
    exception the caller must also handle."""
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

    if commit_id is not None and commit_id != head_sha:
        return False, "review commit_id %s does not match head sha %s" % (commit_id, head_sha)

    bullets_expected = report[BULLETS_EXPECTED_FIELD]
    evidence_checked = report[EVIDENCE_CHECKED_FIELD]
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


def _cmd_gate(args):
    try:
        reviews = _load_json_file(args.reviews)
        pr_body = _load_text_file(args.pr_body)
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "reason": "CANNOT RUN -- %s" % (exc,)}))
        return 2

    if not isinstance(reviews, list):
        print(json.dumps({"ok": False, "reason": "CANNOT RUN -- --reviews did not contain a JSON array"}))
        return 2

    review = newest_comment_review(reviews)
    if review is None:
        print(json.dumps({"ok": False, "reason": "no COMMENTED review found on the PR"}))
        return 1

    report = parse_report(review.get("body", ""))
    ok, reason = check_report(report, pr_body, args.head, commit_id=review.get("commit_id"))
    print(json.dumps({"ok": ok, "reason": reason}))
    return 0 if ok else 1


def main(argv=None):
    """Run the `gate` subcommand, which judges saved PR reviews against a PR body and head sha.

    Args:
        argv: Command-line arguments; `None` reads `sys.argv`.

    Returns:
        The subcommand's exit code: 0 on PASS, 1 on a rule failure, 2 when an
        input cannot be read or is not a JSON array.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    gate = subparsers.add_parser(
        "gate",
        help="check the newest COMMENT review on a PR against its body and head sha",
    )
    gate.add_argument("--head", required=True, help="the PR's current head sha (40hex)")
    gate.add_argument("--reviews", required=True, help="path to a JSON file: every page of GET .../reviews, concatenated")
    gate.add_argument("--pr-body", required=True, help="path to a text file holding the PR's raw body")
    gate.set_defaults(func=_cmd_gate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
