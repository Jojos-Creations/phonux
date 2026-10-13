# phonux

A phone-shaped view host for React: write a view against a small set of host
APIs, register it, and render it inside one `<HostProvider>`. The host decides
which views are live; a view never touches `localStorage`,
or anything else app-internal (see `DESIGN.md` in this folder for why).

Install it from npm, together with the peer dependencies listed below:

```sh
npm install phonux
```

The package also ships `DESIGN.md`, which explains the design decisions behind
the API.

## Peer dependencies

phonux does not bundle React, MUI, emotion or motion -- it expects the host
app to already have them:

```sh
npm install react react-dom @mui/material @mui/icons-material @emotion/react @emotion/styled motion
```

## Quickstart

A view reads what it needs from `useHost()` and renders a `<Panel>`:

```tsx
import { Panel, PanelFrame, useHost, registerView, type ViewProps } from 'phonux';

function MyView({ panel }: ViewProps) {
  const host = useHost();
  return (
    <Panel title={panel.title}>
      <PanelFrame>{host.device.size.width}px wide</PanelFrame>
    </Panel>
  );
}

registerView('my-view', MyView);
```

The host mounts one `<HostProvider>`, near the app's root, with its own
implementation of the host APIs:

```tsx
import { HostProvider } from 'phonux';

function App({ host }) {
  return (
    <HostProvider host={host}>
      {/* ...the row that resolves and renders registered views... */}
    </HostProvider>
  );
}
```

## Panel sizing

A panel is a whole number of slots wide: one slot is the phone width, and each added slot adds a phone width plus the row gap. Set the count with `slots` (and cap it with `maxSlots`); a person can change it by dragging, and a view can change it with `setSlots`. A panel is drawn at no more slots than fit the window, and its chosen count comes back when the window grows. A panel is the same height whatever its slot count. `formFactor` still works as a view of `slots` (phone 1, tablet 2, desktop 3 or more) and is deprecated. See `DESIGN.md` "Slot sizing".

## Panel chrome

`useActivePanel()` returns the active panel's id and a setter (a press or focus anywhere inside a panel makes it active);
`usePanelActive()` and `usePanelDragging()` report one panel. `Panel` writes the same facts on its root box as
`data-panel-active` and `data-panel-dragging`, and marks its header, grab bar and footer with `data-panel-chrome-part`
(`header`, `grab-bar` or `footer`), so a host can style from them. The names are exported as `ACTIVE_ATTRIBUTE`,
`DRAGGING_ATTRIBUTE` and `CHROME_ATTRIBUTE`, and the part values as `CHROME_PARTS`, so a host imports them and repeats no string. `tuning.chrome` with `mode: 'hover-or-active'` fades
those parts out for a panel nobody is using, along `fadeEase` (see DESIGN.md, "Panel chrome").

`tuning.shrinkOutOfView` (`'off'`, `'visible'`, `'hidden'`) decides what a stepping row does with the neighbour its shown panels
would leave cut off by the window edge: `'visible'` draws it smaller by whole slots to fill the free room, on the side the row
is moving toward; `'hidden'` keeps the room as margin. A resize grabber calls the setter from `usePanelResizing()` so no other
panel changes size under it (see DESIGN.md, "Whole panels only").

## Testing a view

`phonux/testing` exports `createFakeHost()`: a recording fake of every host
API, so a view can be rendered with no real host behind it.

```tsx
import { render } from '@testing-library/react';
import { HostProvider } from 'phonux';
import { createFakeHost } from 'phonux/testing';

render(
  <HostProvider host={createFakeHost()}>
    <MyView panel={{ id: '1', live: true, locked: false }} />
  </HostProvider>,
);
```

`createFakeHost(overrides)` replaces whole members of one API (e.g.
`{ panels: { panelList: [...] } }`); every call any fake receives is
recorded, in order, on the returned host's `.calls`.

See `DESIGN.md` in this folder for the reasoning behind the API shape, the
panel-view registry, and what stays out of a view's reach on purpose.

## License

phonux is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0): personal and other noncommercial use is free. Commercial use needs a separate paid licence. For commercial licensing, contact Jojos-Creations on GitHub (https://github.com/Jojos-Creations).

Versions 0.1.0 and 0.2.0-rc.2 were published under the MIT licence and stay MIT. From 0.2.0-rc.3 on, phonux is PolyForm Noncommercial. Third-party notices are in THIRD_PARTY_NOTICES.md in the package.

## Developing phonux

`npm ci`, then `npm run typecheck`, `npm test`, `npm run build`, `npm run check:api-report` and `npm run smoke` (the smoke installs from the registry). DESIGN.md, shipped in the package, covers the design, the release flow and how to try a change in an app before publishing.
