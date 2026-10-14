# Shrinking a wide panel keeps the panels that were in view

History, panels of the slots in `SLOTS` (default `1,1,3`, the last one wide), phone 412, gap 24, a 2240 px window, in every shrink mode.
The wide panel's right grabber is dragged one slot narrower twice (`usePanelResizing`: `setResizing`, `setDrawnWidth`, `setSlots`).
After each release every panel that was in view before must still be in view.

    node build.mjs <phonux checkout> out.js
    SLOTS=1,1,3 PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>
