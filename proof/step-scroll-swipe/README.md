# Swipe proof

One swipe is one stop. A trackpad swipe's wheel deltas ramp up, peak and fade; the row used to step again on every rising event.

`swipe-probe.mjs` builds the library's stepping Shrink row (History plus panels of the given slots), sends ramp-peak-fade swipes
(16 ms apart) forward and back, and checks each moves the row exactly one stop (none at the ends). It exits 1 on a failure.

    cd <phonux checkout>            # needs node_modules and `playwright` with the engine installed
    node proof/step-scroll-swipe/swipe-probe.mjs . webkit   1,1,1,64 1800 24
    node proof/step-scroll-swipe/swipe-probe.mjs . firefox  1,1,1,64 1800 24
    node proof/step-scroll-swipe/swipe-probe.mjs . chromium 1,1,1,64 1800 24
    # playwright elsewhere: PLAYWRIGHT_DIR=/path/to/node_modules

Last line `PASS: every swipe moved exactly one stop`. Each JSON line shows `drawnWidths`: the last panel goes 390, 804, 1218, 1632 (1, 2, 3, 4 slots).
`swipe-trace.mjs` is the same stream through the phonux-app web build (see its header).
