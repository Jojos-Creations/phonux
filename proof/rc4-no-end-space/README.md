Headless proof for the stepping row's end: after wheel steps to the end, the last panel's right edge is one row gap from the window edge.

    node build.mjs <phonux checkout> out.js
    WIDTH=2240 PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js chromium

The row is History, two phones, a five-slot panel and a phone, at WIDTH wide. Before the fix the blank room right of the last panel was 909 px beyond the gap at 2240; after it, 0.
