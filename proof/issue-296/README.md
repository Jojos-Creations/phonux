# Off is the only edge mode (issue 296)

A stepping row (History and six one-slot panels, phone 412, gap 24, a 1500 px window) is built with `tuning.shrinkOutOfView` absent, `'off'`, `'visible'` and `'hidden'`.
At every stop the slots' left and width must equal the `'off'` row's, no slot may be faded, the neighbour the window edge cuts must be drawn at its full phone width, and
`'visible'` and `'hidden'` must each log one console error naming the value as removed (the others none). On main the same script fails for `'visible'` and `'hidden'`.

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

The bundle runs in development mode; `run.mjs` stubs `process` so the library's development-only warning is reachable in a browser page.
`output-chromium.txt` is the run against this branch: 15 passed, 0 failed.
