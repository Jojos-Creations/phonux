# useWorkspace: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

A History-like root view calls `useWorkspace()` and, from buttons, hides, shows and closes other panels by key and adds one with `addPanel`. The view's workspace has `panels` with `addPanel` and no `dispose`. Not part of the library gate.
