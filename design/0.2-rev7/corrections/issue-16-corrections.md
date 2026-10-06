# AUDIT CORRECTIONS for issue #16 (against main 0aede6c); these supersede the issue text where they differ

Issue: phonux-row-scroll-gesture-and-requests. Verdict: REVISE. Source: drift audit of #15, #16, #17; see also issue-15-corrections.md (written by the auditor) for the cross-issue findings A1 to A3 and B1 to B5.

## Verified still true
- LIBRARY_PANEL_DEFAULTS scrollOnOpen 'into-view', scrollOnMove 'follow', revealOnScroll 'edges'; tuning initialScroll 'start', gestureLockMs 350.
- All scrollTargetFor and stepTarget literals (2670, 3248, 2959, 3482, 812 and the step rows), the initialScroll numbers (2030, 1452, 3482, edges 3670 and 4076, History right edge 2436).
- Bullet 4's pins match panels/useRowScrollGesture.ts today (one wheel listener on the container, one keydown on window, 350 ms lock, arrows unlocked).
- handleActivatePanel returns early for a live panel (usePanelManager.ts:387).
- DESIGN.md has 0 hits for 'custom scrollbar' today, so bullet 12's "at least 1" is a real change.
- useWorkspacePersistence returns void today; restoreSettled is `storage === undefined || settled` (its `settled` state is internal).

## Corrections (OLD -> NEW)
1. Bullet 11, deferred-load scenario (BLOCKING, finding A1): restored entries are legacy (hydrateWorkspaceState builds them through appendPanel, no `settings`, so effective() gives overflow 'park' when collapsible): at container 1000 nine of ten restored panels park and the eleven-panel scroll row never exists.
   NEW: "the restored entries carry settings (overflow 'scroll') through the workspaceDefaults path of the row-numbers entry's restore case" (issue #15 gains an optional `decorateRestored` hook from useProvidePanels to useWorkspacePersistence, applied in the same map as defaultHostData at useWorkspacePersistence.ts:49-52, only when workspaceDefaults is passed; see issue-15-corrections.md D1).
2. Bullet 14: OLD "C5 with N = 9:" -> NEW "C5 with N = 10:", adding the mutant "into-view ignores the right padding" (named red-required in bullet 5 but missing from the nine).
3. Touches: add `CHANGELOG.md` and replace the single mutant path with the glob `tools/mutants/phonux-row-scroll-gesture-and-requests*.json`. Evidence line: "CHANGELOG.md's Unreleased gains: Added `ProvidedPanels.scrollTo` and `followPanel`; Changed 'with rowGesture step a swipe or arrow on a scrolling row scrolls one panel instead of swapping'. Added lines only."
4. New bullet: "test/source-invariants.test.ts's useRowScrollGesture test (lines 235-242) is retargeted to the rewritten hook. Only its expectations on the `[overflowContainerRef]` dependency list and the `gestureLockMs: number = GESTURE_LOCK_MS` default may change; it is named in the handoff. Also keep test/rowconstants-drift.test.ts:61 passing: no literal `500` in useWorkspacePersistence.ts (and keep its SAVE_QUIET_MS import line and the WORKSPACE_SAVE_QUIET_MS alias line)."
5. Bullet 9, arrow keys: add "jsdom 26.1.0 does not implement isContentEditable (the hook reads it at useRowScrollGesture.ts:62), so the contentEditable case defines `isContentEditable: true` on the target with Object.defineProperty. The control is the same press without it, which steps. Or the hook also tests `closest('[contenteditable]:not([contenteditable=\"false\"])')`; say which."
6. Bullet 9, locks: add "the lock and unlock timers are setTimeout, not the frame clock. Lock cases run under `mock.timers.enable({ apis: ['setTimeout'] })` with `act(() => mock.timers.tick(ms))` (the pattern at test/settings-enforcement-visibility.test.ts:323-327). Glides run on advanceFrames, whose frame is 16 ms (FRAME_MS, jsdom-globals.ts:12), so 0.4 s is 25 frames and 0.8 s is 50 frames."
7. Bullets 6 and 12: add "the test dispatches `new Event('scroll')` itself after each write. jsdom fires none, while a browser fires one asynchronously per write. The 'own writes are not foreign' rule is observable only that way."
8. Bullet 7: OLD "else drops with a note after two commits" -> NEW "... drops with an onNote note whose code is 'scroll-request-dropped' after two commits" (SettingNote.code is a free string, panelSettings.ts:220; the code name is the auditor's suggestion, the issue names none).
9. Intent plus one added line: "Workspace's rowScroll-false reset of scrollLeft (row-numbers entry) goes through rowScrollerFor(container) here (stop the glide, write 0), so RowScroller stays the one writer; the row-numbers entry's reset test passes unchanged." (#15 writes scrollLeft = 0 directly, which contradicts "the one writer".)
10. Bullet 1: F = 66 has no per-bullet breakdown; it is a floor so it is checkable, but unreviewable; add a breakdown if cheap.
11. MIN_LIBRARY_FILES: this entry adds two root files (rowScroller.ts, scrollTargets.ts). The floor is the file count minus 1: 36 at 0aede6c (37 files); after #10 (+panelPlacement.ts) 37, after #11 (+panelTuning.ts) 38, after #15 (+rowNumbers.ts) 39, so this entry raises it to 41 (42 files). Recount with `ls *.ts *.tsx panels/*.ts | wc -l`.
12. Barrel: #16 leaves the barrel title alone (56 after #15).
13. rowConstants.ts is pinned at 17 exports (test/rowconstants-drift.test.ts:97): the 50 ms cap and the 1 px tolerance are local constants in the new files, never rowConstants.

## jsdom feasibility
Producible: all pure target literals; the glide on the virtual frame clock; pointerdown and scroll events (dispatched by the test); stubbed clientWidth and scrollWidth; WheelEvent and KeyboardEvent; spies on rowScrollerFor(el).glideTo and on addEventListener. Needs the corrections above: contentEditable (item 5) and the 350 ms lock timing (item 6). Clamping must come from maxScroll, never the DOM (jsdom does not clamp scrollLeft).

## Decisions assumed
- A1 decorator on the restore path (owned by issue #15; this entry depends on it).
- N = 10; second mutant spec via glob.
- Frame length 16 ms; locks use mock timers.
- Note code 'scroll-request-dropped' (internal string, not exported).
- Overlap: depends on #15; both touch Workspace.tsx, PanelRow.tsx, useProvidePanels.ts (fine in order); useWorkspacePersistence.ts return value change lands here, the decorator lands in #15.
