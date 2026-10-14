# Show partial (Off) probe

`probe.mjs` opens the library's stepping row (the harness in `tools/proof/step-entry.tsx.txt`) in Off, Shrink (`visible`) and Hide (`hidden`),
steps one stop at a time with a real wheel and prints each panel's rect, opacity filter and `inert` per stop. For Off it prints `OK` or `FAIL`:
every panel opaque and every panel the window edge cuts reachable (not inert).

    node proof/show-partial/probe.mjs . chromium 1100 1,2,1,1,1 proof/show-partial   # also firefox, webkit
    # playwright elsewhere: PLAYWRIGHT_DIR=/path/to/node_modules

`output-chromium.jsonl` is the Chromium run. In Off at the first stop the 796 px panel after the two phones is drawn at its full width, cut by the right edge
(136 px showing); Shrink and Hide fade it out.
