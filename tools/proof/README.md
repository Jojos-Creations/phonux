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

`frame-corner-ring-probe.mjs` (with `frame-corner-entry.tsx.txt`) renders `PanelFrame` around an opaque full-bleed child in headless WebKit and Chromium at deviceScaleFactor 2, dark and light, and scores 17 points on each of the four corner arcs, at the theme radius and at 40 px written onto the mounted frame, against the same frame rendered empty. It writes the corner crops and a 2 x 2 contact sheet per engine and scheme, prints one JSON line per arc, and exits 0 only when every sample is ring-colored (1: a gap in the ring, 2: it could not prove anything).

    PLAYWRIGHT_ENTRY=<path>/playwright-core/index.mjs WEBKIT_BIN=<pw_run.sh> CHROMIUM_BIN=<headless shell> \
      node tools/proof/frame-corner-ring-probe.mjs <libDir> [outDir]

Run it with `<libDir>` as a checkout of main for the negative control: 96 of 544 samples are ring-colored there and the exit status is 1.
