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

Not covered yet: a change while the row glides (the jump lands from where the glide is and the glide ends), and opening a panel
left of the view in the browser (the model test covers it; the proof page has no second template to open).

## Step 7: one strip, far pages unloaded (in progress: one defect open)

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

**Open defect:** once a parkable panel has unloaded, every parkable panel's view renders the library's "unregistered view" fallback
(`TemplatePanelView` finds no handle: `viewContext.handleFor` returns undefined), the near ones included; with nothing unloaded
(`rowNearSlots` 99) the views survive a glide. So "a near page keeps its state" and "a far page loads again" fail in the proof
(`strip: p2 one slot from the view lost its state`, `rowNearSlots 0 leaves 0 ... loaded`). Next: find why the handle lookup
(`workspaceCore` `handleFor`, `observed ?? committed` entries) drops the parkable panels after the first placeholder.

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
| control: Embla's eased drag (`emblaOvalDrag.eased`) | worst 39.4 px, median 35.7: the check fails as it should |
| pointer held 20 px past a 300 px bar's end for 1 s | row moved 1040 px, 0 of 59 frames still |
| control: held mid-bar | 0 px |
| dot press on p20 | glides to show it |

## Not done yet (still on the old row, or not working on Embla yet)

- Workspace summon, dismiss and step-aside (step 4); maximize and animated width changes (step 5); drag to reorder and its
  edge scroll (step 6).
- Anything that asks the old row scroller to move (`scrollOnOpen`, `revealOnScroll`, a host's `stepRow` chord, the settle after a
  hand resize) moves nothing on Embla.
- Edge-held panels (`edgeHold`) were not tried on Embla: the old drawing pass that holds them needs the old strip.
- Shift + vertical wheel is not read as sideways; a finger drag was not measured (headless has no touch stream); a real
  trackpad and Safari were not tried.
