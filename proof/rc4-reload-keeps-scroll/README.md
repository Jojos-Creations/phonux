Headless proof for the rest a reload restores: a stepping row, [1,1,1,64,1] panels (64 is every slot, the desktop width) at 2240 wide, is stepped to a late stop, then reloaded. The rest is saved in localStorage through `WorkspaceStorage`.

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js chromium

`run.mjs` samples the row's `scrollLeft` and every slot's left on each animation frame from the first frame of the reload. Frames before the restore has put the panels in the row show History alone; every frame that shows the row's panels must sit on the saved stop, with no frame at 0 or at the end of the strip.
