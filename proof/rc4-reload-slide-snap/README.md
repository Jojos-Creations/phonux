Headless proof for the reload slide: panels present at mount must not slide from the preferred phone size to the fitted one.

    node build.mjs <phonux checkout> out.js
    WINDOW_HEIGHT=500 (a window too short for the preferred size) also works.
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js chromium|webkit|firefox

`run.mjs` samples every panel slot each animation frame, on first load and on reload, then adds a panel to show a real slide is seen.
