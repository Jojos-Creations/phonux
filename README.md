# phonux

A phone-shaped view host for React: write each view as a component, give phonux a template for it, and it lays the panels
out in a row of phone-sized columns that steps one phone width at a time, each panel with a header, a width control and a grab
bar (drag sideways to reorder, down to close; a touch never drags it). A view never touches `localStorage` or anything else
app-internal (see `DESIGN.md` in this folder for why).

## Install

While 0.2 is a release candidate, install the `next` tag, together with the peer dependencies:

```sh
npm install phonux@next
npm install react react-dom @mui/material @mui/icons-material @emotion/react @emotion/styled motion
```

`@dnd-kit/core` is a dependency of phonux, not a peer: npm installs it for you. The package also ships `DESIGN.md`, which explains
the design decisions behind the API.

## Testing main without a publish

Every push to `main` force-pushes the built package to the `dist` branch, a test channel and not a release. An app that wants
to try main before a publish depends on `github:Jojos-Creations/phonux#dist`. The package version on that branch is the source
version, so the commit SHA in the app's lockfile, not the version, says which build it is. A shipped app never depends on
`dist`. `npm publish` and its publish gate are unchanged. The repository is private, so whoever installs it, CI included,
needs a GitHub credential.

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
host to build and no width to track. A template takes two optional fields beyond `view`: `footer`, a component drawn at the
bottom of every panel made from it (it gets the same props as `view`, and scrolls above it), and `api`, the panel API level
the template was written against (left out, it is the newest). A view returns bare content and phonux draws the panel around it (title bar, grab bar,
drag to close, reorder). Nothing is saved between launches until you pass a `storage` option. With `storage`, the panels come back at the next launch, and so does the stop the row rests on once you have moved it: the row reopens at that stop with no visible scroll.

Pass the app's own values as options (`device`, `snapshots`, `labels`, `topInset`, `panels`; a view reads `snapshots` and `labels` with a fallback, because the first frame holds only what you passed), a `wrap`
component for the app's providers (StrictMode, `MotionConfig` and contexts go in it), a `theme: (mode) => PhonuxTheme` for its own theme (the mount draws it with one baseline; the `mode` is the window's color scheme; each field is also a CSS custom property, such as `--phonux-primary`, that a stylesheet rule overrides), and `workspace.update(...)` to give a running workspace new values (see `DESIGN.md`,
"Workspace options, wrap and update"). A title-bar button is a setting too: `headerButtons: { more: { label: 'More', onClick } }`
draws the label as the button's text.

A view unmounts when its panel parks or closes, so audio, a web view or a socket started inside a view stops with it. Start those in the `wrap` component instead, which stays mounted for the workspace's life, and let the panel render controls for them (see `DESIGN.md`, "A parked view unmounts").

## The row

The row is a strip of slots one phone width apart; a panel is a whole number of slots wide. The row steps one phone width per
scroll step and rests with its whole slots centered in the window, at the ends too; a sideways wheel or Shift+wheel anywhere
on the row steps it (Option held gives the gesture to the content), a vertical wheel goes to the content, and ArrowLeft and
ArrowRight on the page step it (`stepRow(event, direction)` gives a host's own chord the same answer). A panel that no longer
fits parks, and a scroll at the row's end brings a parked panel back. Motion follows one rule set: a new panel grows from its
center, a closing one shrinks into its center, a parking one shrinks into the edge it leaves by and a returning one grows out of
that edge, all on one 0.6 s in-out clock (`DESIGN.md`, "Motion").

Where a new panel lands is the template's `placeOnAdd` (default: the far right, the leftmost panel in view leaving when there is
no room) or the caller's `addPanel(template, { place })` function, which picks the slot among the panels in view, what the
panel there does (shift left, shift right or close) and the entrance. `usePanelDots` gives a host the dots and the oval of a
dot bar in place of a scrollbar, parked panels included; `usePanelMaximize` and `toggleMaximize` grow a panel to fill the window;
`whenAccepted`, `whenPanel`, `showPanels` and `whenColumnReady` wait on the row instead of a timer; `rowDom.ts` exports the
`data-*` attribute names the library draws; `useRowFrameBand`, `PANEL_BAR_HEIGHT_PX`, `PANEL_FOOTER_ROOM_PX` and
`rowFootReserve` give a host the numbers to lay its page out around the row. Each has a section in `DESIGN.md`.

## Several workspaces

A column of workspaces is one call per workspace, in the same style as the quickstart:

```ts
import { createWorkspaceColumn, definePanel } from 'phonux';

const notes = definePanel({ id: 'notes', view: NotesView });
const column = createWorkspaceColumn({ templates: [notes] });
column.addWorkspace().addPanel('notes'); // "Workspace 1"
column.addWorkspace({ name: 'Reading' }); // or give it a name
column.removeWorkspace(0); // takes it out and disposes it; false for the last one
```

The column renders itself. A button at the top and bottom center names the neighbor and moves there, `column.step('up' | 'down')`
moves by one (bind a key to it; the column binds none), and where there is none it reads "Create new workspace" and calls
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

const workspace = createWorkspace({ templates: [definePanel({ id: 'notes', view: Notes })] });
workspace.addPanel('notes');
const row = await renderWorkspace(workspace, { width: 1200 });
await row.drag(row.panel('notes')!.grabBar!, { dx: 0, dy: 120 }); // closes the panel
await row.setWidth(600);
await row.dispose();
```

`row.panel(id)` returns the drawn `root`, `header`, `grabBar` and `footer` of the panel with that key.

See `DESIGN.md` in this folder for the reasoning behind the API shape, the
panel-view registry, and what stays out of a view's reach on purpose.

## License

phonux is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0): personal and other noncommercial use is free. Commercial use needs a separate paid license. For commercial licensing, contact Jojos-Creations on GitHub (<https://github.com/Jojos-Creations>).

Versions 0.1.0 and 0.2.0-rc.2 were published under the MIT license and stay MIT. From 0.2.0-rc.3 on, phonux is PolyForm Noncommercial. Third-party notices are in THIRD_PARTY_NOTICES.md in the package.

`npm run phone` runs the phone-width checks in Chromium on iPhone 13 and Pixel 7 profiles (touch on). `npm run phone:webkit` runs the iPhone profile in WebKit, which needs WebKit installed; `PHONE_PROJECTS` picks any set of them.

## Developing phonux

`npm ci`, then `npm run typecheck`, `npm test`, `npm run build`, `npm run check:api-report` and `npm run smoke` (the smoke installs from the registry). DESIGN.md, shipped in the package, covers the design, the release flow and how to try a change in an app before publishing.
