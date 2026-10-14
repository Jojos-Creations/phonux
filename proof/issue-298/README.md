# Grab handle in the header browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

One bare panel in the default frame. The grab handle is the single `[data-panel-grab-bar]`, inside the header, left of the title and within the header's height, and it is still a focusable button named for the panel. Not part of the library gate.
