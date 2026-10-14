# Panel id is the key: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

Three panels of a multiple template: each view's `panel.id` equals its `handle.id` (`web~N`), `panelList` and `useActivePanel` report keys, and `PanelsAPI` verbs given a key reach the panel. Not part of the library gate.
