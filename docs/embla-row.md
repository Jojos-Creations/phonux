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
  so it moves the row like a wheel over it; it returns true for a sideways wheel and false for a vertical one. A pause or a stop is
  settled by the row, not the plugin ("A wheel that pauses or stops", below). Option held at a
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

Superseded by the owner ruling of 2026-11-09 ("The Workspace as an ordinary page", below): the summon described here, its dismiss,
the step-aside and the step-away dismiss were deleted. This section and the summon parts of the audit passes below are the record.

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
`test/embla-row-reorder.test.ts` (2 tests): one hold at a time, writes clamped to the strip and drawn at once, nothing written after
release; dropping either guard fails one.

Measured (`embla-row-proof.ts --only reorder`, 1800 x 900, the root and 24 parkable one-slot pages, window of four, cap 8, the proof
page's `grab=1` mode):

| check | result |
| --- | --- |
| p2 held 6 px inside the right edge for 1 s, no mouse motion | row moved 917-958 px, 0 still frames of 71-74 (four runs); p2's content 0.01 px from the pointer |
| control: held mid-row 1 s | row 0 px |
| pages the dragged box never passed over, along the strip, any frame | 0 px (p9..p24, root, p1); passed over p3..p8, each an eased 406 px hop, worst frame 30.8-33.8 px (the release and its settle included) |
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

## Step 8: pages out of the window are inert; an opened page comes into view

Two library gaps the app hit when it switched to the Embla row.

- Inert. On the old row a slot off the grid got `inert` (and no pointer events) from the drawing pass (`rowDraw.ts`). The Embla row
  never set it, so a focused page resting out of view kept its focus, and the app's halo (keyed on `[data-row-slot][inert]`) lit the
  gap past the window. `markAwaySlots` (emblaRow.ts) marks every slot drawn wholly outside the window `inert` and clears it as soon
  as any part is drawn inside. It reads each slot's drawn box, so Embla's drawn position (not its location, which runs up to a frame
  ahead), a slot's own glide (a summon, a dismiss, a width change) and a reorder shift all count where they are drawn. It runs on
  every Embla row notice (each drawn frame of a glide, drag or wheel, every direct write and shift) and, after each commit and each
  notice, in a frame loop that lasts 1.5 s and until the slots have stood still for 20 frames. An inert page takes no focus, key or
  pointer; Tab already skipped inert panels (`panelRowTabOrder.ts`). A page focused while partly in the window is not inert, so the
  focus reveal still brings it in whole; a page a dot press glides in is cleared on the first frame any part of it is drawn inside,
  and takes focus at rest. A focused page that a scroll carries wholly out loses focus, as it did on the old row.
- An opened page. `useProvidePanels` ran a scroll request (an open, a show, a host's `panel.scrollTo()`) through the old row's
  scroller, which on Embla has no strip, so nothing moved and a page opened at the strip's end stayed out of view. On a strip it now
  calls `showOnEmbla`: from where the row is heading (`target`), the stop nearest the panel's `scrollOnOpen` place ('into-view' the
  least move, 'start', 'center'), a glide by Embla's `scrollTo` (a jump under Reduce Motion), nothing when it is there. The keep-still
  rule ran first in the commit that drew the page (the pages already there do not move until the glide), so the glide is the only
  move, and carrying the Workspace out of view is that glide. While a press, a wheel gesture or a reorder hold holds the row
  (`emblaHeld`), the scroll waits for the release (`whenEmblaFree`: Embla's `pointerUp`, `holdEmbla`'s release) and then reads the
  strip as it is drawn then. A request whose panel the published strip does not carry yet waits one commit, as before.
- `followPanel` (`scrollOnMove: 'follow'` after a move, a place or a resize) judged "in view" against the old scroller, which reads 0
  on Embla; once scroll requests moved the Embla row, a page resized far left of the view scrolled the row to it (the `change`
  section's left-edge page moved 810 px). On a strip it now reads the drawn strip, and a width change (resize, `setSlots`, a reset)
  does not follow at all: step 5's rule keeps the pages beside a growing page still (`width growInView` moved them 406 px otherwise).

Embla internals: none new (`dragHandler.pointerDown()`, `target`, `scrollSnaps` are already pinned).

Measured (`embla-row-proof.ts --only inert,open`, 1800 x 900, the root and 24 one-slot pages, window of four; each frame read in a
task after it was drawn). Negative control: the same proof copied into a `git archive e2515fc` extract: 14 failures (every inert case
and every open case); passes now.

| check | e2515fc | now |
| --- | --- | --- |
| slot-frames whose inert is not "drawn wholly outside" (rest; glide to slot 6; wheel 40 x 14 px; mouse drag 600 px; summon; dismiss; grab-strip ArrowRight out of view; dot press p20) | 378 / 1972 / 4370 / 3217 / 1375 / 1972 / 2031 / 1984 | 0 in every case (18-213 frames each, 1-35 edge crossings) |
| focus on an inert page | (no page was inert) | refused |
| p20 after its dot press: focus | taken | taken; it is drawn inside from frame 22 |
| focus on the three-slot p2 cut by the right edge | | glides 0 > 406, whole, on the grid |
| open at the strip's end, root in view at 0 | row stays at 0, page at 10150, root in view | glides to 8932 in 102 frames (worst 615 px of 8689), page whole at 1218, root away |
| open 80 ms into a glide to slot 3 | rests 1218, page out of view | rests 9338 (the end), page whole |
| open under a mouse drag held 150 px | after release rests at 0 | row stays at 150 under the pointer, then rests 8932 with the page whole |
| open under Reduce Motion | rests 0 | at once (0 moving frames recorded), page whole |

Mutants: no subscription to the row's notices (marks only after a commit) fails 6 (glide 12, wheel 4, drag 457, reorder 796, dot
press 781 slot-frames, and p20 refuses focus); the deferral dropped (`whenEmblaFree` runs at once while held) fails 2 (under the held drag the row
glides off to 8481 px, and after the release rests at 8526 with the page out of view).

## Second audit fixes (after step 8)

An independent audit at 2c8d40b found these; each check below fails on a `git archive 2c8d40b` extract with the new proof copied in,
passes now, and fails again with one mutant of its fix (each from a `git archive` of its commit). `--cases a,b` runs named cases of a
section (`reorder.wheel`, `width.shrinkAsidePresented`, `blank.summon`, ...).

- Wheel during a reorder drag (`--cases reorder.wheel`). The wheel-gestures plugin took the wheel while the reorder hold wrote the row, so
  Embla's own drag ran beside the one writer. The own row refuses every step while a drag holds its claim (`glideTo` is false under a
  claim), so that is the behaviour kept: the wheel listener (registered before the plugin's, now not passive like the plugin's) stops a
  wheel while `holdEmbla` holds the row and cancels a sideways one. 24 parkable pages, cap 8, p3 held 200 px right, 40 wheels of 12 px:
  at 2c8d40b the row moved 480.5 px, Embla's drag pressed in 174-176 frames (1 pointerDown), the page drifted 5.1-6.0 px off the pointer
  while the wheel ran, and the drop rested at 812 (nearest stop 406). Now 0 px, 0 frames, 0 px drift, rests at 0. Control: the same stream
  after the drop moves the row (168.5 px peak). Mutant (the hold test dropped): fails 3.
