# phonux

A phone-shaped view host for React: write each view as a component, give phonux a template for it, and it lays the panels
out in a row of phone-sized columns that steps one phone width at a time, each panel with a header, a width control and a grab
bar (drag sideways to reorder; a touch never drags it). A view never touches `localStorage` or anything else
app-internal (see `DESIGN.md` in this folder for why).

## Install

```sh
npm install phonux
npm install react react-dom @mui/material @emotion/react @emotion/styled motion@13
```

phonux asks for these peers: `react` and `react-dom` 19.2.8 or newer, `@mui/material` 9.3.1 or newer, `@emotion/react` 11.14 or newer,
`@emotion/styled` 11.14.1 or newer, and `motion` 13.3 or newer in major 13. Write `motion@13`: the plain name installs motion 14, which is
outside that range, so npm marks the tree invalid and every later `npm install` and `npm ci` in the app stops with `ERESOLVE`. The two
lines above install, in a new project, react 19.3.1, `@mui/material` 9.6.0, `@emotion/react` 11.14.0, `@emotion/styled` 11.14.1 and
`motion` 13.5.1, and `npm ls` then reports no problem. `jsdom` 26 is an optional peer, for `phonux/testing/row`.

phonux has its own dependencies (`@dnd-kit/core`, `embla-carousel`, `qrcode-generator`, `wheel-gestures` and `cross-spawn`); npm installs them
for you. The package also ships `DESIGN.md`, which explains the design decisions behind the API, and `THIRD_PARTY_NOTICES.md`. The change
history, and how to move from 0.1, is in [CHANGELOG.md](https://github.com/Jojos-Creations/phonux/blob/main/CHANGELOG.md).

## Testing main without a publish

A push to `release` (or a manual run of the Dist branch workflow) force-pushes the built package to the `dist` branch, a test channel and not a
release. An app that wants to try a build before a publish depends on `github:Jojos-Creations/phonux#dist`. The package version on that branch
is the source version, so the commit SHA in the app's lockfile, not the version, says which build it is, and the branch holds whatever was
built last, under the license of that source. A shipped app never depends on `dist`. The repository is public, so installing from it needs no
credential.

## Quickstart

<!-- quickstart:start -->
```tsx
import { createWorkspace, definePanel } from 'phonux';

function Notes() {
  return <p>Hello from a phone-shaped panel.</p>;
}

const notes = definePanel({ id: 'notes', view: Notes, settings: { title: 'Notes' } });

const workspace = createWorkspace({ templates: [notes] });
workspace.addPanel('notes');
```
<!-- quickstart:end -->

That is the whole app: `createWorkspace` renders itself into a full-window element, so there is no component to mount, no
host to build and no width to track. A template takes four optional fields beyond `view`: `footer`, a component drawn at the
bottom of every panel made from it (it gets the same props as `view`, and scrolls above it), `touch: true`, which makes a mouse
drag in the panel in use scroll its content as a finger does on a phone (`touch: 'content'` keeps the header and footer
to the mouse; see `DESIGN.md`, "A touch template"), `verticalDrag: true`, which lets a person drag the grab bar down to
close the panel (off by default, so the grab bar only reorders), and `api`, the
panel API level the template was written against (left out, it is the newest). A view returns bare content and phonux draws the panel around it (title bar, grab bar,
drag sideways to reorder), and after the person closes a panel the workspace shows a toast whose Undo puts it back where it was, at the same size and with its state. Nothing is saved between launches until you pass a `storage` option. With `storage`, the panels come back at the next launch, and so does the stop the row rests on once you have moved it: the row reopens at that stop with no visible scroll.

Pass the app's own values as options (`device`, `snapshots`, `labels`, `topInset`, `panels`; a view reads `snapshots` and `labels` with a fallback, because the first frame holds only what you passed), a `wrap`
component for the app's providers (StrictMode, `MotionConfig` and contexts go in it), a `theme: (mode) => PhonuxTheme` for its own theme (the mount draws it with one baseline; the `mode` is the window's color scheme; each field is also a CSS custom property, such as `--phonux-primary`, that a stylesheet rule overrides), and `workspace.update(...)` to give a running workspace new values (see `DESIGN.md`,
"Workspace options, wrap and update"). A title-bar button is a setting too: `headerButtons: { more: { label: 'More', onClick } }`
draws the label as the button's text.

