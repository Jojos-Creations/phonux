# phonux

A phone-shaped view host for React: write each view as a component, give phonux a template for it, and it lays the panels
out in a scrolling row of phone-sized columns, with a title bar, drag to reorder and drag to close. A view never touches
`localStorage` or anything else app-internal (see `DESIGN.md` in this folder for why).

## Install

While 0.2 is a release candidate, install the `next` tag, together with the peer dependencies:

```sh
npm install phonux@next
npm install react react-dom @mui/material @mui/icons-material @emotion/react @emotion/styled motion
```

`@dnd-kit/core` is a dependency of phonux, not a peer: npm installs it for you. The package also ships `DESIGN.md`, which explains
the design decisions behind the API.

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
host to build and no width to track. A view returns bare content and phonux draws the panel around it (title bar, grab bar,
drag to close, reorder). Nothing is saved between launches until you pass a `storage` option.

Pass the app's own values as options (`device`, `settings`, `history`, `snapshots`, `labels`, `topInset`, `panels`), a `wrap`
component for the app's providers, and `workspace.update(...)` to give a running workspace new values (see `DESIGN.md`,
"Workspace options, wrap and update"). A title-bar button is a setting too: `headerButtons: { more: { label: 'More', onClick } }`
draws the label as the button's text.

## Several workspaces

A column of workspaces is one call per workspace, in the same style as the quickstart:

```ts
import { createWorkspaceColumn, definePanel } from 'phonux';

const notes = definePanel({ id: 'notes', view: NotesView });
const column = createWorkspaceColumn({ templates: [notes] });
column.addWorkspace().addPanel('notes'); // "Workspace 1"
column.addWorkspace({ name: 'Reading' }); // or give it a name
```

The column renders itself. ArrowUp and ArrowDown (when focus is not in a field or dialog) move between workspaces, a button at the top
and bottom centre names the neighbour and moves there, and where there is none it reads "Create new workspace" and calls
`addWorkspace`. Each workspace has an input above its panels for its name. `storage` keeps the list, the names and the current
workspace; give the workspace you already have its old key with `addWorkspace({ id })`. An app that draws its own rows passes
`mount: false` and renders `<WorkspaceColumn column={column}>{(workspace) => ...}</WorkspaceColumn>`.

## Building your own flow

The default start is built on the components it exports, and they stay public. This is the same row written out by hand: create
the workspace with `mount: false`, then render the row inside the app's own MUI `ThemeProvider`.

<!-- advanced:start -->
```tsx
import * as React from 'react';
import { HostProvider, PanelRow, Workspace, useProvidePanels, type WorkspaceHandle } from 'phonux';

const PHONE_WIDTH = 390;

export function Row({ workspace }: { workspace: WorkspaceHandle }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current!;
    const read = () => setContainerWidth(el.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const provided = useProvidePanels({ workspace, rootId: workspace.rootId, phoneWidth: PHONE_WIDTH, containerWidth, overflowContainerRef: ref });
  return (
    <HostProvider host={{ panels: provided }}>
      <Workspace
        overflowContainerRef={ref}
        rowRef={rowRef}
        containerWidth={containerWidth}
        phoneWidth={PHONE_WIDTH}
        fixedColumnCount={provided.fixedViewCount}
        liveWidths={provided.liveWidths}
        rowScroll={provided.rowScroll}
        rowNumbers={provided.rowNumbers}
        tuning={provided.tuning}
      >
        <PanelRow
          entries={provided.entries}
          rootId={workspace.rootId}
          closingIds={provided.closingIds}
          enteringViaAnchorIds={provided.enteringViaAnchorIds}
          exitRightIds={provided.exitRightIds}
          enterSideById={provided.enterSideById}
          maxLiveWidth={provided.maxLiveWidth}
          tuning={provided.tuning}
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

A panel is a whole number of slots wide: one slot is the phone width, and each added slot adds a phone width plus the row gap. Set the count with `slots` (and cap it with `maxSlots`); a person can change it by dragging, and a view can change it with `setSlots`. A panel is drawn at no more slots than fit the window, and its chosen count comes back when the window grows. A panel is the same height whatever its slot count. `formFactor` still works as a view of `slots` (phone 1, tablet 2, desktop 3 or more) and is deprecated. See `DESIGN.md` "Slot sizing".

## Panel chrome

`useActivePanel()` returns the active panel's id and a setter (a press or focus anywhere inside a panel makes it active);
`usePanelActive()` and `usePanelDragging()` report one panel. `Panel` writes the same facts on its root box as
`data-panel-active` and `data-panel-dragging`, and marks its header, grab bar and footer with `data-panel-chrome-part`
(`header`, `grab-bar` or `footer`), so a host can style from them. The names are exported as `ACTIVE_ATTRIBUTE`,
`DRAGGING_ATTRIBUTE` and `CHROME_ATTRIBUTE`, and the part values as `CHROME_PARTS`, so a host imports them and repeats no string. `tuning.chrome` with `mode: 'hover-or-active'` fades
those parts out for a panel nobody is using, along `fadeEase` (see DESIGN.md, "Panel chrome").

`tuning.shrinkOutOfView` (`'off'`, `'visible'`, `'hidden'`) decides what a stepping row does with the panels its window would leave
cut off by an edge: `'visible'` moves the row one slot at a time, so every panel steps through every size on its way in and out
(1, 2, ... its own width, then its own width ... 2, 1) and is never cropped; `'hidden'` keeps whole panels and hides the rest; `'off'` shows the neighbour at the window edge cut off, at its full size. A resize grabber calls the setter from `usePanelResizing()` so no other
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

phonux is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0): personal and other noncommercial use is free. Commercial use needs a separate paid licence. For commercial licensing, contact Jojos-Creations on GitHub (<https://github.com/Jojos-Creations>).

Versions 0.1.0 and 0.2.0-rc.2 were published under the MIT licence and stay MIT. From 0.2.0-rc.3 on, phonux is PolyForm Noncommercial. Third-party notices are in THIRD_PARTY_NOTICES.md in the package.

## Developing phonux

`npm ci`, then `npm run typecheck`, `npm test`, `npm run build`, `npm run check:api-report` and `npm run smoke` (the smoke installs from the registry). DESIGN.md, shipped in the package, covers the design, the release flow and how to try a change in an app before publishing.
