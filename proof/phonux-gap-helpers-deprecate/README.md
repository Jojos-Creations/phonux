# Size follows the slot: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

A workspace with `tuning.rowGap: 24` and a two-slot panel drawn two ways: the default frame, and a view that renders `PanelSizeBox`, `Panel` and `PanelFrame` with no `size`. Each size box, panel and frame must be as wide as its slot (2 phones + 24), not the 796 px the default gap gives. Not part of the library gate.
