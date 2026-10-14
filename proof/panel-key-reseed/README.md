# Panel key reseed browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

A workspace kept in localStorage: five anonymous panels, three closed one at a time, then a page reload (the id counter restarts, as at a new launch) and six more panels. The new keys must not equal a restored key, and all eight keys must be unique. On main the first new panel takes a restored key. Not part of the library gate.
