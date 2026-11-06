# Row and scrollbar: redesign or targeted fixes?

Read-only design review, 2026-11-05. Library: `~/git/phonux-cloud-main.worktrees/wt-row-slots` (plan/row-slots-rc7, 59a15e2). App: `~/git/phonUX.worktrees/wt-rc7-spike` (plan/rc7-ux-spike, 1e947e8b). Nothing was edited, built or run.

## 1. For the owner

**Verdict: hybrid, leaning redesign of the core. Confidence about 75%.**

Keep the parts that are sound: the pure width-and-stops arithmetic, the gesture reading (wheel, touch, keys), the maximize FLIP, the slot z-order rule, the public hooks the app calls. Replace the core that decides *where things are*: today there is no single answer to "where is this panel on screen right now", so every feature that moves something (a step, a park, a hold, a resize, a dot drag) has to guess what everyone else is doing and compensate. Each compensation is a new place for the next bug. Targeted fixes cannot end the class, because the class *is* the compensation.

Three root causes, in plain terms:

1. **Many hands on the wheel.** Thirteen places tell the row to glide, four grab it exclusively, one slides its centering margin, and nine more write a transform to some part of it (the strip, each slot, the held panel, the size box, the root nudge, the maximize). None reads a single shared "where everything is now"; several read the screen back (`getBoundingClientRect`) because, as a comment says, "the numbers can be ahead of what is drawn".
2. **The ruler changes length under the pointer.** Positions are measured from the first *drawn* panel. When a panel parks, or the Workspace panel gets held, that panel leaves the list and every position shifts. The newest commits (5 Nov: "Keep the row still when a hold lets go", "keep the row still across swaps") add an `anchor` that measures the shift and folds it back into the offset. The dot bar re-derives the same thing through six stages, each with its own clamp. That is where "the oval leads the pointer", "the dot bar shows a gap" and "the run shifts near +N" live.
3. **Coordination by clock, not by state.** "A frame later", "after one slide duration", "until the panels change", "wait three commits", a `settling` flag, a `replayScroll` claim, a `swapStepRef`. These are promises about timing between independent effects. When two overlap (a resize while a hold flips; a dot click during a settle) they fire out of order, and something moves twice or not at all.

**Evidence in one line:** 525 of the library's 2,008 commits touch these ten files; 280 of the 385 non-merge ones are about motion; 400 landed in October and 19 in the first five days of November, each adding a compensation to the last.

**What the redesign is:** one ordered list of every panel (held, live, parked) laid along one continuous ruler; one number for where the window is; "parked" means off the ruler's window; the held panel is drawn by clamping its screen position to the edge; the dot bar is that same ruler shrunk. One animation driver moves the one number; one pass draws every slot and every dot from it.

**Rough size:** about 2,500–3,500 library lines touched (roughly 1,800 deleted, 1,200 added), ~150 app lines; 6–9 worker sessions with a verifier pass each, in seven steps that each leave the app working. Best started right after the rc7 cut, not during it.

**If we do nothing:** the pattern of the last five weeks continues. Every new feature that touches the row (a second row, column bands, pinned rows) adds another writer and another timing promise, and the known bugs below that are marked "left" stay.

## 2. Root structure (for the implementer)

### 2.1 Writers of position, counted