- shrinkAside on presented frames (`--cases width.shrinkAsidePresented`, CDP screencast on a magenta page). A 400 ms main-thread block
  mid-shrink settled the cause: p1's right edge kept moving (762 px) while p2 stood still, so the size box's scale ran on the compositor
  and the slot glides (composite 'add') did not. On an Embla row `PanelSizeBox` now adds its scale to the box's own transform
  (composite 'add', which Chrome keeps on the main thread) with `transform-origin` on the box's style for the run; the earlier attempt
  animated the origin additively too, which summed with the base origin. Widest band between two pages in any presented frame: 137 px at
  2c8d40b (77 px in the audit's run), 16 px now (one gap; the limit is 24); the layout measure stays 0.01 px. Under the same block p1 and
  p2 now freeze together (20 px). A clip-kind size box (reveal) on Embla runs on Motion's frame loop instead. Mutant (the box back on
  the compositor): 77 px, fails.
- Summon band (`--cases blank.summon`, now failing on a band wider than 16 + 8 px; it was recorded, not failed). The page leaving the
  slot the pinned root glides into stays at its rest through its exit (`setStayingExit`, read by the slot's exit) and is cut back from
  the root's side by a clip on the root's curve and clock; the gap between root and page closes as the root lands, so root, page and
  next page never show two gaps at once. Widest band: 220 / 228 px at 2c8d40b (cap 8 / 4, 25-26 of 39 frames), 16 / 16 px now. Reduce
  Motion: no glide and no cut, both land at once (the summon section's reduced case passes). Mutant (the leaving page runs its own
  exit): 220 / 216 px, fails. The cut alone (no clip, page held) also reads 16 px: the root then slides over the page instead of beside
  it; that difference is seen in the screenshots (`summon-left-mid.png`), not by a pixel check.

## Third pass (after the second audit)

Each check below fails on a `git archive 8e85487` extract with the new proof or test copied in (or on the unchanged files at the tip
before the fix, where `git diff 8e85487` of the fixed file was empty), passes now, and fails with one mutant of its fix (from a
`git archive` of the fix's commit).

- Dismiss beside a cut wide page (`--cases summon.asideCut`). The root stood aside for a four-slot page; a step right cut that page one
  slot at the left edge; a summon then a dismiss rested on the page's left edge (p1@0, was p1@-406; the app's "wide returns"). A summon
  from a step-aside now records where the page was drawn, and the dismiss rests it there. Mutant (the dismiss reveals the page again):
  fails. The summon section's cases are named now (`summon.fromLeft`, `summon.asideSize`, ...).
- `useRowFrameBand` measured only the old row's strip, so on Embla it never observed anything and never reported (the app's
  `--row-above`/`--row-below`). It takes the Embla window when there is no strip (`test/row-frame-band.test.ts`: 'none' on 8e85487).
  Mutant (strip only): fails 1.
