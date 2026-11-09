# The row on Embla Carousel

Owner ruling, 2026-11-08: rebuild the row on Embla Carousel now (rc.7 waits); far-off pages sit on one continuous strip, with
far web pages unloaded behind same-size placeholders (step 7). The plan is `~/git/phonux-rc7-pack/embla-plan/PLAN.md` (eight
steps). This file records what each step delivered and what is left.

## Step 1: an Embla row behind a switch

`<Workspace rowEngine="embla">` runs the row on `embla-carousel` 8.6.0 with `embla-carousel-wheel-gestures` 8.1.0 (both pinned
exactly: the later oval drag uses Embla's `internalEngine()`, which semver does not cover). The default is `'own'`, the row as
before; with the switch off nothing renders or listens differently.

What the switch does (`emblaRow.ts`, and a branch each in `Workspace.tsx` and `PanelRow.tsx`):

- The container carries `data-row-engine="embla"`, and the old row's wheel, touch and key listeners
  (`useRowScrollGesture`) and the Workspace's arrow-key edge focus return at once for it.
- The Workspace renders no `[data-row-window] > [data-row-strip]`, so the old row scroller finds no strip and draws nothing.
- `PanelRow` draws the same slots (the same `PanelRowSlot`, contexts, enter and exit animations) inside a window that is
  `fit` whole slots wide (`emblaWindowOf`), centered, and cut one gap past each edge as the old grid cut was. Its box is
  Embla's container, as wide as the window, and holds one zero-height marker per slot (`slotMarkerLefts`), which Embla takes
  as its slides: every slot edge is a stop, a wide panel's inner ones included (`align: 'start'`, `containScroll:
  'trimSnaps'`, `skipSnaps: true`).
- Wheel and trackpad: the wheel-gestures plugin on the window. A wheel handed in by `feedRowWheel` bubbles to the same listener,
  so it moves the row like a wheel over it; it returns true for a sideways wheel and false for a vertical one. Option held at a
  gesture's first event leaves the whole gesture to the content (a listener registered before the plugin's stops it).
- Pointer drag: Embla's own. A mouse press starts one only on the row's surface (a gap, not a panel), so a panel's text,
  controls and header grab keep the mouse; a touch starts one anywhere but on a control, an editable field or a frame.
- Arrow keys: a bare ArrowLeft or ArrowRight steps one slot (`scrollPrev`, `scrollNext`), under the old row's
  `arrowKeyBelongsElsewhere` filter.
- Focus: a panel focused while partly out of the window comes in by the least move.

Measured with `node --import tsx tools/proof/embla-row-proof.ts --engine embla` (headless Chromium 151, 1800 x 900, rows
narrow 24 x 1, wide 3,2,..., mixed 1,3,1,2,...; the Workspace panel is the strip's first slot):

| what | Embla row | today's row (fix1-new.json, same rows) |
| --- | --- | --- |
| row px per input px, page.mouse.wheel D6 / D12 / D24 (two runs) | 0.989-1.000 / 0.988-0.996 / 0.989-0.997 (three runs) | same script at 1926006: 1.33-1.35 / 1.26-1.27 / 0.995-1.009; scratchpad baseline at 90ee803: 0.760 / 0.564-0.573 / 0.376-0.389 |
| spread narrow / wide / mixed | 0-0.8% | 0.6-1.9% |
| handed in by feedRowWheel, one per frame, D12 (2.5 s) | 0.991-0.995, spread 0-0.4% | 0.993 / 1.077 / 0.993, spread 7.8% (fix1-new.json, 5 s: 1.015 all three) |
| frames a wheel reached that stood still while the row moved, of ~150 (drawn transform, after step 2) | 0 in every row and stream | 0-21 (mouse.wheel), 0 (feedRowWheel), read off the old scroller |
| rests on the slot grid | every run | every run |
| mouse drag on the row surface, 600 px | 596.6 px at release, trails by at most 30.6 px (Embla's drag spring), rests on the grid | (no mouse drag of the row) |
| a mouse drag that starts on a panel | row moves 0 px | |
| ArrowRight x3, ArrowLeft | rests 406, 812, 1218, 812 | |
| window 1800 > 1400 > 2300 > 1800 | left-edge panel moves 0 px in every frame, no one-slot panel cut in any frame, rests on the grid | |
| window 1800 > 1000 | fixed in step 2 (below) | |

The stalled frames step 1 reported were the proof reading the wrong number. `tools/proof/embla-wheel-trace.ts` records, each
frame, the wheels that arrived, the plugin's untrusted mousedown, mousemove and mouseup, and the row's move. On a steady stream
handed in by `feedRowWheel`, a steady `page.mouse.wheel` stream and a trackpad-shaped stream (ramp, plateau, exponential tail,
skipped frames, three gestures), the plugin started and released each gesture exactly once (1/1, 1/1, 3/3), and it passed a move
in every frame that stood still: the momentum guess never cut a gesture short. Embla advances its `location` in fixed 60 Hz steps
and draws a translate interpolated between the last two, so `location` stands still in a frame whose interval is short and the
drawn strip does not. Read off the drawn transform, the same runs have 0 stalled frames; read off `location`, 13, 6 and 35. The
proof page now reads the drawn transform. Nothing in the row changed for this.

## Step 2: the view stays still across a change left of it

`keptScroll` (emblaRow.ts): the anchor is the first panel, in strip order, that reaches past the window's left edge and is still
in the strip after the change; the scroll moves by as much as that panel moved, clamped to the strip's ends. `PanelRow` computes
it in the render that carries the change, snaps every slot to its new rest in that render (instead of gliding), and in its layout
effect rebuilds Embla's stops from the new markers and jumps there with `jumpEmbla`, which writes Embla's internal location so
the jump is drawn in the same frame (Embla's own `scrollTo(i, true)` lands a frame later). It covers a panel opened, closed,
moved or resized left of the view, and a wide panel clamped when the window narrows. A change to the left-edge panel itself
keeps its left edge where it is; panels after it move over.

`test/embla-row-keep-still.test.ts` is the random-sequence test the redesign document (section 5) proposed: 500 sequences of
20-60 operations (stepL, stepR, setWindow, open, close, reorder, resize) on a model of the row, checking after each operation
stillness, whole slots and rests on the grid, and stepR-then-stepL reversibility. Its second test runs the same property with no
keep-still rule and requires it to fail on stillness.

Measured on the real row with the switch on (`embla-row-proof.ts`, mixed row resting at slot 5):

| change | scroll | left-edge panel, worst move in any frame | frames cutting a one-slot panel |
| --- | --- | --- | --- |
| window 1800 > 1400 > 2300 > 1800 | 2030 throughout | 0 px | 0 |
| window 1800 > 1000 (the 3-slot panel left of the view clamps to 2) | 2030 > 1624 | 0 px (406 px before step 2) | 0 (25 before step 2) |
| the 3-slot panel left of the view narrowed to 2, then widened back | 2030 > 1624 > 2030 | 0 px | 0 |
| a panel left of the view moved 3 places right, past the window | 2030 > 1624 | 0 px | 0 |
| a 3-slot panel left of the view closed | 1624 > 406 | 0 px | 0 |

Changes under a gesture or a glide (after the steps 1-2 audit). The keep runs only in a render that changed the strip layout or
the window, so a re-render while a drag pulls the row past its end leaves it there. Embla's own slide watcher is off: it rebuilt on
every child change of the box (slots and the drop gap, not only markers), back to the selected stop, and a rebuild drops a press or
wheel gesture (it rebuilds the drag handler and the wheel plugin). `moveEmbla` now applies a change: the keep's shift, and a rebuild
when the markers or the window changed. While a gesture holds the row the shift moves Embla's positions in place and the rebuild
waits for the release (`pointerUp`); a rebuild keeps the drawn position, and a glide goes on to the stop nearest its target. The
resize watch rebuilds only for a box width the row did not set itself (a row shown after it was hidden).

| `--only gesture` (mixed row) | before (ad43009) | now |
| --- | --- | --- |
| drag pulls the row to about -155 px, viewport +2 px re-renders | row snaps to 0, drag ends | stays at -150.8, drag goes on to -256.6, rests at 0 |
| wheel stream D12, last panel closed 1 s in (control: stream alone steps back 5.5 px at its settle) | steps back 240 px, row ends at 0.1 (gesture lost) | worst step back 0.9 px, moved 406 |
| same, last panel resized 2 > 1 slot | steps back 239.9 px | worst 1.75 px, moved 406.1 |
| from slot 5, wheel stream, the 3-slot panel left of the view narrowed mid-stream | (case added with the fix) | a panel in view moves at most 7.3 px a frame; 406.7 px without the in-place shift |
| ArrowRight glide from 2030, the 3-slot panel left of the view narrowed 120 ms in | rests at 1802, off the grid | rests at 2030, on the grid |

Embla internals still used, and why: `writeEmbla` (the oval drag's direct write; a rest off any stop needs it), the drawn-position
restore after a rebuild (without it the release rebuild steps the row back 14-26 px, measured), the in-place shift under a gesture
(406.7 px jump without it, measured) and `dragHandler.pointerDown()`. A jump at rest to a stop uses the public `scrollTo(i, true)`.
`test/embla-internals-contract.test.ts` pins 8.6.0 and fails if any member used changes. The property test now also pins closing
the left-edge panel itself (the panel after it becomes the anchor and stays put); a test requires the audit's surviving mutant
(keep the scroll when the anchor closes) to fail it.

Not covered yet: opening a panel left of the view in the browser (the model test covers it; the proof page has no second template).

## Step 7: one strip, far pages unloaded

`useProvidePanels({ rowEngine: 'embla' })` (pass the same value as the Workspace's `rowEngine`) makes the row one strip: `rowPricing`
gives an infinite capacity on a strip, so nothing parks for room or for `tuning.maxLivePanels`, and a panel parked for either comes
back in place (a host's own hide stays). With the switch off nothing changes. On Embla, `PanelRow` draws a placeholder of the same
width (`data-row-unloaded`) instead of the content of a parkable panel (overflow 'park', the panels that park today) that lies
`rowNearSlots` or more slots past the window's edge (`Workspace` prop, default 2: a step, an arrow key or a short flick moves one to
three slots, so those never meet a placeholder). `tuning.maxLivePanels` becomes the most parkable panels loaded at once, nearest
first, never fewer than the window shows. A loaded one stays until a whole slot further (no flip-flop on the line). `loadedNear` is
the pure rule; `test/embla-row-strip.test.ts` covers it.

Measured (`embla-row-proof.ts --only strip`, 24 parkable one-slot panels, cap 8, 1800 x 900):

| check | result |
| --- | --- |
| slots on the row | 25 of 25, none parked (control: the own row with the same settings shows 9) |
| wheel stream D12, px per input px | 0.994, 0 stalled frames of 149-152, rest on the grid |
| panel moves along the strip while panels unload and load (2-3 changes in the run) | 0 px in every frame |
| parkable panels loaded in any frame | at most 8 (the cap) |

The "unregistered view" defect this step shipped with was the proof page, and a library gap behind it. The page created its
workspace without `mount: false`, so the library's auto mount rendered a second row; its `useProvidePanels` called the workspace's
`observe` with the root alone during its render, then failed to attach (`already-attached`, reported to `onError`, not a page
error). That list replaced the attached row's, so the next `PanelRow` render (the first unload's) found no handle for any panel;
views drawn before kept theirs, which is why nothing broke with nothing unloaded or on a row that never re-rendered. `useProvidePanels`
now skips `observe` while another hook holds the workspace (`heldByOther`; a test harness that draws its own list still observes) (`test/workspace-lifecycle.test.ts`: fails on 4af3f06,
passes now), and the page passes `mount: false`, as the app does. The app was not affected (it passes `mount: false`).

Measured after the fix (`--only strip`): near p2 keeps its state (count 7, 1 mount) at slot 4; far at slot 12, unloaded; back at
slot 0 it mounts again (2 mounts); at most 8 parkable panels loaded; 0 px movement along the strip in every frame; `rowNearSlots` 0
leaves 4 loaded with four in view.

## Step 3: the dot bar on Embla's position

`usePanelDots` on an Embla row (`emblaDots.ts`) reads the strip `PanelRow` publishes and where Embla draws it this frame: one dot per
panel at its place scaled to dots (a one-slot dot is 22 px, as before), the oval over the panels in view. A store change re-renders
the bar in a microtask, so the oval is drawn in the frame the strip moved. Dragging the oval writes Embla's position directly
(`writeEmbla`), from the press, so the oval keeps the place it was grabbed at; release glides to the nearest stop. A pointer held
past the bar's visible end (its box cut by every clipping ancestor and the viewport) moves the row each frame, 0.1 slot/s per px past
the start of a 6 px zone, at most 12 slots/s. A dot press glides to show its panel. The old bar is unchanged off Embla.

Measured (`--only dots`, same parking row; bar drawn as the app does, clipped and kept over the oval for the hold):

| check | result |
| --- | --- |
| dots | 25 for 25 panels; the oval's ends meet the first and last dot in view at slot 0 and 7 (0 px) |
| fast oval drag, 6 px a frame, 132 frames | worst oval-to-pointer 0 px, strip 4791 px, rest on the grid |
| control: Embla's eased drag (the proof page's, routed in by its build; shipped code has no seam) | worst 36.2 px, median 31.8: the check fails as it should |
| pointer held 20 px past a 300 px bar's end for 1 s | row moved 1040 px, 0 of 59 frames still |
| control: held mid-bar | 0 px |
| dot press on p20 | glides to show it |

## Step 4: Workspace summon, dismiss and step-aside

On a strip the summon and the step-aside change what the row draws, never the list (`useProvidePanels`, `stripSummon` and
`stripAside`): nothing is saved, the host's panel list keeps every panel live, and a reload shows the row as the list has it. With
the switch off the old row's summon runs as before.

- Summon (`panels.summonRoot()`, the window bar's button) with the root off to the left brings it into the far left slot; off to the
  right, the far right slot. The panels between the root and the view, and the one in that edge's slot when it fits the slot, come
  off the strip (`emblaSummonPlan`); a wider page there stays and moves over by the root's slot. The commit carries a mark
  (`markEmblaRow`) that rests the view with the root at that edge, the pages in view stand still, the root glides in from one slot
  outside the window, and the page that steps out runs its own exit from where it was drawn.
- The same press (`dismissRoot()`) puts them back and rests the view on the page that was at that edge before; the root glides out
  over that edge and the returning page fades in where it lands.
- A step toward the root (an arrow key, a wheel, a drag) leaves the summon standing. Anything that carries the root wholly out of
  the view (a scroll, a dot press) ends it: the pages come back beside the root, out of view, and the keep-still rule holds the view.
- Step-aside: after a window or size change, when the root stands whole in the view and a page beside it is cut, cannot fit the
  window beside it and fits alone (`emblaAsideFor`), the root comes off the strip and the view rests with that page whole. The row
  moving toward the root (or a step key toward it at the strip's end) brings it back where it was; a window wide enough for both
  brings it back into view beside the page; a summon draws it beside the page (which moves over), and its dismiss steps it aside
  again. The root coming back is not itself a change that steps it aside.
- `rootView()` on Embla: 'summoned' while a summon stands, 'away' while stepped aside or not whole in view where the row is heading.

Embla internals: none new; the provider reads Embla's `target` (where a glide or drag is going), already pinned by the contract test.

Measured (`embla-row-proof.ts --only summon`, 1800 x 900, 24 one-slot pages and the root, eight pages left of it, window of 4 slots;
each check fails on 43bf248 with the switch on, 17 failures across all 13 checks, and passes now):

| check | result |
| --- | --- |
| summon from the left, view p14..p17 | root at 0, view root,p15,p16,p17; p15..p17 move 0 px in every frame; root drawn at 35 places on its way in; list unchanged (nothing saved parked) |
| dismiss | view p14..p17 again, 25 slots, list order as before |
| step toward the root (ArrowLeft) | view p8,root,p15,p16; still summoned |
| a glide carrying the root out | summon over, 25 slots, view p19..p22 where the glide went, rest on the grid, no frame jump past a slot |
| summon from the right, view p1..p4 | root at 1218, view p1,p2,p3,root; p1..p3 move 0 px; dismiss gives p1..p4 |
| a dot press carrying the root out | summon over, 25 slots, p20 in view |
| window 1800 > 1400 beside a 3-slot page | root off the strip, the page whole at 0; ArrowLeft brings the root back at 0; 1400 > 1800 brings it back beside the page |
| size pick 2 > 4 slots beside the root | root off the strip, the page whole at 0; summon: root at 0, page at 406; dismiss: aside again |

Look at the screenshots (`summon-left-mid.png`, `dismiss-right-mid.png` mid-transition, and the rests): the first run of the
left summon drew the pages leaving between the root and the view over the view for a frame (their exits were left at their old strip
place under the jumped scroll); every leaving slot now keeps its screen place.

## Step 5: width changes and maximize

A page's width change on Embla runs as on the old row: its size box eases on the slide (`PanelSizeBox`), the slots after it glide, and
Embla hears of it once, in the commit that starts it (the markers are drawn at their final places, so `moveEmbla` rebuilds the stops
at once and the keep-still rule decides the scroll). What step 5 changed:

- At the strip's end a narrower page shortens the strip under the view, so the keep (clamped to the new end) jumps the scroll. The
  slots snap as any keep does, and those the jump moved on screen then glide there from where they were drawn, on the slide's curve
  and the commit's shared start (`sharedStartTime`), the clock the size box eases on: the right end holds, the page's left edge and
  the pages left of it ease right one gap apart. Only for a width change: the same panels in the same order, in the same window (an
  open, close or move keeps its snap, as a window resize does; gliding a move past the window cut one-slot pages in 26 frames of the
  `change` section), and not under Reduce Motion (the size box snaps there too).
- A page narrowed so the root fits beside it again brings a stepped-aside root back in a second commit in the same task (the
  provider's layout effect). Nothing of the first commit is painted, so the marked commit glides from what was painted (`taskToken`
  tells commits of one task apart), and the root, new on the strip and the mark's pin, slides in over its edge instead of fading in.
  `arriveAndLeave` now uses the slide's curve and shared start for every glide (it used CSS `ease` before).
- Maximize lifts the panel to the top layer and never changes the row's layout, so Embla has nothing to hear. But the panel stays in
  the row's DOM, so its wheels bubbled to the wheel plugin and moved the row behind it, and the restore then shrank into a slot
  somewhere else. While a panel of the row is lifted (`maximizedIn`: a panel root with the popover attribute, from the grow to the
  end of the shrink) the row takes no wheel, arrow key, drag or focus reveal.
- Panels do not shrink when unfocused on Embla (owner ruling); nothing here reintroduces it.

Embla internals: none new.

Measured (`embla-row-proof.ts --only width`, 1800 x 900, root and 12 pages `1,1,2,1,3,1,1,2,1,1,1,1` (17 slots), window of four
slots; per frame from before the change to its rest). The four rows below fail on b2a749a with the switch on (7 failures, run from a
`git archive b2a749a` extract with this proof copied in) and pass now:

| case | b2a749a | now |
| --- | --- | --- |
| shrink the left-edge two-slot page at the strip's end (`1,1,2,1,3,1,1,2,1,1`) | its left edge jumps 406 px in one frame, the page shrinks over its neighbor | left edge eases 406 px, worst frame 33.6, last-3-frame max 0.76 vs median 8.6; p9, p10 move 0 px; p7 stays one gap behind |
| shrink a two-slot page mid-view at the strip's end | jumps 406 px in one frame | eases, worst frame 30.8, last-3-frame max 0.83 vs median 8.81; p12 moves 0 px; p10 one gap behind (0 px off) |
| p1 4 > 2 slots with the root stepped aside (`2,1,1,1,1,1,1,1`) | root appears under p1, p2 812 px off p1, p1's right edge steps back in 2 frames | root slides in one gap before p1, p2 one gap after (0.01 px), right edge monotonic |
| maximize p3, 40 wheels + ArrowRight, restore | the row moves 406 px behind it; pages behind move 478.5 px; restore lands elsewhere | row 812 > 812; pages behind 0 px; same view; restore last-3-frame max 1.0 vs median 11.4 |

Guards that already passed on b2a749a (the behaviour was right; kept so a later change cannot break it): a page growing in view and at
the window's left edge, narrowing in view, a two-slot page cut by the left edge narrowing (it leaves the view, the pages after it
slide over one gap behind), a page growing under an ArrowRight glide (rests at 1218, no step back) and under a wheel stream (worst step
back 0.24 px, as the stream alone), and with the Workspace summoned (root moves 0 px, summon stands). In all: changing edge one way,
worst frame 30.6-34.2 px of 406, last-3-frame max under 1.2 px against a median of 7.9-9.3 px, 0 frames cutting a one-slot page standing on
the grid, every rest on the grid.

Look at the screenshots (`width-*-mid.png`): at the strip's end the pages left of the narrowing page slide right with it, the page on
the right stays, no blank. One open observation: in `width-shrinkAside-mid.png` p2 is drawn about 29 px further from p1 than one gap,
while the per-frame measure (the main thread's layout, every frame) shows 0.01 px; the size box's scale runs on the compositor and the
slot glides (`composite: 'add'` translates) do not, so a captured frame can show the scale ahead. Not seen at the strip's end; not
checked on a real display.

Unit tests for step 4's pure helpers (`test/embla-row-summon.test.ts`, 11 tests, two of them properties): `emblaSummonPlan`,
`emblaAsideFor`, `markedScroll`. Mutants: dropping the edge-slot page from a summon's parks fails 3; letting a page wider than the
window step the root aside fails 1; flipping the sign of a right pin's screen offset fails the pin property.

## Audit fixes after step 5

An independent audit at b2a749a found these; each reproduced again at e71796f and each proof check below fails there (run from a
`git archive e71796f` extract with the new proof copied in) and passes now.

- Summon or dismiss pressed mid-glide. `moveEmbla` added the mark's fixed rest to the glide's remaining target (`target + (keepTo -
  location)`). A marked commit now lands the view where the mark says (`moveEmbla(..., land)`); the glide in flight ends and every slot
  that moved on screen glides from where it was drawn (Embla's drawn position, not its location, which runs up to a frame ahead).
  24 one-slot pages, root at index 8, from slot 14: `glideToSlot(18)` then summon 70 ms in rested at slot 21, root never shown
  ('away'); now root at 0, view root,p19,p20,p21, 'summoned'. Toward the root (`glideToSlot(10)`): root at the right edge (1218),
  view p6,p7,p8,root; now root at 0, view root,p11,p12,p13. Dismiss mid-glide (`glideToSlot(6)` from the summon): rested at slot 13,
  view p13..p16; now p14..p17 as before the summon. Summon and dismiss during a mouse-down drag were already right (the in-place
  shift): summon gives root,p13,p14,p15 (the drag had cut p13, which stays and moves over), dismiss p14..p17; kept as guards.
- Reduce Motion. `arriveAndLeave` glided and faded regardless, and Embla's own glides ignored it. Now the slot glides and fades take
  no time, arrow keys, the focus reveal and `moveEmbla` jump (`scrollTo(i, true)`), and a drag or wheel release settles at once
  (`scrollBody.useDuration(0)` on `pointerUp`, already pinned). Root drawn at 35 places on a summon and 36 on a dismiss, p16 at 45 on
  an arrow key, p1 at 35 on a step-aside; now at most 2 each, still keep-still and on the grid. The dot bar already honoured it.
- Step-aside re-check. The provider re-ran the step-aside on any change of the other panels' ids or widths, so closing a far page
  (p8 of `3,1,1,1,1,1,1,1` at 1400 px, the root back at 0 after a wheel toward it) stepped the root aside again and the view jumped
  406 px. It now re-runs only for a window change, a panel's own width change, a change of the root's two neighbours, or the page
  it stepped aside for closing.
- Blank pages at a low cap. The loader read Embla's location, which mid-glide runs ahead of the drawn strip, so the page still drawn at
  the trailing edge was unloaded while in view (cap 4 = the window's fit, p20's dot: 4 of 92 frames). It now reads the drawn
  position, counts what the next 8 fixed steps of travel bring into view and the window where the glide is going as shown (loaded
  whatever `maxLivePanels` says), and Embla's `select` also notifies the loader. Probe after: 0 frames at cap 8, cap 4 and near 0.
- The leaving-slot rule from step 4 had no check: `summon fromLeft` and `fromRight` now require a page leaving from out of view never
  to be drawn in the window, and one leaving from the view to start its exit from its place (0 px now).
- `blank-trials.ts` never ran the Embla row (its page has no `rowEngine`, and its control hides `[data-row-strip]`, which Embla never
  renders). The Embla check is `embla-row-proof.ts --only blank`: a parking row on a magenta page, cap 8 and cap 4 (the window's
  fit), a far dot press (three times at cap 4), a far jump and back, a wheel fling (20 x 60 px) and a summon; every presented frame
  (CDP screencast) must have no band of window columns at least 100 px wide that is page magenta, and every animation frame no
  unloaded placeholder in the window. Control: the same dot press with every slot hidden must read blank (75 of 93 frames, widest
  1604 px), or the run reports that it proved nothing.

| `--only blank` | e71796f | now |
| --- | --- | --- |
| dot press p20, cap 4, three trials: frames with a placeholder in view | 1, 4, 3 of 92 (pixels: 1, 3, 2 frames, widest 284 px) | 0, 0, 0 |
| dot press, cap 8; far jump; wheel fling (cap 8 and 4) | 0 | 0 |
| summon at slot 14, cap 8 and 4: placeholder in view | 0 | 0 |
| hidden control | reads blank | 75 of 93 frames blank |

The summon run shows a band of the page about 220 px wide for 11 frames, at e71796f as now: the edge page shrinks out while the
root slides in from outside the window (`summon-left-mid.png` shows it). No page there is unloaded, so it is recorded, not failed;
whether the root should fill that slot sooner is a design question for the summon, not the loader.

Mutants (one per fix, each from a `git archive` of this branch): the mark's rest dropped from `moveEmbla` fails 3 summon checks; the
Reduce Motion duration in `arriveAndLeave` fails 2; the old ids-sensitive step-aside re-check fails 3; the leaving-slot hold removed
fails 2 (a leaving page drawn 390 px into the window); the loader reading Embla's location instead of the drawn position fails 3 blank
checks (5 of 96 frames at cap 8).

Step-5 leftover, measured: in presented frames (CDP screencast, magenta page) of `shrinkAside`, the gap between p1's drawn right edge
and p2 grows to 78 px (16 at rest) while the per-frame layout says 16.0 px throughout. It is real: p2's glide is a main-thread
(`composite: 'add'`) translate and p1's size box scale runs on the compositor, frames ahead. Not fixed: forcing the size box onto the
main thread with `composite: 'add'` broke it (the DOM gap reached 422 px); the fix needs the slot glides compositable or the size box
and its neighbours on one clock. Open.

## Step 6: drag to reorder, with edge scroll

The plan's first try, dnd-kit with Embla's auto-scroll, fights the row and was dropped: `@dnd-kit/sortable`'s auto-scroll moved the
transform-drawn Embla row 0 px, a 1200 px row move under a still pointer fired 0 over events, and it reorders DOM nodes, which would
reload web views. The fallback the plan named is what shipped: our reorder (the grab strip's drag, `@dnd-kit/core` 6.3.1 for sensors,
Escape and announcements, as before) with its edge loop pointed at Embla.

- `edgeScrollerOf` and `edgeScrollOf` (`panelRowDropScroll.ts`): a drag inside an Embla row's window edge-scrolls that window and counts
  from where the strip is drawn. `openEdgeHold` takes `holdEmbla` (`emblaRow.ts`), the one writer while the hold lasts: it writes the
  drawn position (`writeEmbla`), so the strip and the dragged box move in the same frame and the box stays under the pointer.
- The bands are the window's own edges (no insets, no hidden panels to swap in; the stops are the strip's rests, which a Reduce Motion
  hold jumps between). A release settles on Embla's nearest stop; Escape (`edge.end(true)` in `dragToClose.tsx`) returns the row to
  the stop it started from, with the order unchanged.
- A person's move (a drop, or an arrow key on the grab strip) is noted by the slot (`noteReorder` on `PanelSlotValue`, recorded by
  `usePanelDragProps`) in the task that moves the panel. In the render that draws it, `PanelRow` leaves the view where it is drawn
  instead of keeping the left-edge panel still, and glides (jumps under Reduce Motion) to the nearest stop that shows the moved panel
  whole if the move took it out of view. A note older than 1 s is ignored (the host refused the move).
- The dragged panel is never unloaded (`loadedNear`'s `unloadable` skips it), however far the edge scroll carries it.

Embla internals: none new (`holdEmbla` writes through `writeEmbla`, already pinned).

Measured (`embla-row-proof.ts --only reorder`, 1800 x 900, the root and 24 parkable one-slot pages, window of four, cap 8, the proof
page's `grab=1` mode):

| check | result |
| --- | --- |
| p2 held 6 px inside the right edge for 1 s, no mouse motion | row moved 917-946 px, 0 still frames of 71-73; p2's content 0.01 px from the pointer |
| control: held mid-row 1 s | row 0 px |
| pages the dragged box never passed over, along the strip, any frame | 0 px (p9..p24, root, p1); passed over p3..p8, each an eased 406 px hop, worst frame 30.8-33.8 px |
| placeholders drawn in the window over the hold | 0 frames; Embla's own drag 0 pointerDowns |
| drop | rests 1218 on the grid, p2 lands at the slot it was let go over, 1 order commit |
| Escape after 497-501 px of edge scroll | row back at 0, every page 0 px off its place, order unchanged, 0 commits |
| p7 dropped into the left-edge slot from slot 5, pointer 145 px into the window | row 0 px held and after, p7 at 0, 1 commit |
| same, pointer 25 px in (inside the 48 px band) | row edge-scrolls 151-158 px while held, the release settles on the nearest stop (2030), p7 lands whole there, other pages 0 px |
| ArrowRight on p1's grab strip | row stays at 0, order moved one place |
| ArrowRight on p3, the right-edge page | p3 out of view, the row glides to 406 (settled at about 1.4 s), p3 whole at 1218 |
| p1 dragged a slot and a half left over the root | same order as the own row (`p1,root,p2,p3`) |
| Reduce Motion: hold at the right edge 1.2 s | 812 px in 2 jumps, drift 0 px, 0 settle frames, rest 1218, 1 commit, 0 blank frames |

The first draft of this section failed three of these on the proof, not the row (frame dumps `reorder-*-frames.json`): it counted
p6 and p7 as "not crossed" because the final order did not include them, but the held page passed over them at the edge and they
glided back when the pointer went mid-row; its left-edge drop stopped the pointer 25 px into the window, inside the band, so the row
edge-scrolled and settled back (158 px out and back); and its key case read the row 900 ms after the press, in Embla's glide tail
(405.46, 406 at about 1.4 s).

Negative control: this proof copied into a `git archive c19c65d` extract (the row before step 6), switch on: 10 failures; every
check above fails there except the root rule, ArrowRight on p1, Embla's own drag staying off and the mid-row control (the
behaviour was already right). On c19c65d the row does not edge-scroll at all, so the drift, pages-not-passed-over and placeholder
checks fail there only through their travel gate (they read 0 px over 0 px of travel); the original pages-not-crossed reading did
see p6's 30.7 px hop, so the per-frame strip measure can see a moving page. Mutant: the
reorder note's branch in `PanelRow` turned off fails 2 (the left-edge drop moves the view 406 px and leaves p7 at -406; ArrowRight
on p3 leaves it cut at 1624).

Look at the screenshots: `reorder-hold-mid.png` and `reorder-leftEdge-band-mid.png` show a page cut at the window's edge while the
row edge-scrolls between stops, as any scroll in motion does; at rest nothing is cut (`reorder-leftEdge-outside-mid.png`,
`reorder-hold-rest.png`). The dragged page is clipped by the window's edge while it is held there (it is not lifted out of the row).

## Not done yet (still on the old row, or not working on Embla yet)

- Reorder on Embla: a wide (two-slot or wider) page dragged, a drag held at the left edge to the strip's start, a touch drag and a
  host that refuses a move were not tried. Width changes: a hand resize (`usePanelResizing`, a held width) and a window resize
  during a size glide were not tried on Embla; maximize was tried with a wheel and a key, not with a window resize while grown.
- Summon on Embla: a root held at an edge (`edgeHold`), a root wider than one slot, and a window one slot wide were not tried; a
  real trackpad flick carrying the root out was not tried (the proof uses a glide and a dot press).
- Anything that asks the old row scroller to move (`scrollOnOpen`, `revealOnScroll`, a host's `stepRow` chord, the settle after a
  hand resize) moves nothing on Embla.
- Edge-held panels (`edgeHold`) were not tried on Embla: the old drawing pass that holds them needs the old strip.
- Shift + vertical wheel is not read as sideways; a finger drag was not measured (headless has no touch stream); a real
  trackpad and Safari were not tried.
