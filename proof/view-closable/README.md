# View-set closable browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

A view locks its own panel with `handle.configure({ closable: false })`: `close()` is then refused with `not-closable`, `closable: true` is refused as `not-view-settable`, the lock is saved and survives a reload, and `closable: null` unlocks it. Not part of the library gate.
