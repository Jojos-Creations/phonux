# Why: the tree is shared and HEAD moves under you

Behind [AGENTS.md §2](../../AGENTS.md) and §11. Every incident here reported success.

## A push that succeeded and carried nothing, 2026-08-20

Four documentation commits were made and `git push origin main` reported success each
time. None reached `origin/main`: another agent had checked out its own branch in the
shared checkout, so the commits landed *there*, and the push shipped an unchanged `main`
ref. The push genuinely succeeded — `git push origin <name>` pushes the local ref named
`<name>`, not what you are standing on.

This is why the rule is `git push origin HEAD:refs/heads/<name>` followed by
`git merge-base --is-ancestor HEAD origin/<name>`. "Push succeeded" is not evidence.

## Ancestry passes when the commit never happened, 2026-08-24

The proof above has a hole. A pre-commit gate correctly refused a commit; the script
printed its success banner anyway, because HEAD was unchanged and therefore trivially an
ancestor of origin. The work had not landed and the verification said it had.

Ancestry proves the *push*. Only a changed SHA proves the *commit*. Capture HEAD before,
capture it after, and assert the two differ before checking ancestry at all.

## A build from a tree someone moved mid-build, 2026-08-20

A mobile build was made after confirming the source tree was on the expected branch at a
known commit. An agent checked out its own branch during the build window. The installed
app failed to start a download it should have started, and about twenty minutes went into
diagnosing a bug that did not exist — firewall, transport security, a launch guard, a
backend selector. Rebuilding from a tree verified clean *in the same command block as the
build* fixed it with no code change.

A contaminated build is worse than a broken one: every layer you inspect looks correct,
because the code you are reading is not the code running. The check has to sit in the
same block as the build, because HEAD can move between two tool calls.

## Two contaminations in one night, and only one has a git-level fix, 2026-08-25

An agent deliberately trying to be careful hit both.

- **Shared index.** It avoided `git add -A` and staged exactly one path — and still
  shipped two of a sibling's staged files under its own commit message, because `git add`
  scopes *staging* while `git commit` commits the whole index. `git commit --only --
  <paths>` fixes this.
- **Shared file.** The same agent staged one document explicitly and swept in about
  twenty lines of a sibling's in-progress rewrite: 232 insertions under a message
  describing far less. A pathspec selects the file, not your changes within it, and
  nothing at the git level fixes that.

A pathspec isolates agents who share a directory. It cannot isolate agents who share a
file — that needs separate worktrees or serialised turns. When splitting work, check that
the file *sets* are disjoint, not just the concerns: three agents given clean separate
scopes ended up in each other's commits over one shared config file.

Afterwards, verify what landed rather than what you intended (`git show --stat HEAD`). And
do not rewrite a pushed commit in a tree others are working in: once a sibling has
committed on top, the rewrite is worse than the contamination, and nothing is lost either
way since their work is inside your commit.

## A night of work destroyed by two correct rules, 2026-08-26

An entire night of output vanished between sessions — application source, a generator
script, two handoff documents, encoded media, every diagnostic frame. Three plan branches
survived, all pointing at the same commit as the mainline, because every agent had been
told to commit nothing while working in a session-scoped temporary directory.

Both rules were individually right. Worktrees belong outside the repo, because one inside
it breaks watching dev servers. Agents do not merge their own work, because the author
does not audit it. Together they guaranteed that hours of work sat uncommitted in a
directory that does not survive the session.

So: "commit nothing" means do not *merge*. Commit freely to a throwaway run branch — that
is not shipping and does not bypass a verifier, since merging is what the verifier gates.
Put worktrees somewhere durable, handoffs in a tracked directory, and before ending a long
session ask what would be gone if the machine rebooted right now.