| what moves | writer(s) | where |
| --- | --- | --- |
| strip offset (`offset`) | 13 `glideTo` sites, 4 `claim().write` holders, the `scroll` event handler (`place`) | rowFastScroll.ts:22-26, panelRowDropScroll.ts:85, Workspace.tsx:304,419,501, useProvidePanels.ts:654,667,683,913,960; claims: Workspace.tsx:273, usePanelDots.ts:233, panelRowDropScroll.ts:34, panelFrameClaim.ts:22 |
| strip margin (`margin`) | `setMargin` every commit from `workspaceShellStyle` | Workspace.tsx:519-524 |
| end bump | `bump`/`keepBump` | useProvidePanels.ts:585 |
| strip transform | rowScroller `draw`/`tick` (style + WAAPI) and the clip-path loop | rowScroller.ts:211,224,226,244; Workspace.tsx:446,464 |
| each slot's x | `slotMover` pose from `leftOffset` (WAAPI per slot) | slotMover.ts:62,117; PanelRowSlot.tsx:325-370 |
| held panel | `PanelHold` transform per frame via `subscribe`, measured once per commit with `getBoundingClientRect` | PanelRow.tsx:115-147 |
| panel width | `SizeBox` transform/clip WAAPI, plus `followSize` so the offset glide rides its clock | PanelRowSlot.tsx:556-580,651 |
| root nudge | `root.animate(translate)` | PanelRow.tsx:377-384 |
| maximize | `root.style.transform` from a slot box read at lift | panelMaximize.ts:101-106 |
| anchor fold-in | `rowAnchor` computed *during render* from scroller state, consumed by the settle effect | useProvidePanels.ts:362-367, 651-654 |

`rowNumbers` is computed in render but reads `scroller.glideTarget()`, `claimHeld()`, `settling()` and a ref (useProvidePanels.ts:360-367): the same props can yield different numbers depending on animation state, and the settle effect is keyed on them (line 684). Three flags gate one computation.

### 2.2 The reference list changes

`computeRowNumbers` filters `isPresent` (parked out), then removes held panels into `held[]` (rowNumbers.ts:106-123). `leftOffsets[0]` is always 0 for the first *drawn strip* panel. So:

- park or unpark a panel left of the window: every offset shifts by its width; the offset must be compensated (`rowAnchor`, 5 Nov).
- hold starts or lets go: `leftInset` appears/disappears, `stripStart` moves, the margin re-centers (`setMargin` glide) and the strip re-zeroes. Both `6798474` and `59a15e2` are this.
- `admitHolds` releases every hold when the strip stops overflowing (rowNumbers.ts:286), so a close that makes the row fit flips the coordinate system a second time.
- `PanelRow` derives its own `leftOffsets` (PanelRow.tsx:305-320) with a `pinShift` override, a second declaration of the same quantity.

Dot bar chain, one scroll value in: `scrollLeft` → `seen = scrollLeft - (stripStart - leftInset)` (usePanelDots.ts:155) → `toTrack` piecewise (rowDots.ts:82) → `withParked` shifts drawn dots by parked widths (rowDots.ts:160) → `withHeld` shifts again and widens the oval (rowDots.ts:191) → app `dotOverflow` offsets the run with a remembered `prev` (dotOverflow.ts) → `carry` overrides the oval during a drag on a non-scrolling row (usePanelDots.ts:261-274). Six stages, five clamps, one stateful memory. "Oval leads pointer in first slot" is stage 5 vs 7; "run shifts by whole dots" is stage 6.

### 2.3 Coordination by time

Workspace.tsx: 5 timers/rAFs, including `setTimeout(..., slide duration)` (line 318-320) to decide whether a settle still applies; `useResizeSettled` delay. useProvidePanels.ts: `REQUEST_WAIT_COMMITS` misses, two `requestAnimationFrame(() => requestScroll...)` "a frame later", `swapStepRef` kept "until the panels themselves change" (686-690), `settleKeeping` → `setPanels` in a layout effect (352-354) so a park takes a second commit. usePanelDots.ts: `seek` steps on a timer; `stepAsked` compares `performance.now()`. rowScroller: `SIZE_FOLLOW_MS = 150` window in which a glide "rides" a size glide's clock.

### 2.4 "On screen" is declared five times

`awayStore` via `slotCutAt` (Workspace.tsx clip loop); `dots.shown` by strip overlap > 1 px (usePanelDots.ts:169); `isShown` by DOM rects with a 48 px threshold (rowStep.ts:40); `drawsWhole` (rowNumbers.ts:242); `stopSpans`/`spanAt` (rowNumbers.ts:316). The app's "Viewing" list reads `dots.shown`; its header Hidden time reads something else. They can disagree and do (the "dot bar disagrees with the Workspace panel" report).

