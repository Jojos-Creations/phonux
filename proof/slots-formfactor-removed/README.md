# Slots and formFactor removal browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

A file saved before slots (a top-level `formFactor`, and `overrides.formFactor` on a template panel) loads as slot counts and draws at those widths, an old desktop override is held to `maxSlots`, a view sets its own `slots` through `handle.configure`, a `formFactor` key is `invalid-settings`, and a resize is saved as `slots` with no `formFactor` anywhere. Not part of the library gate.
