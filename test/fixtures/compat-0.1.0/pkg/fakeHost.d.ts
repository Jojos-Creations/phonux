/**
 * Recording fakes of every API in hostApi.tsx, for testing a view with no host and no desktop bridge:
 * `createFakeHost({ panels: { panelList: [...] } })`, render under `<HostProvider>`, interact, then assert on
 * `host.calls`. Every method records `{ api, method, args }` in call order and does nothing else (async ones
 * resolve). The fakes hold no state: a test wanting a different live value re-renders with new overrides. An
 * override replaces a whole member (a nested object such as `closedPagesViewer` too), and an overridden
 * method no longer records. Why it lives here: DESIGN.md, "Testing without a host".
 */
import { type Host } from './hostApi.js';
export type { Host, PhoneSize, DetectedPhone, ClosedPageEntry, JsonValue, FormFactor, PanelSize, PanelSummary, CreatePanelOptions, SettingsAPI, HistoryAPI, PanelsAPI, PhoneDeviceAPI } from './hostApi.js';
export type { SnapshotsAPI, ViewId, ViewSnapshot } from './snapshots.js';
export type { PhoneModel } from './phoneModels.js';
/** @public */
export interface FakeCall {
    api: keyof Host;
    method: string;
    args: unknown[];
}
/** Replacement members, per API. @public */
export type FakeOverrides = {
    [K in keyof Host]?: Partial<Host[K]>;
};
/** @public */
export interface FakeHost extends Host {
    /** Every method call any of the fakes received, in order. */
    readonly calls: FakeCall[];
}
/** @public @deprecated use FakeHost */
export type FakePhoneAPIs = FakeHost;
/** @public */
export declare function createFakeHost(overrides?: FakeOverrides): FakeHost;
/** @public @deprecated use createFakeHost -- same function, so identity checks keep working. */
export declare const createFakePhoneAPIs: typeof createFakeHost;
