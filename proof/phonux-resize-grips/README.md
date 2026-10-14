# Resize grips: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

A workspace with `tuning.rowGap: 24` and one default-frame panel with `maxSlots` 4. Real mouse drags on both grips: the width follows the pointer, the release settles on the nearest slot, the left grip keeps the right edge still, Arrow keys step one slot, and under Reduce Motion the release snaps. Not part of the library gate.
