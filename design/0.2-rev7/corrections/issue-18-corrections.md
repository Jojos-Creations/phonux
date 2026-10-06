# AUDIT CORRECTIONS for issue #18 (against main 0aede6c); these supersede the issue text where they differ

Issue: saved shape, overrides, lenient restore (phonux-saved-overrides-and-template-paths). Verdict: REVISE (text edits only). Same stale-baseline line fix as #23 ("Code baseline ... locate by symbol, not by line").

## Facts that hold
- reorderPanel (usePanelManager.ts:441), resizePanel (:446), PanelsAPI.reanchor (useProvidePanels.ts:234), setFormFactor (:229-231); useWorkspacePersistence success/failure handlers (lines 42-69); pins' expected behaviours match today's code.
- Vendored 0.1.0 projectWorkspaceState and isWorkspaceState are in test/fixtures/compat-0.1.0/pkg/workspaceState.js.
- `grep layout[E]poch` prints 0 now; `grep -rl overrides` finds 9 .ts files.
- Resolver behaviours bullets 6-9 assume are confirmed in panelSettings.ts: user layer formFactor outside formFactors -> note `override-dropped`; user parkable:false at a non-phone tier -> `override-dropped`; tuning.rowGap 999 at the instance layer -> note `invalid-saved-setting` under `lenient`; unknown key `evictable` -> same note; permanent:true through host layer -> conflict kind `not-view-settable`, layer `host`, key `parkable`; C3 persist:'session' forces rememberLayout false; C1 parkable:false forces restoreVisibility 'live'; library `overflow` is 'scroll', a legacy entry reads 'park'.
- Restored parked panels are held by the reconcile effect at usePanelManager.ts:482 (`markHeld(p.id, effective(p).hideStickiness)`), so bullet 8's "parked is held per hideStickiness" comes for free.
- Not yet on the tree when the audit ran: test/pins-placement.test.ts (#10), PanelsInput.workspaceDefaults (#15), restoreSettled (#16: useWorkspacePersistence returns { restoreSettled }).
- F = 88 and N = 6 are internally consistent; barrel unchanged; no stale number.

## Corrections (OLD -> NEW)
1. Bullet 11's source check contradicts the saved shape (projectWorkspaceState must build an `overrides` member into the saved file; the existing writesOf helper flags any object-literal property named overrides; enclosingFunction returns the nearest named function, so an inner helper in reconcile would not count as "inside reconcileWorkspace").
   OLD: "overrides is written only by recordOverride and clearOverrides in panelWindow.ts and by reconcileWorkspace in workspacePlan.ts, and applied only by a placement: test/source-invariants.test.ts parses every non-test source file with the TypeScript AST, collects each object-literal property or assignment named overrides, and requires each to sit inside one of those three functions (control: it finds exactly those three writers; a scratch copy with a fourth writer in useProvidePanels.ts turns it red)"
   NEW: "overrides of a PanelWindow is written only by recordOverride and clearOverrides in panelWindow.ts and by reconcileWorkspace in workspacePlan.ts (the one `overrides` member projectWorkspaceState builds into the saved file is the fourth, file-side site): test/source-invariants.test.ts parses every non-test source file in the root and panels/ with the TypeScript AST (the existing writesOf and enclosingFunction helpers), collects each object-literal property, shorthand or assignment named overrides, and requires the nearest enclosing named function of each to be recordOverride, clearOverrides, reconcileWorkspace or projectWorkspaceState, so reconcileWorkspace writes the entry's overrides in its own body, not in an inner helper (control: it finds exactly those four sites; a scratch copy with a fifth writer in useProvidePanels.ts turns it red)". This also removes "and applied only by a placement", which has no check.
2. recordOverride cannot "skip the root" (no rootId in its signature).
   OLD: "`recordOverride(entries: readonly PanelWindow[], key: 'anchor' | 'formFactor' | 'parkable', ids: readonly string[]): PanelWindow[]` ... skipping the root, an entry with no settings and an entry whose resolved rememberLayout is false"
   NEW: "`recordOverride(entries: readonly PanelWindow[], key: 'anchor' | 'formFactor' | 'parkable', ids: readonly string[], rootId: string): PanelWindow[]` ... skipping the entry whose id is rootId, an entry with `marker: true` (the root-less marker of the placement entry), an entry with no settings and an entry whose resolved rememberLayout is false". Also add "(pass i.rootId)" after "THIS entry calls recordOverride inside the same setPanels updater as the gesture".
3. Allow-list sentence.
   OLD: "a new read of `.collapsible` for a permission decision that this entry adds is listed by function name in the allow-list the permission entry created in test/source-invariants.test.ts, in the same commit (the file is in Touches); without it that test goes red in the first entry that lands such a read."
   NEW: "recordOverride reads `.collapsible` as the parkable value, so 'recordOverride' is added to the 'panelWindow.ts' list of COLLAPSIBLE_READERS in test/source-invariants.test.ts in the same commit (that test scans only panelWindow.ts, panels/usePanelManager.ts and panels/useProvidePanels.ts; a read in workspacePlan.ts is not scanned and needs no entry)."
4. Bullet 5's mutant must match bullet 13's list.
   OLD: "Mutant: always mark overrides; (c) turns red."
   NEW: "Mutant: reconcile treats overrides as always owned (the first mutant of bullet 13, counted once in N = 6); (c) turns red."
5. Bullet 2's PanelsInput sentence lists `workspaceDefaults?` and `tuning?` as "gains" though both already exist.
   OLD: "`PanelsInput` gains `templates?: ...`, `declared?: ...[]`, `workspaceDefaults?` (the row-numbers entry added it, with the Host-bag create path that uses it) and `tuning?` (a partial WorkspaceTuning, added by the visibility entry), so templates"
   NEW: "`PanelsInput` gains `templates?: ...` and `declared?: ...[]` (it already carries `workspaceDefaults?`, from the row-numbers entry, and `tuning?`, from the visibility entry; this entry does not touch those two), so templates". The "PanelsInput members" in bullet 1's api diff are then `templates` and `declared` only.
6. Test homes for bullet 2: add at its end "The unit tests of recordOverride, clearOverrides and both registry orders live in test/workspace-reconcile.test.ts."
7. Bullet 12 names no file for its differentials: after "One differential per name persist, rememberLayout, restoreVisibility, hostCreatable, multiple, maxInstances;" add "in test/settings-enforcement-memory.test.ts (differential and differentialsCovered from test/support/differential.ts);".
8. Bullet 3's throw pin needs the mechanism: append to "a throw inside the load success handler leaves the workspace unsettled and saving never resumes (flipped below)": "(the throw surfaces as an unhandled rejection: the pin installs a process 'unhandledRejection' listener for its duration, asserts it saw the planted error exactly once, and removes it)".
9. Bullet 6's deferredPin clause (PanelWindow has no deferredPin until #21).
   OLD: "deferredPin and scroll position are never in the file."
   NEW: "scroll position is never in the file (deferredPin does not exist until the pin entry, which asserts it is absent from the file)."
10. Intent wording: "overrides (anchor, tier, parkable)" -> "overrides (anchor, formFactor, parkable)".
11. Bullet 4's vendored path: after "the vendored 0.1.0 projectWorkspaceState" add "and isWorkspaceState (test/fixtures/compat-0.1.0/pkg/workspaceState.js)".
12. Touches: add `CHANGELOG.md` and replace `tools/mutants/phonux-saved-overrides-and-template-paths.json` with the glob `tools/mutants/phonux-saved-overrides-and-template-paths*.json`.
13. Bullet 1 (hook pins): add "The hook keeps the lines pinned by test/rowconstants-drift.test.ts (the SAVE_QUIET_MS import, the WORKSPACE_SAVE_QUIET_MS alias line `export { SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS };`, no `500` anywhere in the file, comments included) and the saveQuietMsRef lines in test/source-invariants.test.ts:244-248. New inputs to usePanelManager go in PanelManagerOptions, never a ninth positional parameter (test/source-invariants.test.ts:251 pins the eight names)."
14. Not blocking: the meaning of the saved file-level `root` key and the exact shapes of `applied` and `dismissed` appear only in the design doc; if the design file is unreadable the worker must stop.

## Counts
F = 88 (unchanged); N = 6 (unchanged); barrel unchanged; MIN_LIBRARY_FILES: +1 (workspacePlan.ts); floor = file count minus 1 (recount with `ls *.ts *.tsx panels/*.ts | wc -l`).

## Decisions assumed
recordOverride takes a 4th `rootId` parameter; the skip flag is named `marker` (matching #10 and #19); the saved `overrides` member counts as a fourth writer site; N = 6.
