# Panel inside unstyled: browser proof

    node build.mjs <phonux checkout> out.js
    MODE=plain|scroll PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

One default panel under StrictMode. `plain` prints the view's content offset from the frame's outer box. `scroll` puts a
Box scroller with no padding, gutter or scrollbar rule of its own around a 2000px child, and prints its padding, gutter,
scrollbar width and the content's offset inside it. The library exports no scroller recipe (issue 309), so the scroller
carries no inset: a view that wants one writes it in its own sx.

Measured in Chromium, 844x900, on this change:

| case | content offset in frame | scroller padding | gutter | scrollbar |
| --- | --- | --- | --- | --- |
| plain | 1, 1 | none | none | none |
| scroll | 1, 1 (frame) then 0, 0 in scroller | 0 on all sides | auto | 0 px |

The frame adds 1px of its own border and no content inset. Before this change, the frame added 12px and a scroller that
spread the removed recipe got a 12px inset with an 8px classic scrollbar.