### 2.5 How comparable systems do it

- **niri** (fetched: `src/layout/scrolling.rs`): one `ViewOffset` enum, `Static | Animation | Gesture`; `view_pos() = column_x(active) + view_offset.current()`; column x is a running sum of cached widths (`column_xs()`); when the active column changes, `animate_view_offset_with_config` first applies `offset_delta = old_col_x - new_col_x` so the screen does not move; on a resize the neighbours get their own x animation and the view offset is adjusted "so that it looks nice". That is the anchor rule and the resize rule, computed in the model once, never measured from the screen.
- **PaperWM** (fetched: `tiling.js`): one `Space.targetX`; `cloneContainer.x` chases it; every window's screen x is `clone.targetX + space.targetX`; `ensureViewport` is the one place that decides scroll.
- **Embla** (fetched: `Engine.ts`, `ScrollBody.ts`, `Animations.ts`): four scalar stores (`location`, `target`, `offsetLocation`, `previousLocation`); `ScrollBody.seek()` is the one writer of `location`; a fixed-timestep loop renders with alpha; drag, scrollTo and bounds all write `target`, never the DOM. Resize re-creates the engine from new rects rather than patching.
- **Flicking** (fetched: Options page): one camera element moves; `align` positions camera and panels separately; `renderOnlyVisible`/`virtual` are derived from the camera position, which is the unloading model proposed below.
- **FLIP** (fetched: aerotwist): compute the final layout first, animate the inverted delta on transform only. The maximizer already does this; slot moves and size glides half do (they animate transforms but read "first" from live DOM during motion).
- Not fetched, from memory, marked as such: react-window renders items by `index * itemSize - scrollOffset` from one scroll offset; Swiper keeps one `translate` and derives `activeIndex`/progress from it.

Every one of these has exactly one position scalar and derives everything else. phonux has one scalar (`offset`) plus a second (`margin`) plus per-slot poses plus a held transform plus an anchor, in a coordinate system that re-zeroes.

## 3. Proposed structure

A pure module, `rowModel.ts`, and one driver.

```ts
// All panels in order; nothing leaves the list for being parked or held.
interface RowModel {
  panels: readonly { id: string; slots: number; hidden?: boolean }[]; // hidden: revealOnScroll 'never'; not drawn, no dot
  heldLeft: string | null;        // the Workspace panel
  slotPx: number; gapPx: number;  // phone + gap
  windowPx: number;               // container less padding
  scroll: number;                 // what steps, dots and claims move, px; animated on its own clock
  origin: number;                 // minus the centering, px; animated on its own clock; view = scroll + origin
}
// Derived, never stored:
//   x[i]      = running sum of (slots*slotPx + gaps) over drawn panels before i   (parked ones INCLUDED)
//   view      = scroll + origin   (two scalars, never merged into one)
//   screen(i) = x[i] - view;  held: max(screen(i), 0)   (clamp; the hold is a render rule, not a layout group)
//   stops     = every slot boundary from x[heldWidth] to maxView;  step = view += slotPx+gap, clamped to a stop
//   drawnWhole(i) = screen(i) >= 0 && screen(i)+w[i] <= windowPx          (the ONE on-screen predicate)
//   parked(i) = screen(i)+w[i] <= -overscan || screen(i) >= windowPx+overscan   (unload rule, derived)
//   dots      = scale k = trackPx/stripPx;  dot(i) at k*x[i], width k*w[i];  oval at [k*view, k*(view+windowPx)]
//   centering = (windowPx - wholeSlots*pitch)/2, which the origin follows (origin = -centering)
```

