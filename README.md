# phonux

A phone-shaped view host for React: write a view against a small set of host
APIs, register it, and render it inside one `<HostProvider>`. The host decides
which views are live; a view never touches the desktop bridge, `localStorage`,
or anything else app-internal (see `DESIGN.md` in this folder for why).

Today this package is consumed in place, from inside the phonux-app repository
(Jojos-Creations/phonux-app, at `client/src/shared/phone`), with `exports`
pointing straight at `.ts` source -- no build step for in-repo use.
`npm run build:phonux` (repo root) packs a versioned, typed build to `dist/`
for use from outside the repo.

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

## Testing a view

`phonux/testing` exports `createFakeHost()`: a recording fake of every host
API, so a view can be rendered with no real host behind it.

```tsx
import { render } from '@testing-library/react';
import { HostProvider } from 'phonux';
import { createFakeHost } from 'phonux/testing';

render(
  <HostProvider host={createFakeHost()}>
    <MyView panel={{ id: '1', url: 'about:blank', live: true, locked: false }} />
  </HostProvider>,
);
```

`createFakeHost(overrides)` replaces whole members of one API (e.g.
`{ panels: { panelList: [...] } }`); every call any fake receives is
recorded, in order, on the returned host's `.calls`.

See `DESIGN.md` in this folder for the reasoning behind the API shape, the
panel-view registry, and what stays out of a view's reach on purpose.
