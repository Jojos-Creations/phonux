# Left drag keeps every panel in place: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

Five panels each host an iframe that counts its loads. A real mouse drag moves the fourth panel two places to the left and drops it. The run checks that no slot node was added or removed in the DOM, every slot is the same element afterwards, the panels' DOM order never changed, no iframe reloaded, and no panel the drag crossed left the span between its start and end position. Not part of the library gate.

## Tab order (tab-order.mjs)

`node tab-order.mjs out.js chromium|webkit|firefox` drags the fourth panel left, then presses Tab and
compares the panels visited with the order they are drawn in (WCAG 2.4.3 Focus Order). On main it
passes; on the first fix head it fails (screen root,2,5,3,4,6; Tab 2,3,4,5,6).
