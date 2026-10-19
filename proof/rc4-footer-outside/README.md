# rc4-footer-outside proof

A 390 by 700 PanelFrame in a relative slot of the same size, with and without a footer, in Chromium.

    node build.mjs <phonux checkout> out.js
    node run.mjs out.js chromium

Checks at widths 390, 600 and 800: the frame keeps its 700px height with and without a footer, the footer sits below the frame edge (4px, the header gap), it is absolutely positioned and outside the frame, and no page errors. Last run: 18 pass, 0 fail.