- No page past the cap before the window is measured (`--cases strip.firstCommit`; the page's `late=1` draws the row unmeasured first,
  as the app does). Unmeasured, the window is the whole strip wide, so all 24 parkable views mounted at cap 8 and at cap 4 (the app:
  8 of 5 on a restore). The loader now takes the cap's nearest pages until the window is known: 8 and 4 mounts. Mutant (window
  always known): fails 4.
- Bare-arrow edge focus (`--cases keys.edgeFocus`). The Workspace's handler returned at once on Embla; a bare arrow with the panel in
  use out of view stepped the row (405 px) and focused nothing. It runs on Embla now, and `focusEdgePanel` reads the view as the
  Embla window: the row stays, Right focuses the leftmost page in view (p11), Left the rightmost (p12). `EMBLA_WINDOW_ATTRIBUTE` moved
  to `rowDom.ts`. Mutant (the Embla early return back): fails 2.

Items 5, 6 and 7, left from this pass, are in the fourth pass below.

- ArrowRight after a window-bar summon (app `workspace-summon.mjs`: "a step away returns the row", "stepping left reaches Workspace",
  "one step carries it out" at 1400 and 1800, 6 failures on the 8d42f37 build). The key reached the row and Embla took it, but
  `scrollNext` steps from Embla's selected index, which a direct write (the summon's land) leaves stale, so it named the stop the row
  rested on. A key step now goes one stop from the stop nearest where the row is heading, and a step away from a summoned root
  dismisses it (the own row's "a step away returns the row"). App proof on the 76059ee build: 1787 checks, 0 failed. Library case
  since: `summon.arrowAway` (fourth pass, below).

## The summon's cut, on presented frames

- `--cases summon.clip`: the page leaving the slot a summoned root glides into is cut back from the root's side (PanelRow's
  `arriveAndLeave` clip-path), so the root slides in beside it. Over that slot, on every frame the compositor presents, each column
  reads as the root's fill, page background or page: the root must be seen partly in (25 of 40 frames from each edge at f725aa1), and
  early in the glide background must lie between it and the page. With the clip-path removed it fails from both edges: from the left
  the page hid the root in all 40 frames (it came in under the page), and from the right the root met the page with no background in
  6 of 6 early frames (it slid over it).

## Fourth pass (items 5, 6, 7 and 11)

Each check fails on a `git archive` extract of the commit before its fix with the new proof copied in, passes now, and fails with one
mutant of its fix.

- Arrow after a summon (`--cases summon.arrowAway`, item 11). From the left, ArrowRight returns the row (p14..p17 at 5684, the pages in
  view standing still) and the next ArrowRight rests one stop on; from the right, ArrowLeft returns it and ArrowRight steps to p2..p5.
  At 8d42f37: 6 failures (ArrowRight stepped to 6089.5 with the summon over; ArrowLeft left the root summoned). Mutant (the step-away
  dismiss removed): the same 6. The other half of 76059ee (a step counts from the stop nearest where the row is heading, not Embla's
  selected index) has no proof case: reverting it to `scrollNext` passes the proof, because every library write ends in a `scrollTo`
  that sets the index; the app's window-bar summon (`workspace-summon.mjs`) is its check, and `test/mount-row-engine.test.ts` (the host
  chord, which still stubbed `scrollNext` and failed since 76059ee) now requires one stop from the stop nearest the row's target, and
  fails on the `scrollNext` revert.
