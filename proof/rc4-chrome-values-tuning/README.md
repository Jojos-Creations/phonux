# Chrome values to tuning.chrome: browser proof

    node build.mjs <phonux checkout> out.js
    MODE=header|grab PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node run.mjs out.js <chromium|webkit|firefox>

Two bundles, one of the PR 317 head (before, the chrome values are literals) and one of this branch (after, read from
`tuning.chrome`'s defaults). Both measure the same in Chromium: content 1px in the frame, header text 14px, header pill 23px
above the frame and 32px tall, footer padding 12px across and 12px down, grab bar 24px tall with a 32 x 4 pill.
