# Step-end probe (plan #214, Firefox stepping scroll)

One file, `step-end-probe.mjs`. It builds a stepping Shrink row of the library (History plus panels of the given slots) with esbuild,
loads it in the chosen engine at 1800 wide, sends wheel deltaX +300 every 900 ms nine times (the row's end and past it), then -300 nine
times, and prints one JSON line per step.

    cd <phonux checkout>            # needs node_modules (esbuild, react, react-dom) and `playwright` with the engine installed
    node tools/proof/step-end-probe.mjs . firefox 1,4 1800 > ff-1-4.jsonl
    node tools/proof/step-end-probe.mjs . firefox 1,2 1800 > ff-1-2.jsonl
    node tools/proof/step-end-probe.mjs . webkit  1,4 1800 > wk-1-4.jsonl
    # playwright elsewhere: PLAYWRIGHT_DIR=/path/to/node_modules   a separate React: REACT_DIR=/path/with/node_modules/react

Each line: `scrollLeft`, `scrollWidth`, `clientWidth`, `browserMax` (scrollWidth - clientWidth, the browser's own range), `paddingRight`,
`lib` (stops, atStop, endPad, maxScroll as the library computed it, drawnWidths), the strip and end-pad rects, the visible panels' rects and
`events` (every scroll event since the last line). What to read: is `browserMax` smaller than the last stop, or than `lib.maxScroll`, by
`paddingRight`? Does `scrollLeft` ever differ from a stop? Do `events` show a scroll the library did not write?
Chromium on this checkout: `browserMax` follows the drawn widths (1218, 1624, 812 at the three stops of [1,4]) and every step lands on a stop.

# Frame corner ring probe

`frame-corner-ring-probe.mjs` (with `frame-corner-entry.tsx.txt`) renders `PanelFrame` around an opaque full-bleed child in headless WebKit and Chromium at deviceScaleFactor 2, dark and light, and scores 17 points on each of the four corner arcs, at the theme radius and at 40 px written onto the mounted frame, against the same frame rendered empty. It writes the corner crops and a 2 x 2 contact sheet per engine and scheme, prints one JSON line per arc, and exits 0 only when every sample is ring-coloured (1: a gap in the ring, 2: it could not prove anything).

    PLAYWRIGHT_ENTRY=<path>/playwright-core/index.mjs WEBKIT_BIN=<pw_run.sh> CHROMIUM_BIN=<headless shell> \
      node tools/proof/frame-corner-ring-probe.mjs <libDir> [outDir]

Run it with `<libDir>` as a checkout of main for the negative control: 96 of 544 samples are ring-coloured there and the exit status is 1.

# Row render baseline

`row-render-baseline.ts` (with `row-render-entry.tsx.txt`) drives the real `Workspace` and `PanelRow` in headless Chromium through a gliding re-centering, a hold flip with each of left, right and both (on the first panel, which the position model reads, and on a middle one), a fade jump, a wide panel changing size alone and while gliding, maximize and minimize, a resize drag, and a 40-panel row parked and returned. It records the strip's drawn transform, opacity and clip, the scroll, and every slot's rect, opacity and scale on each animation frame, takes screenshots, and checks the paint against a magenta page background: at rest every sampled pixel must be the colour of the panel on top there, and a mid-glide frame with a run of magenta across the row is a hole. The virtual-clock tests cannot see any of this.

    node --import tsx tools/proof/row-render-baseline.ts --out <dir> --write <baseline.json>     # record
    node --import tsx tools/proof/row-render-baseline.ts --diff a.json,b.json --into a.json        # noise floor of one tree against itself
    node --import tsx tools/proof/row-render-baseline.ts --out <dir> --compare <baseline.json>   # after a change

Time is real, so every action (step, resize, a hold or size ask) restarts its own 16 ms grid and a compare is per action; `--into` stores each scenario's floor in the baseline and `--compare` flags a drift only past twice it, and a different resting strip, offset or hold at the end of a scenario whatever the floor. Trust a compare for those final values only: the per-frame drift is coarse and misses a constant 60 px shift in most scenarios, and its hole check looks at one row in one scenario, so it is not the blank gate (`blank-trials.ts` is). Each ask that goes through a React commit starts its grid on the first frame that draws something, since the commit lands on a different frame each run. It exits 1 when a scenario did not run, a blank panel or hole was found, or a compare drifted. The browser comes from `test/support/chromium.ts`, which says which one ran. `tools/proof/baseline/` holds the recording of the source at d127d32, three runs with the noise floors from all three. It replaces the one taken at 240fd27 because `hold-flip-first-left` moves its slots on a different path at the lock, by design: the strip's start moves under a carried slot, which then runs its own move (worst 413 px against a floor of 94 at the lock); its final strip, offset and hold are the same. Read the screenshots: a number does not see a blank panel.
