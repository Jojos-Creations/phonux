# Header theme browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

The default mount with a panel drawing `PanelHeaderRow` and `PanelFrame`, in a light and in a dark window: the header text must differ from the pill's background, be dark in the light window and white in the dark one. On main the light window draws white on white. Not part of the library gate.