Animation: the view is two scalars that add, `scroll` and `origin`, each with its own glide on its own clock (rowScroller's WAAPI sampler, reused). Step 3 tried one `Static | Glide | Gesture` scalar first and it failed the audit: a fade became a slide, the end-of-row bump waited behind a centering, and a scroll glide was retimed to the centering's length. So the model has no single animated `view`; `scroll` is what the user and the dots move, and `reorigin(centering)` moves only `origin`. `x[i]` and `w[i]` animate only on list changes (open, close, reorder, resize), each a glide from the previous derived value to the new one. A list change that would move a kept panel on screen is compensated in the model: `scroll += x_new[k] - x_old[k]` for the leftmost kept drawn panel, before the glide starts (niri's `offset_delta`). That replaces `rowAnchor`, `settling` and `replayScroll`. `followSize` is not replaced yet: a scroll glide asked just after a size glide must ride that glide's clock, and dropping it let the row drift 76 to 243 px from the panel's edge during a maximize.

Render: one `subscribe` pass per frame writes, for each slot, `translateX(screen(i))` (clamped for held), the clip at the held edge, `inert`/`pointer-events` from `drawnWhole`, and the dot bar's `left` values. `PanelHold`, the Workspace clip loop, `slotMover`'s row-relative pose and `drawEachFrame` go away; the per-slot WAAPI stays only for enter/exit poses.

Intents replace writers: `step(dir)`, `show(id, align)`, `drag(dx)` / `release()`, `resize(id, slots)`, `setWindow(px)`, `reorder/open/close`. Each is a pure `(model) => model`. The 13 `glideTo` call sites call one of these.

### What it removes

- `rowAnchor`, `settling()/setSettling`, `replayScroll`/`deferUntilRelease`/`replayDeferred`, `drawEachFrame`, `held[]/stuck[]/leftInset/rightInset/stripStart` as stored fields, `admitHolds`' overflow release, `settleKeeping`'s second commit, `capParkedRef`, `swapStepRef`, `REQUEST_WAIT_COMMITS`, both "a frame later" rAFs, the slide-duration settle timer, `useResizeSettled`'s role in the row.
- Not removed by step 3, and so listed with the steps that remove them: `followSize` (needed until a size change is a model glide, step 5) and the Workspace line that hands the driver the centering (`setMargin` was renamed `reorigin`, and the hold flip no longer moves it because the numbers give the same centering with the hold on and off).
- rowDots.ts entirely (`toTrack`, `toScroll`, `withParked`, `withHeld`), the `seen` conversion, `carry` mode, `stepAsked`.
- `PanelRow`'s second `leftOffsets`, `reservedWidth`, the `PanelHold` measuring effect.
- Four of the five "on screen" predicates.

### What it breaks, honestly

- **Resource unloading for parked panels.** Today parked = not in `ids` = not rendered. In the model, parked is derived from distance, so a panel the user never scrolls to is still never mounted (same effect), but a panel *just* outside the window is mounted within `overscan`. Memory for photo-heavy panels (app's `useNearView`/`useShownLately`) must be re-tuned; set `overscan = 0` to match today exactly.
- **Explicit hide vs park.** `revealOnScroll: 'never'` and `maxLivePanels` capacity parking become two different things: `hidden` (out of the list) and derived parking. `capacityReturn` levers need re-expressing as "which panels count toward capacity" rather than "which to park"; one session of policy work.
- **Public API.** `RowNumbers` (@public, `computeRowNumbers` already @deprecated), `usePanelDots`/`PanelDots`, `useWorkspaceRow`'s `scroller` element, `stepRow`, `PanelSizeBox` are exported (index.ts:90-96,215-216,234; 16 mentions in etc/*.api.md). Keep `RowNumbers` as an adapter built from the model for 0.2.x with `anchor/stuck/held` deprecated; `PanelDots` keeps its shape. `edgeHold: 'right' | 'both'` becomes a clamp to `[0, windowPx - w]`; if the app does not use them (not established), drop them in 0.3.
- **Hold semantics shift slightly.** Today the strip is inset by the held width and narrow panels never pass under the Workspace panel. With a clamp, every panel slides under it; stops start at `heldWidth`, so at rest nothing is under it. This matches the owner's "wide panels slide under"; confirm narrow panels may too during a glide.
- **Enter/exit side marks** (`anchoredEnter`, `enterSideById`, `exitRightIds`, `clearEnterSide` in usePanelManager) are the same disease in another file; the model gives the side for free (`screen(i) < 0` → from the left). Out of scope for the first seven steps; flagged.

### Migration (app works at every step)

1. `rowModel.ts` pure + property tests (section 5). No wiring. ~400 + 300 lines.
2. `computeRowNumbers` becomes an adapter over the model; the 40 existing row tests must still pass (assert the test count did not fall). Delete nothing yet.
3. `view` driver (built, with the first attempt corrected after an audit). rowScroller keeps its interface and stays the one owner of position. The view is two numbers that add: the scroll, which steps, dots and claims move, and the origin, the negative of the centering, which the Workspace still supplies. Each has its own glide on its own clock, so `reorigin(centering)` (the old `setMargin`, renamed) never touches a scroll glide, a fade or a bump, and `scrollLeft()` is the scroll alone. Merging the two into one glide was tried first and failed the audit: it turned a fade into a slide, delayed the end-of-row bump behind a centering, and retimed a scroll glide to the centering's length. Not removed, and so not part of what step 3 delivers: `followSize` (a scroll glide asked just after a size glide rides its clock; dropping it let the row drift 76 to 243 px from the panel's edge during a maximize), `settling` and its timers (they wait for step 5), and the Workspace line that hands the driver the centering (it was renamed, not deleted). The hold flip stops moving the margin because the numbers give the same centering with the hold on and off, so nothing asks the driver to re-center; a driver-level test pins that a flip mid-glide leaves the glide untouched.
4. One render pass in PanelRow: slot translate, held clamp, clip, fade, inert from `model(t)`. Delete `PanelHold`'s effect, the Workspace clip loop, `drawEachFrame`. Built as `rowDraw.ts`, called from `PanelRow`: it holds the held clamp, the cut and fade of a strip panel beside a held one, and inert, written from the row's numbers and the scroller's scroll. The grid's own cut is no longer written per frame: the grid's edges are fixed in the window, so it is a `clip-path` on a new `data-row-window` element around the strip, written once per commit, which ended the blank panels (the cut had been rewritten each frame from the strip's position and trailed a strip the compositor draws). `drawEachFrame` is gone: a listener subscribed with `sameFrame` makes the frame loop draw the strip, and a row with a held or stuck panel subscribes that way, so the clamp and the strip are one curve while a row with no hold stays on the compositor. Locking a panel at the left no longer slides the strip's panels a slot right and back: a slot is carried by the change of the left group's width at the commit. Not done, and so left for step 5: the slot translate itself is still each slot's own mover (enter, exit and slide poses), since moving it into the pass needs the list-change glides of step 5.
5. Intents: convert the 13 `glideTo` sites and 4 claims; the settle effect becomes `settle(model)` run once per model change; delete the timers listed above and `rowAnchor`. Started, not finished. Done: a mouse wheel's notches each step once (`NOTCH_GAP_MS`, in the gesture hook), the 20 tests the one-step change left failing are settled, and the resize release no longer waits a slide for the margin: `settling`, `setSettling`, `inputs`, `noteInput` and the settle timer are gone, and the release glides onto the nearest stop at once (the origin and the scroll are separate clocks since step 3, so the margin glide no longer shortens the scroll's range). Not done: the 13 `glideTo` sites and the 4 claims still write directly; `rowAnchor`, `swapStepRef`, `capParkedRef`, `REQUEST_WAIT_COMMITS`, the two later-frame rAFs, `settleKeeping`'s second commit, the seek timer, `replayScroll`/`deferUntilRelease`/`replayDeferred` remain, because each is the compensation for the swap that parks panels by fit. A row that swaps (`overflow: 'park'`) with wide panels still backs up on left presses and still brings a parked wide panel in whole (`test/row-gestures-chromium.test.ts`, the todo test): that ends with step 6, not with the intents.
6. Parked derived from distance; `settleKeeping` becomes a capacity rule on the list; one commit per change.
7. Dot bar: `usePanelDots` = scaled view; delete rowDots.ts mapping; app `dotOverflow` becomes a track-window clamp with hysteresis expressed in the model, no `prev`.

