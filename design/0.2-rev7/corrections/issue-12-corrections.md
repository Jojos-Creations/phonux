AUDIT CORRECTIONS for issue #12 (against main 0aede6c); these supersede the issue text where they differ

Issue: phonux-keep-mounted-render-path. Verdict: REVISE (mechanical). Difficulty: hard is fine (imperative slot controls, display:none from the animation promise, a latch).
Order: #9 -> #10 -> #11 -> #12 -> #13 holds; Depends on #9, #11 resolves (and #10 transitively).

VERIFIED STILL TRUE (relevant to #12)
- Panel.tsx:58 still reads "CaptureRegistryContext) so the host can later ask for a picture of it by id"; `git grep -nE '^[[:space:]]*(/[*][*]|[*]|//).*CaptureRegistryContext' -- Panel.tsx | wc -l` prints 1 at HEAD and at 7a60e82 (control holds); `git grep -c CaptureRegistryProvider -- Panel.tsx` prints nothing now (0 matches), so "at least 1 after" is a real change. CaptureRegistryProvider is exported from index.ts.
- Barrel: 51 values at 0aede6c; #11 makes 54; #12 makes 55 ('exactly the 55 runtime values'). Consistent with the bullet.
- Catalog: keepMounted descriptor ownerEntry is phonux-keep-mounted-render-path (1 owned differential, bullet 3 matches). Resolver rule C6 exists (panelSettings.ts:1621: viewState 'reset-on-park' forces keepMounted false) and C1 forces keepMounted false for a fixed column (:1608).
- A zero-duration slide is legal (tuning.slide durationSec range 0..10), so bullet 5's "zero-duration slide" fallback is reachable after #11.
- No new root file: MIN_LIBRARY_FILES is untouched by #12 (floor stays 38 after #11; 39 files).
- PanelRow's latch machinery from #9 (releasedAtParkRef, parkReleases, useViewState.useRetainOnly) is present at PanelRow.tsx:~110-125, matching bullet 4(d)'s "the viewState latch is the same".

(1) STALE REFERENCES: none found.

(2) NUMBERS: the C5 mutant count is wrong.
- Bullet 11 lists 6 mutants. Bullets 5 and 9 add two more: "hidden set from onAnimationComplete only" (bullet 5) and "Panel stays registered while hidden" (bullet 9). Bullet 7's "jump removed" is the same as bullet 11's "enter-side jump removed".
- The distinct set is 8, so `node tools/mutate-check.mjs tools/mutants/phonux-keep-mounted-render-path.json --planned 6` fails (it requires APPLIED == PLANNED == RED == N); a worker applying all 8 would need a second spec.

CORRECTED COUNTS FOR #12
- Mutants: C5 with N = 8 (was 6).
- Barrel: 54 -> 55; the barrel test is renamed to 'the phonux barrel exports exactly the 55 runtime values, no more, no fewer', never deleted (this was already right in the bullet).
- MIN_LIBRARY_FILES: unchanged (no new root file; it stays at the value #11 sets, floor 38 for 39 files).

(3) TOUCHES COMPLETENESS
- CHANGELOG.md is MISSING and is forced: new public `usePanelHidden`, kept-view behaviour, and Panel's capture rule.
- panelSlotContext.ts is probably needed. usePanelHidden must reach views and Panel through a context, and that leaf is where per-slot facts live today (PanelSlotContext, provided only by PanelRow). If the worker puts a new context in PanelRowSlot.tsx instead, nothing breaks. Adding it to Touches is harmless.
- DESIGN.md is listed and bullet 10 forces it. No mutants-file or boundary change is needed beyond the listed mutants file.

TOUCHES ADDITIONS FOR #12
- panelSlotContext.ts
- CHANGELOG.md

(4) OVERLAP AND ORDERING
- #12 follows #10 and #11 on PanelRow.tsx and PanelRowSlot.tsx (panelRowSlotMotion gains trailing optional parameters in #10 and #11; #12 must keep the five-argument form working).
- source-invariants: #10 retargets one expectation and #12 adds. Serialised by the dependency chain, fine.
- Bullet 5's "zero-duration slide" and "animated:false" depend on #11's slide and #10's animated. The dependency order already covers this.

(5) NOTES
- Bullet 8's `reservedWidth`, `leftOffsets`, `neighborWidthsAt` and `anchorIndexOf` are locals of PanelRow, not importable. The test must read them through markup and `usePanelNeighborWidths` probes. This is not a defect.

TEXT CORRECTIONS for #12 (OLD -> NEW)

C12-1 Touches. Add `- panelSlotContext.ts` and `- CHANGELOG.md`.

C12-2 Bullet 11.
- OLD: "C5 with N = 6: hide via visibility:hidden; lazy mount removed; inert omitted during the exit; unmount on close skipped; enter-side jump removed; latch replaced by the live setting."
- NEW: "C5 with N = 8: hide via visibility:hidden; lazy mount removed; inert omitted during the exit; unmount on close skipped; enter-side jump removed; latch replaced by the live setting; hidden set from onAnimationComplete only (bullet 5); Panel stays registered while hidden (bullet 9)."

C12-3 Bullet 10. Append: "CHANGELOG.md's Unreleased gains added lines only (`git diff -U0 CHANGELOG.md | grep '^-' | grep -vc '^---'` prints 0): Added `usePanelHidden()`; Changed: a parked entry whose keepMounted is true keeps its view mounted and hidden, and Panel unregisters from the capture registry while hidden."

DECISIONS ASSUMED (open decisions the corrections above encode; the coordinator may overrule any)

D1. Mutant count: the two extra in-bullet mutants (bullets 5 and 9) are real, separate mutants, so N = 8 rather than dropping them to keep N = 6.
D2. panelSlotContext.ts goes into Touches as a harmless precaution; where the hidden state lives (PanelSlotContext field vs a context in PanelRowSlot.tsx) is left to the worker.
D3. CHANGELOG lines are added-lines-only (no existing line edited), matching the rule #13 uses for its own bullet.