A view unmounts when its panel closes, so audio, a web view or a socket started inside a view stops with it. Start those in the `wrap` component instead, which stays mounted for the workspace's life, and let the panel render controls for them (see `DESIGN.md`, "A parked view unmounts").

## The row

The row is a strip of slots one phone width apart; a panel is a whole number of slots wide. The row steps one phone width per
scroll step and rests with its whole slots centered in the window, at the ends too; a sideways wheel or Shift+wheel anywhere
on the row steps it (Option held gives the gesture to the content), a vertical wheel goes to the content, and ArrowLeft and
ArrowRight on the page step it (`stepRow(event, direction)` gives a host's own chord the same answer). A row wider than the
window scrolls, and no panel is cut off at a stop. Motion follows one rule set: a new panel grows from its center and a closing
one shrinks into its center, on one in-out clock, and a one-panel-wide panel also shrinks as it scrolls out past an edge and grows
as it arrives (`DESIGN.md`, "Motion").

Where a new panel lands is the template's `placeOnAdd` (default: the far right, the leftmost panel in view leaving when there is
no room) or the caller's `addPanel(template, { place })` function, which picks the slot among the panels in view, what the
panel there does (shift left, shift right or close) and the entrance. `usePanelDots` gives a host the dots and the oval of a
dot bar in place of a scrollbar; `usePanelMaximize` and `toggleMaximize` grow a panel to fill the window;
`whenAccepted`, `whenPanel`, `showPanels` and `whenColumnReady` wait on the row instead of a timer; `rowDom.ts` exports the
`data-*` attribute names the library draws; `useRowFrameBand`, `PANEL_BAR_HEIGHT_PX`, `PANEL_FOOTER_ROOM_PX` and
`rowFootReserve` give a host the numbers to lay its page out around the row. Each has a section in `DESIGN.md`.

## Several workspaces

A column of workspaces is one call per workspace, in the same style as the quickstart:

```ts
import { createWorkspaceColumn, definePanel } from 'phonux';

const notes = definePanel({ id: 'notes', view: NotesView });
const column = createWorkspaceColumn({ templates: [notes] });
column.addWorkspace().addPanel('notes'); // "Space 1"
column.addWorkspace({ name: 'Reading' }); // or give it a name
column.removeWorkspace(0); // takes it out and disposes it; false for the last one
```

The column renders itself. A button at the top and bottom center names the neighbor and moves there, `column.step('up' | 'down')`
moves by one (bind a key to it; the column binds none), and where there is none it reads "New space" and calls
`addWorkspace`. Each workspace has an input above its panels for its name. `storage` keeps the list, the names and the current
workspace; the column has one content (`root`, `templates`, `defaults`, `order`), `addWorkspace` takes only `id`, `name` and `index`, and a
workspace's panels are kept by `storage.workspace(id)` (return `undefined` for none). Give the workspace you already have its old key with `addWorkspace({ id })`. An app that draws its own rows passes
`mount: false` and renders `<WorkspaceColumn column={column}>{(workspace) => ...}</WorkspaceColumn>`.

## Building your own flow

The default start is built on the components it exports, and they stay public. This is the same row written out by hand: create
the workspace with `mount: false`, then render the row inside `PhonuxThemeProvider` with the theme the app wants.

<!-- advanced:start -->
```tsx
import * as React from 'react';
import { DEFAULT_PHONE_SIZE, HostProvider, PanelRow, Workspace, usePhoneFit, useProvidePanels, type WorkspaceHandle } from 'phonux';

export function Row({ workspace }: { workspace: WorkspaceHandle }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current!;
    const read = () => setMeasuredWidth(el.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The fit hands back the width and height it settled on, so the row's place, capacity and phone size change in one glide.
  const phone = usePhoneFit(ref, measuredWidth, DEFAULT_PHONE_SIZE, workspace.tuning);
  const provided = useProvidePanels({ workspace, phoneWidth: phone.width, containerWidth: phone.containerWidth, overflowContainerRef: ref });
  return (
    <HostProvider host={{ panels: provided }}>
      <Workspace
        overflowContainerRef={ref}
        rowRef={rowRef}
        containerWidth={phone.containerWidth}
        phoneWidth={phone.width}
        phoneHeight={phone.height}
        heightBudget={phone.heightBudget}
        fixedColumnCount={provided.fixedViewCount}
        liveWidths={provided.liveWidths}
        rowScroll={provided.rowScroll}
        rowNumbers={provided.rowNumbers}
        workspace={workspace}
      >
        <PanelRow
          entries={provided.entries}
          rootId={workspace.rootId}
          closingIds={provided.closingIds}
          enteringViaAnchorIds={provided.enteringViaAnchorIds}
          exitRightIds={provided.exitRightIds}
          enterSideById={provided.enterSideById}
          maxLiveWidth={provided.maxLiveWidth}
          rowNumbers={provided.rowNumbers}
          workspace={workspace}
        />
      </Workspace>
    </HostProvider>
  );
}
```
<!-- advanced:end -->