Sessions: steps 1-2 one; 3-4 two to three; 5 two; 6-7 two. Each step ends with the existing golden/mechanics tests green plus the property test.

### Risks

- rc7 spike velocity: 19 library commits in five days on these files; a parallel branch will conflict daily. Do it after the cut, or freeze these ten files.
- Step 4 touches the compositor path (strip WAAPI + per-slot WAAPI + clip). The blank-panel bug is undiagnosed; changing layers may move it rather than fix it. Keep a headless repro before step 4.
- Reduced motion, Safari WAAPI quirks and the test DOM without `animate` are already handled per writer; the single driver must carry all three (rowScroller already does).

## 4. Unsolved bugs and what the design does to each

| bug | source | removed / left / worse | why |
| --- | --- | --- | --- |
| Parked wide panel arrives whole when a swap parks every other panel | owner | **removed** | there is no swap: `x[i]` is fixed, only `view` moves one slot; a wide panel can only enter one slot per step |
| Oval leads the pointer by up to one dot in the first slot | owner | **removed** | oval left = `k*view`; a drag writes `view` directly; `withHeld`'s shift and `carry` are gone |
| Dot run shifts by whole dots near the +N chips | owner (app) | **removed if step 7 includes the app's run**, else left | the run is a clamp window over the track with hysteresis in the model; today it is a remembered `prev` offset |
| Clicking another panel can shrink wide panels | owner | **left** (policy) | this is `tuning.shrinkUnfocused` → `restAtPhone` on touch/blur (useProvidePanels.ts ~800-830); the model only removes the row *jump* that accompanies the shrink (width change compensates `view`). Needs an owner decision on the tuning |
| Blacked-out / blank panels while scrolling large panels | owner | **not established; likely reduced** | cause unknown; candidates are the three overlapping compositor animations (strip WAAPI, slot WAAPI, per-frame clip-path on large layers), the `visibility: hidden` exit path (PanelRowSlot.tsx:346), `useFramesAsleep`. The design leaves one transform per slot and a clip only at the held edge, shrinking the suspect list; needs a repro first. After step 4 `blank-trials.ts` finds no blank panel and no frame under 40 percent of the settled ink, but frames are not full ink: under load, in production and with wide panels some present at 0.76 to 0.97 (un-rasterised tiles; the `clipnone` control dips too), so "no frame under 0.97" does not hold |
| Off-screen loaded panels show no Hidden time | owner (app) | **removed with a small app follow-up** | the model has one `drawnWhole` predicate; today five disagree (section 2.4). The app's time source was not located (only `useShownLately`/`useNearView` found) |
| A step moving several slots; row sliding backward; row snapping to far left | owner list | **removed** | all are re-zeroing of the coordinate on park/hold/swap |
| Workspace panel re-animates into place when a wide panel leaves | owner list | **removed** | the hold is a clamp; no inset or margin changes |
| Dot bar shows a gap / disagrees with the Workspace panel | owner list | **removed** | dots and oval are the same numbers scaled |
| Oval drag stalls or drifts from the pointer | owner list | **removed** | one writer; no claim hand-off between drag and step |
| Panel width lost on reload | owner list (16fcff6 fixed one case) | **left**, surface smaller | persistence; `slots` per panel is the one stored width in the model, so there is one place to save and restore |
| #518 one resize pipeline | lib issue | **removed** | `w[i]` animates in the model on the shared clock; the size box reads it; no opt-in wrapper |
| #519 panels cross on the wrong layer | lib issue | **left**, surface smaller | z policy (`rowSlotZ`) is untouched; but panels no longer cross during a scroll at all, only during open/close/reorder |
| #522 resize: snap during live resize, glide once | lib issue | **removed** | `setWindow(px)` is one intent; the model decides snap-vs-glide once; no `holding()`, end-pad hold or clamp-undo observer |
| #340 / app #161 reload animation plays | lib + app | **left**, easier | initial `view` is set before first paint from the model; the slot enter poses are the remaining source |
| Maximize mis-lands after a scroll during the grow | inferred from panelMaximize.ts:85-88 reading the slot box at lift | **improved** | the shrink target should be `screen(i)` from the model at release, not the box read at lift |
| Enter/exit side marks go stale across commits | usePanelManager.ts:52-56, 246, 784-790 | **left in steps 1-7**; removable in a step 8 | side = sign of `screen(i)` |

