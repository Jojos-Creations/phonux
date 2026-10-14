# Resize grips: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

A workspace with `tuning.rowGap: 24` and one panel with `maxSlots` 4 that draws its own Panel with the grips as its overlay (the default frame draws none). Real mouse drags on both grips: the width follows the pointer, the release settles on the nearest slot, the left grip keeps the right edge still, Arrow keys step one slot, and under Reduce Motion the release snaps. Not part of the library gate.