The two layers draw the same DOM; the advanced one exists for flows the options do not reach, not as a second way to start.

## Panel sizing

A panel is a whole number of slots wide: one slot is the phone width, and each added slot adds a phone width plus the row gap. Set the count with `slots` (and cap it with `maxSlots`); both are whole numbers from 1 to 64, the most slots any panel can have; a person can change it by dragging, and a view can change it with `setSlots`. A panel is drawn at no more slots than fit the window, and its chosen count comes back when the window grows. A panel is the same height whatever its slot count. See `DESIGN.md` "Slot sizing".

## Panel chrome

`useActivePanel()` returns the active panel's id and a setter (a press or focus anywhere inside a panel makes it active);
`usePanelActive()` and `usePanelDragging()` report one panel. A host that runs its own drag calls the setter from `usePanelSetDragging()` (`true` at the start, `false` at the end), so it never writes the attribute itself. `Panel` writes the same facts on its root box as
`data-panel-active` and `data-panel-dragging`, and marks its header, grab bar and footer with `data-panel-chrome-part`
(`header`, `grab-bar` or `footer`), so a host can style from them. The names are exported as `ACTIVE_ATTRIBUTE`,
`DRAGGING_ATTRIBUTE` and `CHROME_ATTRIBUTE`, and the part values as `CHROME_PARTS`, so a host imports them and repeats no string. `tuning.chrome` with `mode: 'hover-or-active'` fades
those parts out for a panel nobody is using, along `fadeEase` (see DESIGN.md, "Panel chrome").

A stepping row shows the neighbor at the window edge cut off, at its full size. A resize grabber calls the setter from `usePanelResizing()` so no other
panel changes size under it (see DESIGN.md, "Whole panels only"). The setter's third item, `setDrawnWidth(px, pin?)`, draws that
panel `px` wide at once, so the grabber follows the pointer frame by frame (`pin: 'end'` keeps the right edge still for a grabber on the left);
end a drag with `setSlots(nearest)`, `setDrawnWidth(null)` and `setResizing(false)`, in that order.

## Sticky panels

A panel with `sticky: 'start'` or `'end'` takes its slots at that end of the row and stays there while the rest of the row scrolls:
a navigation panel on the left, a player on the right. It takes its slots whether or not the row would overflow, and no panel is cut off.

<!-- sticky:start -->
```tsx
import { createWorkspace, definePanel } from 'phonux';

const library = definePanel({ id: 'library', view: LibraryView, settings: { title: 'Library', sticky: 'start' } });
const player = definePanel({ id: 'player', view: PlayerView, settings: { title: 'Player', sticky: 'end', stickyRank: 1 } });

const workspace = createWorkspace({ templates: [library, player] });
workspace.addPanel('library');
workspace.addPanel('player');
```
<!-- sticky:end -->

When the window is too narrow for the sticky panels and the `tuning.minScrollSlots` the scrolling row keeps, the sticky panel with the
lowest `stickyRank` goes back into the scrolling row (of equal rank, the later one first) and is sticky again when room returns. A window
one slot wide has no sticky panels. `edgeHold` is the old name of `sticky` and is read as it.

## Side by side

A column made with `sideBySide: true` shows several workspaces at once when the window has room, each with its own row, in whole slots of
one phone and one gap; a narrow window shows fewer, and a wide one restores them. The divider between two spaces is a slider (arrow keys,
Home, End, double click to even the split).

<!-- side-by-side:start -->
```tsx
import { createWorkspaceColumn, definePanel } from 'phonux';

const notes = definePanel({ id: 'notes', view: NotesView });
const column = createWorkspaceColumn({ templates: [notes], sideBySide: true });
column.addWorkspace({ name: 'Research' }).addPanel('notes');
column.addWorkspace({ name: 'Trip food' }).addPanel('notes');
const shown = column.showSide(1); // the second space, next to the current one
if (shown.ok) column.setSplit([2, 2]); // two row slots for each
```
<!-- side-by-side:end -->