- A wheel gesture running when a reorder hold starts (`--cases reorder.wheelBefore,reorder.wheelClick`, item 7). The plugin holds
  Embla's drag with an untrusted press and lets go only when the gesture's tail ends; that release glided the row to a stop under the
  held page (d288b48: 168 px under the hold, Embla pressed in 14 held frames). A person's press now ends the wheel's press and leaves the
  row where it is drawn (as a press stops a native scroll's momentum); its release settles the row on a stop unless a reorder hold took
  it, and the hold ends one too. Now 0 px, 0 frames, 0 px drift; a press and release with no drag: 137.8 px moved under the press at
  d288b48, 0 now, rest on the grid. Mutant (nothing ends the press): both fail. The drift is read off the grab point in the first frame
  recorded after the press, once the pointer stands still (the dragged box follows a pointer move a frame late).
- API (`--cases summon.api`, item 6). `panel.scrollTo()` answered off the old scroller (0 on a strip): from slot 10, a scrollTo of p2
  moved the row to 812 and answered `changed: false`; it now reads where the Embla row is heading (`emblaWouldShow`). A request for the
  Workspace while it stood aside was dropped; it comes back at the edge it left by and is shown (root at 0). `usePanelPresence` never
  read 'scrolledAway' on Embla (0 of 20 inert pages); the row's away store now follows the inert marks (20 of 20). A scroll request no
  longer asks the old scroller whether a drag holds the row: the Embla row's holds defer it (`whenEmblaFree`). At bb5dc10: 3 failures;
  one mutant per fix fails its own check.
- Reduce Motion on the row's own moves (`--cases summon.reducedRelease`, item 5). A mouse drag's release, a wheel release with a strip
  change waiting for it (`moveEmbla`'s rebuild) and a focus reveal land in 1, 0 and 1 moving frames; without Reduce Motion the same
  inputs glide 59-63 frames (control). Mutant (the reduced flag never set): all three fail, and `summon.reduced`'s arrow.
- The loader's look-ahead (`--cases blank.lead`, item 5). Far dot press at cap 4: pages the glide carries into the window load 2-8
  frames before they enter (median 4; the first at 0 as the glide starts). `AHEAD_STEPS = 0`: 14 of 18 enter in the frame they load,
  median 0, fails. The look-ahead stays: it is the time a page (a web view) gets to draw before it is seen.
- Reorder checks tightened (item 5): passed-over range from held frames only, a page passed over only when the box covered more than
  half of it, 70 px per frame for a passed-over page (was 101.5; hops measure 30.8-33.8) in `edgeHold` and both left-edge drops, and
  the band drop must land within half a slot of where it was let go (1873.6 released, 2030 landed).

Not applicable on a strip, with the evidence: `revealOnScroll` brings in a panel parked for room when a step reaches the row's end;
on a strip nothing parks for room (step 7: `rowPricing` gives a strip an infinite capacity, 25 of 25 slots drawn), so there is no
such panel. A host's own hide stays hidden on a strip and is not revealed by a step (the old row's step would): untested, noted. The
settle after a hand resize: on a strip every width commit runs `moveEmbla`, which rests the row on a stop (step 5's width cases rest on
the grid in every run), so no separate settle is needed; a hand resize itself is still untried on Embla.

Not done: a presented-frame pixel check that fails when the summon's leaving-page clip is removed (the screenshots remain the only
evidence that the root slides beside the cut page, not over it).

## A wheel that pauses or stops (the owner's wiggle and drag-back)

Owner's report, after trying the app: "Scrolling has a wiggle/drag back effect when as i scroll the wheel when I lift my finger to
reposition it and when stop scrolling altoghether".

