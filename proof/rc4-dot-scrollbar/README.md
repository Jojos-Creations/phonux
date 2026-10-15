# Dot scrollbar: browser proof

    node build.mjs <phonux checkout> out.js
    PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

Six 390px panels in a 16px-gap strip, a scroller of `?w=` px (390, 600, 800) and a 1000px track, driven through
`usePanelDots`. Each window width asserts the oval's width, one dot per panel, a 390px panel's dot width, a click on
dot c centring panel c, and a 60px drag of the oval moving the row. Prints pass and fail per check; exits 1 on a fail.
