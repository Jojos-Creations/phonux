# AUDIT CORRECTIONS for issue #20 (against main 0aede6c); these supersede the issue text where they differ

Issue: PanelManager operations (phonux-panel-handle-operations). Verdict: REVISE (text edits only). Same stale-baseline line fix as #23.

## Facts that hold
- The `PanelsAPI` members listed (create, activate, move, setFormFactor, reanchor, close, undoClose, clearAll); `restorePanel(panels, panel, index, rootId)`; the private `ClosedView` interface and `closedRef` in usePanelClosing.ts.
- `applyTemplate(entry, resolved, 'reconfigure')`; `holdPanel`, `releaseHold` and `wouldEmptyRow(ids)` with its render-scoped `inFlight()` (#20's gate extends the existing inFlight).
- `PanelRefusal` has every code the outcomes table uses (busy, would-empty-row, is-closed, is-pending, not-live, not-closable, not-parkable and the rest). It has no 'no-room'.
- The close-order pin is `KNOWN-BAD:3 two closes before a re-render undo in the wrong order` in test/pins-permission.test.ts.
- "usePanelClosing gains an optional parameter" is workable: it has 10 positional parameters, so it becomes an 11th, after `resetHostDataOnRestore`.
- N = 8 matches the list and every mutant a bullet names.
- #10's key-aware `undoClose` (closedRef consumed synchronously) is the base for #20's reapply and window-record rules (ordered).

## Corrections (OLD -> NEW)
1. Bullet 6's last sentence is untestable here (resetLayout does not exist until #21, configureTuning not until #23; both entries test their own busy answers).
   OLD: "`resetLayout('all')` and `configureTuning({ rowGap })` are busy while any id holds a token."
   NEW: delete the sentence. (If kept: "(their busy answers are tested by the entries that add them)".)
2. Bullet 9 contradicts itself on the closed list.
   OLD: "a manager verb never edits the ClosedView list (reference-equal)"
   NEW: "a manager verb other than open() never edits the ClosedView list (reference-equal); open() on a key whose closed record sits in the undo window drops that record, so recentlyClosed no longer lists it and undoClose has nothing to skip or report for it"
3. Bullet 11's KNOWN-BAD arithmetic is stale (KNOWN-BAD:4, the plain-park bounce pin in test/pins-visibility.test.ts added by #9, remains).
   OLD: "The close-order KNOWN-BAD pin is renamed LIMIT: and a manager test shows busy prevents it; `grep -rhoE "test\(.KNOWN-BAD:[0-9]" test | sort -u | wc -l` (distinct pin titles, so a pinned string repeated inside one pin counts once) prints 0."
   NEW: "The close-order pin 'KNOWN-BAD:3 two closes before a re-render undo in the wrong order' (test/pins-permission.test.ts) is renamed with the prefix 'LIMIT:3' and a manager test shows busy prevents it; `grep -rhoE "test\(.KNOWN-BAD:[0-9]" test | sort -u | wc -l` prints 1 (the KNOWN-BAD:4 plain-park pin of test/pins-visibility.test.ts, which this entry does not touch) and `grep -rhoE "test\(.LIMIT:3" test | wc -l` prints 1." (Assumes no entry between #10 and #20 adds another KNOWN-BAD pin; re-measure at accept.)
4. The ViewHandle key list omits `id` and `templateId` (the ViewHandle today is the read handle: id, templateId, getState, getSettings, subscribe; #19 asserts those keys).
   OLD (bullet 10): "Object.keys of the ViewHandle equal the listed verbs"
   NEW: "Object.keys of the ViewHandle, sorted, equal id, templateId, getState, getSettings, subscribe, show, hide, toggleVisibility, close, open, move, place, setFormFactor, scrollTo (14 keys; no manager; pin, unpin and configure arrive with their entries), and the attach entry's mount-test assertion on the read-only five (test/workspace-attach.test.ts) is renamed to this list, named in the handoff". Make the same fix in bullet 2's parenthesised list.
5. Touches: add `test/workspace-attach.test.ts`, `CHANGELOG.md`, `DESIGN.md` (verbs, refusals and the S5 gate are new design surface) and the glob `tools/mutants/phonux-panel-handle-operations*.json`.
6. Hook inputs: add "New usePanelManager inputs go in PanelManagerOptions (test/source-invariants.test.ts:251 pins the parameter list)".

## Counts
N = 8; ViewHandle = 14 sorted keys after this entry (16 after #21 adds pin and unpin; 17 after #23 adds configure).

## Decisions assumed
resetLayout/configureTuning busy sentence deleted; ViewHandle has 14 sorted keys; after the rename the KNOWN-BAD grep prints 1.
