# handle.move(by) browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

Four bare panels in the default frame. A real mouse drag of the first panel's grab bar across two neighbours reorders it in one release; `handle.move(-3)` and `handle.move(9)` each answer one result and clamp at the ends. Not part of the library gate.
