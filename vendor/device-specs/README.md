# device-specs (vendored subset)

A small, hand-curated set of phone model -> CSS-pixel viewport (width x
height, portrait) pairs, feeding `PHONE_MODELS` in `phoneModels.ts`
behind the Settings dropdown.

Six entries (`iphone8`, `iphonex`, `iphonexr`, `iphone11`,
`samsunggalaxys10`, `googlepixel3`) are copied verbatim from
[DevExpress/device-specs' `viewport-sizes.json`](https://github.com/DevExpress/device-specs/blob/master/viewport-sizes.json)
(MIT-licensed, retrieved 2026-09-13) -- that schema's `landscapeWidth` is
the portrait *height* (a phone's landscape width equals its portrait
height). That file has nothing newer than iPhone 11 / Pixel 3 / Galaxy S10
(confirmed by inspection, not assumed, 2026-09-13) -- every other entry
here is supplemented from each device's own publicly documented CSS
viewport size, not from that file.

This is a static, hand-maintained snapshot that will drift as new phones
ship -- not auto-updated. Edit by hand when a common device is missing.
