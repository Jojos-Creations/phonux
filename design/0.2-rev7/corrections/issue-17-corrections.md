# AUDIT CORRECTIONS for issue #17 (against main 0aede6c); these supersede the issue text where they differ

Issue: phonux-edge-scroll-while-dragging. Verdict: REVISE. See also issue-15-corrections.md for cross-issue findings A1 to A3 and B1 to B5.

## Verified still true
- panelSlotContext.ts exists (25 lines, no `dragScroll` yet). DragHandleProps `sx.touchAction` is 'pan-x' at dragToClose.tsx:51 and :127. DragToClose does `reorder.onDragEnd(info.offset.x)` at :162.
- LIBRARY_TUNING_DEFAULTS.edgeScroll is { zonePx 48, maxPxPerSec 900, reducedStepMs 500 }.
- reorderStepsForOffset thresholds 203, 609, 1015, 1421 and 1827; 1822 gives 4; 1750 gives 5 at 0.25 and 4 at 0.5; 1500 gives 4 at 0.5 and 3 at 0.75 (the hopFraction argument arrives with #11).
- Every edgeScrollSpeed and edgeScrollStep literal in bullet 3 (linear ramp, 50 ms cap, 18, 45, 12, zones of 40); reduced-motion panel starts 406 to 1624 and the 3482 clamp; the 10 C5 mutants match the 10 named in the bullets.

## Corrections (OLD -> NEW)
1. Bullets 4 and 5, frames (BLOCKING). OLD: "the scaffold's virtual frame clock at 20 ms frames", "dtMs: 20", "99 x 18 = 1782", "1822", "8 s" and "20 ms frames plus one". The harness frame is 16 ms (test/support/jsdom-globals.ts:12, FRAME_MS = 16); advanceFrames rounds up to whole 16 ms frames; editing the harness is outside Touches.
   NEW: "dtMs is FRAME_MS (16): 900 x 16 / 1000 = 14.4 px per frame; 99 frames give 1425.6, compared within 1e-6 and computed by the same repeated additions; onDragEnd receives 40 + 1425.6 = 1465.6, still 4 hops (1421 <= 1465.6 < 1827)." Runaway case: "400 frames (6.4 s, still longer than the strip's 242 frames)". Reduced motion: "reducedStepMs 500 is 32 frames (ceil(500/16)) per interval". The jump positions (406 to 1624), 1664 and 4 hops are frame-independent and stay.
2. Bullet 9. OLD "(a spy on animate sees both calls in one release)". NEW "(observed through the two MotionValues sampled every virtual frame: both start returning in the same frame and reach 0 in the same frame; `animate` is a named ESM import and tools/run-tests.mjs passes no module-mock flag)".
3. Bullet 4, add a pin as the FIRST committed test. Pointer events: "jsdom 26.1.0 has no PointerEvent. The test synthesizes pointerdown, pointermove, pointerup and pointercancel as MouseEvent instances of those type names (bubbles, button 0, clientX/clientY), with pointerType 'mouse' defined on them." Motion accepts these (isPrimaryPointer true for pointerType 'mouse' with button <= 0, and for an unset pointerType via isPrimary !== false). Pin: "the first committed test is a pin, green before source changes: a 40 px horizontal drag on a reorder DragToClose reports onDragEnd(40)." No test in test/ drives a mounted DragToClose today; the auditor could not run it.
4. Bullet 5, matchMedia: add "jsdom has no matchMedia. Motion keeps a process-wide hasReducedMotionListener flag (motion-dom render/utils/reduced-motion/state), so the stub is installed before the first useReducedMotion call and is a mutable MediaQueryList that fires 'change' for any test that flips it." (The flag's existence is verified; the once-only read behaviour is from memory of Motion's source: verify.)
5. Touches: add `CHANGELOG.md` and the glob `tools/mutants/phonux-edge-scroll-while-dragging*.json`. Evidence line: "CHANGELOG.md's Unreleased, under Changed: dragging a panel's grab bar to the window edge scrolls a scrolling row (mouse and pen); scrollOnDrag 'none' and tuning.edgeScroll turn it off or tune it. Added lines only."
6. Bullet 1, constants: add "the 50 ms frame cap is a local constant in edgeScroll.ts, not in rowConstants.ts (test/rowconstants-drift.test.ts:97 pins that module at 17 exports)."
7. Bullet 11, C4: "git diff --stat -- etc is empty" holds (PanelSlotValue is not exported; API Extractor reports carry no doc text).
8. MIN_LIBRARY_FILES: this entry adds one root file (edgeScroll.ts). Floor = file count minus 1: 36 at 0aede6c; after #10 37, #11 38, #15 39, #16 41, so this entry raises it to 42 (43 files). Recount with `ls *.ts *.tsx panels/*.ts | wc -l`.
9. Overlap: depends on #11 and #16 (transitively #15). #11's DragToClose tests also need a drag harness and an animate observation: say which file owns the pointer-event helper. test/support/mount-harness.ts is not in #17's Touches: either list it (additions only) or keep the helper inside the test file.

## jsdom feasibility
Producible: the pure numbers; stubbed clientWidth and a scrollWidth getter via defineProperty; scrollLeft as a plain property; MouseEvent.pageX (jsdom implements it). Needs the corrections above: 16 ms frames, MotionValue observation instead of an animate spy, synthesized pointer events, and a matchMedia stub.

## Decisions assumed
- Frame length 16 ms (D3); animate observed through MotionValues (D4); N = 10 as written; second spec via glob; CHANGELOG added lines only; the 50 ms cap local to edgeScroll.ts.
