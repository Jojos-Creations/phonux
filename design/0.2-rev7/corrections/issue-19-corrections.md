# AUDIT CORRECTIONS for issue #19 (against main 0aede6c); these supersede the issue text where they differ

Issue: createWorkspace and attach (phonux-workspace-attach-and-snapshot). Verdict: REVISE (text edits only). Same stale-baseline line fix as #23.

## Facts that hold
- panelTemplate.ts already declares the type block. `PanelState` has exactly the 14 keys bullet 6 lists, in that order. `PanelSnapshot` is `{ version, status, panels }`, `ListFilter` is `{ status?, listed? }`, `PanelReader` has get/list/getSnapshot/subscribe, `PanelReadHandle` has the five read members.
- `PanelManagerErrorCode` has template-collision, invalid-options, instance-id-required, already-attached, disposed. `templateIdProblem` already enforces 1-48 characters, no `~`, no leading `_`, not all digits, not 'all'.
- `usePanelPinned` reads PanelSlotContext.pinned; LIBRARY_PANEL_DEFAULTS.scrollOnOpen is 'into-view'; PanelsInput.onNote exists; `heldIds` is returned by usePanelManager (PanelState.held needs it); the 'park-lever-inert' note exists; `scroll-dropped-during-drag` is defined by #16/#17.
- `grep PanelEvent` prints 0; `grep -l PanelHandle` is 0 now and above 0 after #19; etc/phonux-testing.api.md exists; "22 touched files" matches the Touches count.
- 60 = 56 + 4 is correct (barrel).

## Corrections (OLD -> NEW)
N is wrong. Bullet 14 says "the nine mutants all listed" with N = 9 but bullets name three more not in the list: bullet 3 "the adapter passes no handle"; bullet 9 "isPinned reads the placement of an (A) half"; bullet 11 "the marker created with marker false".
   OLD: "14. C5 with N = 9, the nine mutants all listed in tools/mutants/phonux-workspace-attach-and-snapshot.json: addPanel after ready records no scroll request; ... the order option not passed to resolvePlacement."
   NEW: "14. C5 with N = 12, the twelve mutants all listed in tools/mutants/phonux-workspace-attach-and-snapshot*.json: [the nine as written]; the template adapter passes no handle (bullet 3); isPinned reads the placement of an (A) half (bullet 9); the root marker is created with marker false (bullet 11)." (Alternative accepted: keep N = 9 and drop the "mutant:" wording from bullets 3, 9 and 11.)
1. Stale pointers (resolver entry is merged; types are in code).
   OLD (bullet 2): "PanelState, PanelSnapshot, ViewHandle and PanelReader are the type-only declarations of the resolver entry and are implemented here"
   NEW: "PanelState, PanelSnapshot, ListFilter, PanelReadHandle, ViewHandle, PanelReader, DeferredPin and WorkspaceStatus are declared in panelTemplate.ts and exported from index.ts; this entry implements them and edits none of their member lists"
   OLD (bullet 6): "(the PanelSnapshot declaration in phonux-settings-catalog-and-resolver's type block, under that issue's Research, Local insights)"
   NEW: "(PanelSnapshot in panelTemplate.ts is `{ readonly version: number; readonly status: WorkspaceStatus; readonly panels: readonly PanelState[] }`)"
2. A typo that is not a type. OLD "`defaults?: Omit(PanelSettings, 'tuning')`" NEW "`defaults?: Omit<PanelSettings, 'tuning'>`".
3. Bullet 3's key assertion is overwritten by #20. Append to "handle (Object.keys equal id, templateId, getState, getSettings, subscribe: the read-only five)": "at this entry; the operations entry widens the view handle and renames this one assertion".
4. Hook pins: add the same sentence as #18 correction 13 about the pinned hook lines (rowconstants-drift.test.ts:59-63, source-invariants.test.ts:244-248; no `500`; new inputs in PanelManagerOptions).
5. Bullet 6's id rule is hard to read. Suggest: "an explicit id obeys the template-id rule (1 to 48 characters, no whitespace, no leading '_', not all digits), so a 49-character id throws invalid-options".
6. api-report claim (bullet 12) is false.
   OLD: "memoryWorkspaceStorage in ./testing and nothing else new"
   NEW: "memoryWorkspaceStorage in ./testing together with the declarations its signature reaches in etc/phonux-testing.api.md (WorkspaceStorage, WorkspaceState, WorkspacePanelState, each exported by type from fakeHost.ts so check:api-report prints no ae-forgotten-export), and nothing else new". (The ./testing report is a standalone bundle; fakeHost.ts must name every type FakeHost's own declaration reaches.) This is why #27 must also change etc/phonux-testing.api.md.

## Touches additions
CHANGELOG.md; the mutant glob tools/mutants/phonux-workspace-attach-and-snapshot*.json; panels/usePanelClosing.ts is NOT forced (useProvidePanels' undoClose wrapper can diff closing.recentlyClosed to remove a tombstone); MIN_LIBRARY_FILES new-file list also names panels/usePanelStates.ts (five root files + panels/usePanelStates.ts = +6).

## Overlap
#10 shares useProvidePanels.ts, PanelRow.tsx, boundary, source-invariants, DESIGN.md and etc (ordered). Consumed contracts match: `order` passed to resolvePlacement, the marker `__root__` with leftOffsets [0, 406], and `isPresent`.

## Decisions assumed
N = 12 (alternative: drop the "mutant:" wording); the ./testing api report gains WorkspaceStorage/WorkspaceState/WorkspacePanelState; panels/usePanelClosing.ts not forced into Touches.
