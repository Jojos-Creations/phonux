# Panel inside unstyled: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

One default panel under StrictMode. Prints the view's content offset from the frame's outer box.
Measured in Chromium: before (origin/main, 86e1212) the content sits at 13px, 13px (1px edge plus the 12px
inset the frame applied); after this change at 1px, 1px (the edge only, the view owns its padding).
