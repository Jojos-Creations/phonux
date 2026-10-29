import { jsx as _jsx } from "react/jsx-runtime";
/**
 * The public surface a view is written against: any component rendering a phone-shaped column
 * (a live panel, or a third party's) reads what it needs from `useHost()`,
 * renders a `<Panel>`, and never touches `localStorage` or any other app
 * internal (see DESIGN.md). The host mounts ONE `<HostProvider>`; a test uses the same provider
 * with `fakeHost.ts`'s fakes. The provider value is REBUILT EVERY RENDER (see HostProvider).
 */
import * as React from 'react';
import { OverlayProvider } from './windowOverlay.js';
import { ViewStateProvider } from './viewState.js';
/** The app's built-in size: upgrading must never silently resize anyone who has not chosen a model. @public */
export const DEFAULT_PHONE_SIZE = { modelId: 'default', width: 390, height: 700 };
// ---------------------------------------------------------------------------
// Provider and hook
// ---------------------------------------------------------------------------
/** Thrown by useHost() when no provider is mounted, so a view rendered without a host fails loudly instead of rendering defaults. @public */
export class HostMissingProviderError extends Error {
    /** @param hook - Name of the hook that was called, shown in the message. */
    constructor(hook = 'useHost') {
        super(`${hook}() was called outside a <HostProvider>. A view must render under the provider the host mounts; ` +
            'in a test, wrap it in <HostProvider host={createFakeHost()}> (createFakeHost comes from the phonux/testing entry point).');
        this.name = 'HostMissingProviderError';
    }
}
const HostContext = React.createContext(null);
// Module constants, not built per render: a reader memoised on `useHost().device` must see the same object every render.
const DEFAULT_DEVICE = { size: DEFAULT_PHONE_SIZE };
/** `input` as the `Host` readers get: itself when it already names a device, else a copy with the default filled in. */
function resolveHost(input) {
    if (input.device !== undefined)
        return input;
    return { ...input, device: input.device ?? DEFAULT_DEVICE };
}
/**
 * Mount once, at the host. `host` is passed straight through as the context
 * value (with the defaults of `HostInput` filled in): NEVER memoise it here or
 * where it is built. The handlers behind it close over render-time state (the
 * panel list, the column count), so a memoised bag hands views stale closures.
 * @public
 */
export function HostProvider({ host, children }) {
    return (_jsx(HostContext.Provider, { value: resolveHost(host), children: _jsx(OverlayProvider, { children: _jsx(ViewStateProvider, { children: children }) }) }));
}
/** The host a provider mounted, or null outside one: for the library's own components that can render without a host. @internal */
export function useOptionalHost() {
    return React.useContext(HostContext);
}
/** The one hook a view uses to reach the rest of the app. Call API methods from event handlers; do not capture one in an effect with empty deps. @public */
export function useHost() {
    const host = React.useContext(HostContext);
    if (host === null)
        throw new HostMissingProviderError();
    return host;
}
