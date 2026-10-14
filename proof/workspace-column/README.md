# Workspace column browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox> <outdir>

Three workspaces in a column at 1280x832 and 1280x1080, each with no inset and with a 32 px inset (the app's drag strip): cells, inert state, neighbour buttons (exactly 24 px), the name input above the headers, ArrowDown, a rename, Create new workspace at the top, no console warnings. Not part of the library gate.
