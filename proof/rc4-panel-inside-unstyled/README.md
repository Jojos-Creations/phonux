# Panel inside unstyled: browser proof

    node build.mjs <phonux checkout> out.js
    MODE=plain|scroll PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

One default panel under StrictMode. `plain` prints the view's content offset from the frame's outer box. `scroll` puts a
Box that spreads `panelFrameScrollSx` around a 2000px child and prints its padding, gutter, scrollbar width and the
content's offset inside it.

Measured in Chromium, 844x900:

| case | content offset in frame | scroller padding | gutter | scrollbar |
| --- | --- | --- | --- | --- |
| main (86e1212), plain | 13, 13 | none | none | none |
| this change, plain | 1, 1 | none | none | none |
| main, scroll | 13, 13 (frame) then 12, 12 in scroller | 12 / 4 / 12 / 12 | stable | 8 px |
| this change, scroll | 1, 1 (frame) then 12, 12 in scroller | 12 / 4 / 12 / 12 | stable | 8 px |

The frame no longer adds 12px; a scroller that spreads `panelFrameScrollSx` gets the same inset and scrollbar main gives it.
