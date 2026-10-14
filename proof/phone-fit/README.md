# Phone fit browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

The default mount (`AutoRoot`) under React StrictMode with `tuning.phoneFit: 'fit'`, rowGap 24 and a 96 px top inset, at 844x900, 1280x720, 1280x900, 1800x720, 1800x900, the minimum-wins windows 844x390 and 1280x650, a window dragged across the 3-slot breakpoint, and `phoneFit: 'off'`. Not part of the library gate.