Cause, read off per-frame traces (`--only settle`, each case's frames in `settle-<case>-frames.json`):

- The wheel-gestures plugin ends its gesture at any pause of about 100-170 ms (its end timer is about twice the gap between wheels,
  at least 100 ms), so a finger lifted to reposition ends it, and in Chromium 151 it also ends at the first event flagged
  `WheelEvent.momentum` (a trackpad's lift). Its untrusted mouseup is Embla's drag release: Embla picks the stop nearest the drag's
  target plus a flick guess from the last 170 ms. On a trackpad swipe stopped at 121 px that stop is 0, so the row glided back 24 px
  (7.5 px in one frame) until the next swipe pressed again and turned it forward: the drag-back, then the wiggle. On mouse-wheel bursts
  the flick guess threw the row ahead instead (1,200 px of notches rested at 1,624 or 2,030 px).
- Embla's drag body (friction 0.3, duration 0.75) is an underdamped spring: at the end of every burst it ran 1-2 px past the wheel and
  came back, 10-15 backward frames per run.

The old row never had this (Joe recalled a similar fix there): its gesture (`useRowScrollGesture`) asks for steps in the direction of
travel only, one stop ahead per step, a step mid-glide retargets the glide in flight, and travel against the gesture under a quarter
step (a momentum tail's flicker) is not a reversal. The half-step commits (`8e9e9e0`, `5802c60`) concern where a dot click or a step
rests, not the wheel. The same rule now holds on Embla:

- One wheel gesture is one press of Embla's drag, from its first wheel until the wheel has been idle `WHEEL_IDLE_MS` (500 ms,
  Chromium's own mouse-wheel transaction, `kDefaultMouseWheelLatchingTransaction`: a wheel that soon after the last one is the same
  scroll). The plugin's own release is held back, its next press continues the same drag from where Embla last read it, and a
  momentum tail it drops after its momentum release moves the row by each event's delta, short of the row's ends. No study of how long
  a finger takes to reposition on a wheel was found; a pause longer than 500 ms settles and the next burst continues from the drawn
  position.
- At idle the release rests on the first stop not behind the travel (`stopAhead`; on a stop within half a px it stays). The direction
  turns only after 8 px of travel against it.
- While a wheel drives it, Embla's body is critically damped (friction 0.1, duration 0.22): it trails the wheel by no more than the old
  spring did (33 px in a 40 px-per-30 ms burst, modelled) and never overshoots.
- A key step during the hold ends it where the row is drawn and steps from there, as a press already did. Keyboard, dot bar, mouse drag
  and summon settles are unchanged.

Measured (`--only settle`, narrow row, pitch 406; wheels handed in on their own timers, a trackpad's one per frame; per frame, backward =
a frame moving more than 0.5 px against the scroll):

| case | 1529ed3: backward frames / px (worst frame), reversals, rest, settle | now |
| --- | --- | --- |
| notches 6 x 40 px, 80 ms pauses, x5 | 6 / 6.0 (1.6), 6, 1218, 435 ms | 0 / 0, 0, 1218, 1066 ms |
| 150 ms pauses | 12 / 10.7 (1.2), 10, 1624 (input 1200), 1097 ms | 0 / 0, 0, 1218, 1035 ms |
| 300 ms pauses | 15 / 11.6 (1.0), 10, 2030, 1062 ms; bursts 1.09-1.13 px/px | 0 / 0, 0, 1218, 1056 ms; bursts 0.99-1.00 |
| 600 ms pauses | 13 / 10.9 (1.2), 10, 2030, 745 ms | 0 / 0, 0, 1624, 1361 ms |
| trackpad, momentum flagged | 5 / 24.2 (7.5), 2, 406 | 0 / 0, 0, 812, 1466 ms; tail 1:1 (1.001) |
| trackpad, tail not flagged | 5 / 23.3 (7.2), 2, 406 | 0 / 0, 0, 812, 1466 ms |
| 440 px, just past 406 | 4 / 4.5 (1.7), 2, 812 | 0 / 0, 0, 812, 1450 ms |
| 360 px, just before 406 | 3 / 2.8 (1.2), 2, 406 | 0 / 0, 0, 406, 1191 ms |

Every case fails at 1529ed3 on its backward frames and reversals. Each burst that starts from a standing row moves 0.99-1.02 px per
input px now; a burst that starts while the settle glides (600 ms pauses) carries up to a frame of that glide and is checked only for
moving one way. The rest-behind and settle-time (1.8 s) checks are guards the tip also passes. Mutant (the release rests on the nearest
stop, `stopAhead(…, 0)`): 4 of 8 cases fail: just past (29.8 px back, rests 406), 600 ms pauses (121.3 px back, 11.8 px in one frame), both trackpads
(9.1 px back, rest 406); the four whose nearest stop is ahead anyway pass, as they should under that mutant.

What this costs: the row now holds still, off the grid, for 500 ms after the last wheel before it settles, and a scroll that stops just
past a stop goes on to the next one (440 px rests at 812, 372 px further), because a stop behind is ruled out; settles take 1.0-1.5 s
after the last wheel (0.4-1.1 s at the tip, which settled sooner by settling backward).

Not covered: a real mouse wheel and a real trackpad (headless takes only synthetic wheels: the streams are shaped, not recorded),
Safari, where the plugin guesses a momentum tail from its deceleration (in Chromium 151 every wheel carries a `momentum` flag, so that guess never runs here; the unflagged case is a tail the plugin passes as plain wheels), a horizontal
tilt wheel's own cadence, and the gap a real finger reposition takes.

## The Workspace as an ordinary page (owner ruling 2026-11-09)

Joe picked "Workspace as a normal page": the Workspace sits in the row and scrolls like any page, reached by scrolling or its dot. His
model of the summon: "Isn't it just a quick reorder of where ever the workspace currently sits to just offscreen, and then normal
scrolling brings it in?" So on Embla `summonRoot()` (the window bar's button and tabs) does two things:

- `emblaSummonMove` (emblaRow.ts) picks the slot just outside the view on the side the root lies on (the left when on neither): next
  to the first page reaching into the view on the left, or the last one on the right. The provider moves the root there with
  `reorderPanel(rootId, hops, true)`, the person's move path (one order commit, recorded as the saved order). The view read is the one
  drawn now, so mid-glide the root never lands inside the view.
- The glide is `requestScroll` of the root (`showOnEmbla`: from where the row is heading, to the nearest stop, a jump under Reduce
  Motion, deferred while a gesture holds the row). A wheel gesture's hold is ended where the row is drawn first (`endEmblaWheel`, as a
  key step does); a person's drag defers the whole summon to its release (`whenEmblaFree`).
- The commit that draws the move snaps the slots it moves (`noteEmblaMove`; all of them are out of the view), so the root stands at
  its new place before the glide brings it in and no page slides on its own. Pages in the view keep their strip places, so the
  keep-still rule leaves the view where it is.

After that the root is an ordinary page. `dismissRoot()` does nothing on Embla and returns false; `rootView()` reads 'shown' or 'away'.
Scrolling to it or pressing its dot only scrolls. With it wholly in view the summon does nothing.

Deleted (emblaRow.ts, PanelRow.tsx, PanelRowSlot.tsx, useProvidePanels.ts): `emblaSummonPlan`, `emblaAsideFor`, `EmblaRowMark`,
`markEmblaRow`, `markedScroll`, `emblaMarkOf`, `setStayingExit`, `staysOnExit`, `onEmblaStep` (the step hook), moveEmbla's `land`,
`stayingEdgeExit`, the summon clip and the marked-commit slide-in and fade-in in `arriveAndLeave`, the provider's `stripSummon` and
`stripAside` state, the step-away dismiss, the step-aside layout effect and the aside branch of `requestScroll`. Unit tests removed:
the five `emblaSummonPlan`, two `emblaAsideFor` and four `markedScroll` tests (test/embla-row-summon.test.ts), replaced by five
`emblaSummonMove` tests (one a 400-run property: the root lands one gap outside the view on its side, every page reaching into the view
keeps its strip place). Proof cases removed: summon.dismiss*, stepToward, scrollOut, dotOut, arrowAway, asideResize, asideSize, asideCut,
apiAside, summonDrag, dismissDrag, dismissMidGlide, reducedAside, unrelatedClose, clip; width.growSummoned; inert's dismiss run.
Renamed: width.shrinkAside to shrinkBesideRoot (the root now stays beside the cut page) and width.shrinkAsidePresented to shrinkPresented.

Also changed: `moveEmbla` shifts a glide in flight in place (positions and target) instead of writing the drawn position and starting a
new glide from rest. The first draft placed the root next to the view the glide was heading for; mid-glide that was inside the drawn
view (the root appeared at 1113 px in the window) and the strip jumped 270 px in one frame (`summon-midGlide-frames.json`).

Proof (`embla-row-proof.ts --only summon`, 24 one-slot pages and the root, window of four). Per frame, over the pages drawn in the
window or one gap past its edges: every page moves by the strip's one shift within 0.5 px (nothing snaps or slides on its own), no
frame moves the strip more than half a slot, the window has no run wider than a gap that no page covers, no unloaded placeholder in it.

| case | result |
| --- | --- |
| fromLeft: root at place 2, view p14..p17 | root moved to place 13 (next to p14), 1 order commit, glides in: view root,p14,p15,p16 at 5278, root drawn at 39 places coming in, fastest frame 118 px, 0 px off the strip shift, widest hole 16 px |
| fromRight: root at place 20, view p3..p6 | root moved to place 6 (after p6), 1 commit, view p4,p5,p6,root at 1218 |
| stays: glide to 20, back to 13, scrollTo(root) from 20 | order unchanged, 0 commits, root at 0 back at slot 13 |
| inView: root in view | summon false, dismiss false, row moved 0 px, 0 commits |
| reduced (Reduce Motion) | lands at once (root at <= 2 places), same order and view, 1 commit |
| midGlide: pressed 90 ms into a glide 14 > 18 | root next to the drawn view (place 14), the glide turns and lands root,p15,p16,p17 at 5684; fastest frame 60 px, 0 px off the shift |
| midWheel: pressed during a 300 px wheel | the hold ends, root at 13, glides back to root,p14,p15,p16 at 5278; fastest frame 124 px |

Full proof (all sections): failed [], empty []. `summon.reducedRelease` (the intermittent focus check) is kept unchanged: it is
not a summon case (a drag release, a wheel release and a focus reveal under Reduce Motion); it passed in this run. Mutant (the
reorder skipped, so the summon is only a glide to the root where it lies): fromLeft and fromRight fail 8 checks (the strip moved
1415 / 1778 px in a frame, order unchanged, 0 commits, view root,p3,p4,p5 / p18,p19,p20,root). Library suite: 3286 tests, 3284 pass,
1 skip, 1 fail (`content that arrives after the timeout still comes in`, panel-loader; 10/10 alone, three runs) against 3292/3291/1:
11 tests removed, 5 added.

Blank (`--only blank`): the summon run is held to the same rule as every other run (no presented frame with a magenta band of 100 px
or more) and to a band no wider than a gap and 8 px. Inert: the summon run as before; the dismiss run is gone.

### At the row's ends (the owner's snap-back)

Owner's report, on a mouse wheel: "I scrolled all the way thought the first blue dot, and then it snapped back to where it is!" The
oval rested about ten dots right of the start.

Cause, read off per-frame traces (`--only settle --cases settle.endLeft,...`; each case's frames, with Embla's location and target, are
in `settle-<case>-frames.json`):

- A pointer move by the person reached the held press. The plugin blocks trusted mouse events only while its own gesture runs. The hold
  above keeps Embla's press past the plugin's end, through a finger's pause and the 500 ms after the last wheel. Embla listens for
  `mousemove` on the document. A 1 px move of the mouse under the hand reached Embla's drag, which read it against the plugin's pointer,
  the gesture's whole travel away. In one frame the target went back to where the gesture began: 1,512 px in one frame, and a rest at
  3,248, the start of the scroll.
- The end is where a hand moves: the wheel is ground on past the end, then let go. Mid-strip the same happens on any pause the pointer
  moves in (`settle.midHand`).
- A long grind past the start turned the gesture around. Once the plugin's pointer is half the strip past the end, the plugin ends its
  gesture and passes nothing until the wheel pauses. Each wheel then goes through the row's tail path ("short of the row's ends"),
  which clamped the target into `[0, max]`. From a stretched target (-208) that is a 208 px pull toward the end, against the wheel. It
  turned the gesture's direction, and `stopAhead` from the target left 0.83 px inside rested on the next stop: 406 px off the start
  (`settle.endLeftLong`, 1 of 2 full runs at 97aab2c; the pull itself is in every run, 200-208 px in one frame).
- Ruled out by the traces: the rest computed from an out-of-bounds target, a misread direction, and Embla's own bounds pulling back.
  With handed-in wheels and no pointer (`settle.endLeftFeed`, `endRightFeed`), 9a55bbb rests exactly at each end. The drag stretches the
  row 280-330 px past the end, with Embla's edge resistance, and springs back to the end. The step-aside depends on that stretch: a
  Workspace stepped aside at the start comes back only when the row moves past its rest toward it (`summon.unrelatedClose`). A clamp of
  the wheel at the ends was tried. It broke that case ("the wheel did not bring the root back"), so the stretch stays.

Fix: while a wheel gesture holds the press, a person's trusted `mousemove`, `mouseup`, `touchmove` and `touchend` (the set Embla's
drag listens for on the document from a mouse press, `DragHandler.addDragEvents`) are stopped at the document before Embla's own
listeners. They are registered at mount, ahead of the ones Embla adds at each press. A trusted press inside the row still ends the hold
first (`onPress`), so its own release passes. The tail path never moves the target back toward an end it is
stretched past: a wheel there moves nothing, and Embla's edge resistance and the release bring it back.