`column.shown` lists what is drawn, `showSide`, `hideSide` and `setSplit` answer `{ ok: true }` or `{ ok: false, code, message }` and never
throw, and `focusSide('left' | 'right')` picks the side `step` acts on. `homeWorkspace: id` keeps one workspace permanently first.

## Sharing and trust

`ShareSheet`, `OfferCard`, `SharedList`, `TrustScreen` and `QrCode` are components that draw and report taps; the app keeps the people,
the codes, the checked state and the network. Each action is drawn only when its callback is passed. The default words state rules only
the app can keep, such as how long an invite waits, so an app whose rules differ passes its own `labels`.

<!-- share:start -->
```tsx
import { QrCode, ShareSheet, TrustScreen, type TrustExchanges } from 'phonux';

export function ShareSpace({ link, trust }: { link: string; trust: TrustExchanges }) {
  return (
    <>
      <ShareSheet
        item={{ kind: 'space', name: 'Trip to Lisbon' }}
        qr={<QrCode value={link} label="Link to this space" />}
        members={[
          { id: 'dana', name: 'Dana', role: 'owner', safety: { state: 'unchecked', code: '19896 56652 89711 42431 13353 29651 69207 07134 80072 66512 41361 36167' } },
          { id: 'me', name: 'Me', role: 'edit', you: true },
        ]}
        people={[{ id: 'sam', name: 'Sam' }]}
        onSend={(id) => console.log('send to', id)}
        onCopyLink={() => navigator.clipboard.writeText(link)}
        onSafetyCodeOpen={(id) => console.log('show the safety code of', id)}
        onSafetyCodeMatch={(id) => console.log('checked', id)}
      />
      <TrustScreen trust={trust} onDone={() => console.log('done')} />
    </>
  );
}
```
<!-- share:end -->

`QrCode` holds the UTF-8 bytes of its `value`, at most 2331 of them; a longer value draws an empty tile marked `data-phonux-qr-error="too-long"`
instead of throwing. `OfferCard` shows one incoming offer (`from`, `file`, `expiresAt`, and `onAccept`, `onNotNow`, `onDecline` and `onReport`
for its buttons), and `SharedList` lists what the person shares and what is shared with them (`byYou`, `withYou`, with `onRenew`,
`onCopyLink`, `onShowQr`, `onChangeEnd` and `onStopSharing`). The people on a `ShareSheet` can carry a `safety` state: `unchecked` draws Check,
`changed` draws Review, `checked` draws a shield, and that includes the owner's row. `TrustScreen` takes a `TrustExchanges` object from the app
(`invite`, `join`, `pending` and `failureOf`) and runs the exchange from both sides; its note under the code says the hours the exchange
really has left. `DESIGN.md` has "One share view".

## Testing a view

`phonux/testing` exports `createFakeHost()`: a recording fake of every host
API, so a view can be rendered with no real host behind it.

```tsx
import { render } from '@testing-library/react';
import { HostProvider } from 'phonux';
import { createFakeHost } from 'phonux/testing';
import { Notes } from './Notes';

render(
  <HostProvider host={createFakeHost()}>
    <Notes />
  </HostProvider>,
);
```

`createFakeHost(overrides)` replaces whole members of one API (e.g.
`{ panels: { panelList: [...] } }`); every call any fake receives is
recorded, in order, on the returned host's `.calls`.

To test a view inside a real row, `phonux/testing/row` renders a workspace with the real engine in a jsdom window and
steps a virtual frame clock, so a drag or a resize needs no wait on real time. Import it before `react` (it installs the
jsdom window and the clock, and `jsdom` is an optional peer dependency):

```ts
import { renderWorkspace } from 'phonux/testing/row';
import { createWorkspace, definePanel } from 'phonux';

const workspace = createWorkspace({ templates: [definePanel({ id: 'notes', view: Notes, verticalDrag: true })] });
workspace.addPanel('notes');
const row = await renderWorkspace(workspace, { width: 1200 });
await row.drag(row.panel('notes')!.grabBar!, { dx: 0, dy: 120 }); // closes the panel
await row.setWidth(600);
await row.dispose();
```

`row.panel(id)` returns the drawn `root`, `header`, `grabBar` and `footer` of the panel with that key.

