import { jsx as _jsx } from "react/jsx-runtime";
/**
 * The public surface a view is written against: any component rendering a phone-shaped column
 * (Settings, History, a live panel, or a third party's) reads what it needs from `useHost()`,
 * renders a `<Panel>`, and never touches the desktop bridge, `localStorage` or any other app
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
    constructor(hook = 'useHost') {
        super(`${hook}() was called outside a <HostProvider>. A view must render under the provider the host mounts; ` +
            'in a test, wrap it in <HostProvider host={createFakeHost()}> (createFakeHost comes from the phonux/testing entry point).');
        this.name = 'HostMissingProviderError';
    }
}
/** @public @deprecated use HostMissingProviderError -- same class, so `instanceof` works under either name. */
export const PhoneAPIsMissingProviderError = HostMissingProviderError;
const HostContext = React.createContext(null);
/**
 * Mount once, at the host. `host` is passed straight through as the context
 * value: NEVER memoise it here or where it is built. The handlers behind it
 * close over render-time state (the panel list, the column count), so a
 * memoised bag hands views stale closures.
 * @public
 */
export function HostProvider({ host, children }) {
    return (_jsx(HostContext.Provider, { value: host, children: _jsx(OverlayProvider, { children: _jsx(ViewStateProvider, { children: children }) }) }));
}
/**
 * @deprecated use HostProvider (its prop is `host`, not `apis`). This is a distinct thin wrapper, not the
 * same value as HostProvider, because the prop itself renamed.
 * @public
 */
export function PhoneAPIsProvider({ apis, children }) {
    return _jsx(HostProvider, { host: apis, children: children });
}
/** The one hook a view uses to reach the rest of the app. Call API methods from event handlers; do not capture one in an effect with empty deps. @public */
export function useHost() {
    const host = React.useContext(HostContext);
    if (host === null)
        throw new HostMissingProviderError();
    return host;
}
/** @public @deprecated use useHost -- same function, so identity checks keep working. */
export const usePhoneAPIs = useHost;
