# phonux

The library's own rules. phonux-app, the app that uses it, is a separate repository.

## Comments

Comments say why: a constraint the code cannot show. Clean as you touch: when your work on a file is verified, cut that file's comments to this standard in its own commit. Files you did not touch are out of scope.

- Delete provenance (ticket or queue ids, dates, "before this file existed"). Git history and CHANGELOG.md already hold it.
- Past-bug stories go in CHANGELOG.md or the commit message, leaving at most a one-line pointer.
- Keep a real constraint as 1-2 lines on the line it governs, or make it a test.
- Design notes go in DESIGN.md, never in a link to an outside tracker.

Put this rule in any brief you give a subagent.