## 5. The test that would have caught this class

A property test over random sequences, not a golden: generate 200–1,000 sequences of 20–60 operations from `{stepL, stepR, setWindow(w), open(slots), close(i), reorder(i,j), resize(i,slots), holdOn, holdOff, dragBy(dx), release}` and after every operation assert on the derived output:

1. **Stillness:** for every panel drawn before and after an operation that is not a step or drag, `|screen_after - screen_before| < 1`. (Catches: a hold flip moving the row, a park sliding it, a resize jumping the neighbour.)
2. **Whole slots:** every drawn panel narrower than the window is either wholly inside or wholly outside; a wide panel may be cut only at a window edge; the held panel is at 0.
3. **Dots agree:** the set of panels under the oval equals the set with `drawnWhole`; dots are in list order with no gaps and no overlaps except over the held slot.
4. **Reversibility:** `stepR` then `stepL` returns `view` to the same value when neither was clamped.
5. **Determinism:** deriving twice from the same model yields byte-equal output (kills render-time reads of animation state).

Run with `fast-check` (not in package.json today) or a seeded generator. Positive control: run it against an adapter over *today's* `computeRowNumbers` + `rowAnchor` and watch invariant 1 fail on the hold flip; that is the negative control that proves the test sees the bug. No existing test is property-based (40 row test files, `panel-row-golden.test.ts` is a snapshot).