Measured. The row is narrow: 25 one-slot pages, the Workspace first unless said, pitch 406, max 8,526. Bursts are six 40 px notches,
30 ms apart. The pauses run 80/300/150/450 ms in turn (one held gesture), or 80/300/150/600 ms. The wheels are real (trusted, at the
pointer), except in the feed cases. "Hand" means the pointer moved 1 px. "Back" counts a frame that moves more than 0.5 px against the
scroll and lands inside the strip:

| case | 9a55bbb: rest, back px (frames, worst frame) | now |
| --- | --- | --- |
| endLeft: from 3,248 to the start and 1,072 px on, hand 200 ms after the stop | 3,248; 3,950 (9, 1,512) | 0; 0 |
| endRight: the same into the right end | 5,278; 4,032 (9, 1,538) | 8,526; 0 |
| endLeftRootFar: endLeft with the Workspace moved to the far end | 3,248; 4,018 (9, 1,538) | 0; 0 |
| endLeftHand: hand in every pause, 600 ms pauses | 2,842, never reached the start; 4,507 (34, 381) | 0; 0 |
| endLeftLong: from 812, 7,200 px with no pause, hand after | 812; 845 (26, 315) | 0; 0 (target back while pressed: 205 px at 97aab2c, at most 8 now) |
| midHand: 960 px from 6,496, hand in the pauses | 6,090; 1,002 (7, 381) | 5,278; 0 |
| endLeftFeed / endRightFeed: handed in, no pointer (controls) | 0 / 8,526; 0 | 0 / 8,526; 0 |
| midUp: midHand with a bare mouse button release in the pauses (a button held on a panel since before the wheel) | at 705f2c1: 5,684, behind the 5,536 reached; 144 (33, 9.5) | 5,278; 0 |