A host whose tests keep their own jsdom window (and real time) calls `stubRowDom(window)` from `phonux/testing` once,
before it mounts a `Workspace`. It fills in what the row reads that jsdom lacks: `matchMedia`, `IntersectionObserver`,
`ResizeObserver`, `CSS.escape`, a computed margin of `0px`, and the offsets of the row's window and slot markers, so the
row has its stops and an arrow key or a scroll request steps it. jsdom draws nothing, so no element's box follows the row.

See `DESIGN.md` in this folder for the reasoning behind the API shape, the
panel-view registry, and what stays out of a view's reach on purpose.

## Build for phones, tablets and desktop

`npx phonux build` builds your app for the devices you pick from a list: Android phone, Android tablet, iPhone, iPad and
desktop. Phones and tablets are wrapped with [Capacitor](https://capacitorjs.com), so the app needs `@capacitor/core`,
`@capacitor/cli`, `@capacitor/android`, `@capacitor/ios` and a `capacitor.config.ts` whose `webDir` is your web build.
The first build adds the native projects; commit them.

```sh
npx phonux build                                # pick from the list; the choice is remembered
npx phonux build --targets iphone,ipad,desktop  # skip the list
npx phonux build --check                        # say what this machine is missing, build nothing
```

Builds run side by side when the machine has the cores and memory, one at a time when it does not (`--jobs` caps it).
A target this machine cannot build, such as iPhone off a Mac, is skipped with what to install. Logs and remembered
choices go in `.phonux/build/`, and so do finished builds (`android/`, `ios/`); add it to `.gitignore`.

Without signing set up, Android makes a test APK and iOS a simulator app. Add signing to `package.json` to get store
builds from the same command (`--debug` still makes test builds):

```json
"phonux": { "build": {
  "web": "build:web", "desktop": "build:desktop",
  "android": { "keystore": "release.jks", "alias": "upload" },
  "ios": { "teamId": "ABCDE12345" }
} }
```

The keystore passwords come from `PHONUX_KEYSTORE_PASSWORD` and `PHONUX_KEY_PASSWORD`, never from a file. `web` and
`desktop` name npm scripts, and default to the two shown.

## Embedding safely

A saved workspace is untrusted input. The library checks a loaded file with `isWorkspaceState` before it restores
anything. A host that reads a saved file itself, to import it or show what is in it, must call `isWorkspaceState` first
too. The guard does not check `params` deeply, so each view validates the `params` it is given before it uses them.

A view that shows a remote page must use a sandboxed `iframe` or an isolated webview. It must never share the host's
preload script, which can reach the host's own APIs.

Emotion, which MUI uses for its styles, writes its rules into `<style>` elements. A Content-Security-Policy blocks them
unless it allows `style-src 'unsafe-inline'`, or the host gives Emotion a nonce with `createCache({ key, nonce })` inside
a `CacheProvider`. Production builds insert rules through the CSSOM, which the policy does not block, so the gap often
shows only in development.

## Security

Report a vulnerability as [SECURITY.md](https://github.com/Jojos-Creations/phonux/blob/main/SECURITY.md) describes; the repository's private
vulnerability reporting is switched on.

## License

phonux is licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). Copyright (c) 2026 Joseph Reed. Anyone may use it, including commercially. If you change a file of phonux and distribute the result, you share your changes to that file under the same license; your own files that use phonux stay yours. The full text is in LICENSE.

Every source file of phonux in this package is Covered Software under the notice the license asks for in Exhibit A, given here once for all of them in place of a header in each file:

> This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/.

Versions 0.1.0, 0.2.0-rc.1 and 0.2.0-rc.2 were published under the MIT license and stay MIT. Versions 0.2.0-rc.3 through 0.2.0-rc.5 were published under the PolyForm Noncommercial License 1.0.0 and stay under it. Versions 0.2.0-rc.6 through 0.2.0-rc.8 were published under the phonux Public License 1.0.0 and stay under it. Releases after 0.2.0-rc.8 are under the Mozilla Public License 2.0. Third-party notices are in THIRD_PARTY_NOTICES.md in the package.

`npm run phone` runs the phone-width checks in Chromium on iPhone 13 and Pixel 7 profiles (touch on). `npm run phone:webkit` runs the iPhone profile in WebKit, which needs WebKit installed; `PHONE_PROJECTS` picks any set of them.

## Developing phonux

`npm ci`, then `npm run typecheck`, `npm test`, `npm run build`, `npm run check:api-report` and `npm run smoke` (the smoke installs from the registry). DESIGN.md, shipped in the package, covers the design, the release flow and how to try a change in an app before publishing.