## 6. Not established

- The actual cause of blank panels: read-only review, no repro run.
- The app's Hidden-time display path (which store it reads).
- Whether the app uses `edgeHold: 'right' | 'both'`.
- The 280/385 "motion commit" count is a keyword match on subjects, not a bug-by-bug attribution.
- niri's `scrolling.rs` was read to 100k of 209k characters; PaperWM's `ensureViewport` body was past the fetched range; the niri wiki "Layout" page returned its home page; react-window and Swiper are from memory, not fetched.

## Sources fetched

- https://raw.githubusercontent.com/YaLTeR/niri/main/src/layout/scrolling.rs
- https://raw.githubusercontent.com/paperwm/PaperWM/develop/tiling.js
- https://raw.githubusercontent.com/davidjerleke/embla-carousel/master/packages/embla-carousel/src/components/Engine.ts
- https://raw.githubusercontent.com/davidjerleke/embla-carousel/master/packages/embla-carousel/src/components/ScrollBody.ts
- https://raw.githubusercontent.com/davidjerleke/embla-carousel/master/packages/embla-carousel/src/components/Animations.ts
- https://naver.github.io/egjs-flicking/Options
- https://aerotwist.com/blog/flip-your-animations/
- Search results only (not read): https://github.com/paperwm/PaperWM, https://github.com/YaLTeR/niri/wiki/Layout (returned the wiki home page)