The stretch past the end is reported (`drawnPastEndPx`, 180-353 px at 9a55bbb and 210-321 px now) and not failed.

Independent re-trace (2026-11-09, headless, trusted wheels through CDP, two bursts of six notches with a 300 ms gap, no other input):
at 9a55bbb the row rests on the stop ahead (3,248 from 4,060) at every gap from 50 to 600 ms, so the double scroll alone does not snap
back; a trusted `mousemove` 250 ms after a burst (after the plugin's own end, 168 ms after the last notch in that run, inside the 500 ms
hold) does, even with no travel at all (same x and y: rest 4,060, the exact start, 480 px of target in one frame). A hand that moves
170 ms after the burst is still blocked by the plugin and does nothing. At 705f2c1 the same inputs rest at 3,248. What still reached
the held press at 705f2c1: a bare trusted `mouseup` (Embla's own release to the nearest stop, 132 px back) and a touch outside the row
(its `touchmove` is read against the plugin's pointer, as the move was); a right-click's `contextmenu` runs Embla's release once more
after the press has ended the hold (a 406 px target step to the nearest stop, then the press's own settle, also to the nearest stop).

Mutant (the pointer's move not stopped): 6 of 8 cases fail with the 9a55bbb numbers (endLeft rests 3,248, 1,509 px in one frame).
Mutant 3 (`mouseup` dropped from the stopped set): midUp fails with the 705f2c1 numbers (rests 5,684, 143.9 px back in 33 frames).
The two feed controls pass, as they should with no pointer. Mutant 2 (the tail path's clamp as at 97aab2c): endLeftLong fails,
with the target stepping 205 px against the scroll in one frame while pressed. The check is that no pressed frame steps Embla's target
more than 50 px against the scroll; edge resistance takes up to 26.

What this costs: while a wheel gesture holds the row, the document and the window hear no pointer move. The plugin already withheld
every trusted mouse event during its own gesture.

Not covered:
- A press inside the row during the hold ends it where the row is drawn and rests on the nearest stop, by design; a right-click there
  also runs Embla's own release on `contextmenu` (its root listener), to the nearest stop as well. A press outside the row leaves the
  hold alone, and its release is stopped with the rest.
- The hold itself is the design that lets these in: Embla's press is kept open across the plugin's gaps so that its release does not
  pick a stop behind the scroll. Driving the row by Embla's target directly during a wheel (no press at all) would close every such
  path at once, but loses Embla's edge stretch under a press, which the step-aside's way back reads (above); not done here.
- A touch moving during a mouse wheel's hold: `touchmove`/`touchend` are in the stopped set, and a touch inside the row ends the
  hold as a press; a touch outside the row was traced only at 705f2c1 (the set stops it) and has no proof case.
- The stretch past an end itself: a wheel with no rubber band would need the step-aside to read "toward the root" some other way.

## Not done yet (still on the old row, or not working on Embla yet)

- Reorder on Embla: a wide (two-slot or wider) page dragged, a drag held at the left edge to the strip's start, a touch drag and a
  host that refuses a move were not tried. Width changes: a hand resize (`usePanelResizing`, a held width) and a window resize
  during a size glide were not tried on Embla; maximize was tried with a wheel and a key, not with a window resize while grown.
- Summon on Embla: a root held at an edge (`edgeHold`), a root wider than one slot, a window one slot wide, a summon during a mouse
  drag of the row (deferred to the release by design) and a host refusing the move (`crossable: false`) were not tried in the browser.
- `revealOnScroll` and the settle after a hand resize: not applicable on a strip (fourth pass); a host-hidden panel is not revealed by a
  step on Embla.
- Edge-held panels (`edgeHold`) were not tried on Embla: the old drawing pass that holds them needs the old strip.
- Shift + vertical wheel is not read as sideways; a finger drag was not measured (headless has no touch stream); a real
  trackpad and Safari were not tried.
