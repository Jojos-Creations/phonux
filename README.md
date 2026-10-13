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

## Panel chrome

`useActivePanel()` returns the active panel's id and a setter (a press or focus anywhere inside a panel makes it active);
`usePanelActive()` and `usePanelDragging()` report one panel. `Panel` writes the same facts on its root box as
`data-panel-active` and `data-panel-dragging`, and marks its header, grab bar and footer with `data-panel-chrome-part`
(`header`, `grab-bar` or `footer`), so a host can style from them. `tuning.chrome` with `mode: 'hover-or-active'` fades
those parts out for a panel nobody is using, along `fadeEase` (see DESIGN.md, "Panel chrome").

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

## Developing phonux

`npm ci`, then `npm run typecheck`, `npm test`, `npm run build`, `npm run check:api-report` and `npm run smoke` (the smoke installs from the registry). DESIGN.md, shipped in the package, covers the design, the release flow and how to try a change in an app before publishing.
