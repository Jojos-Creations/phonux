/**
 * Recording fakes of every API in hostApi.tsx, for testing a view with no host:
 * `createFakeHost({ panels: { panelList: [...] } })`, render under `<HostProvider>`, interact, then assert on
 * `host.calls`. Every method records `{ api, method, args }` in call order and does nothing else (async ones
 * resolve). The fakes hold no state: a test wanting a different live value re-renders with new overrides. An
 * override replaces a whole member, and an overridden
 * method no longer records. `createFakePanel` is the one exception: it holds the single panel state it was given.
 * Why it lives here: DESIGN.md, "Testing without a host".
 */
import { type Host } from './hostApi.js';
import type { JsonValue } from './hostApi.js';
import type { PanelReader, PanelState, PanelViewProps, ViewHandle } from './panelTemplate.js';
import type { WorkspaceState, WorkspaceStorage } from './workspaceState.js';
export type { Host, PhoneSize, JsonValue, PanelSize, PanelSummary, CreatePanelOptions, PanelsAPI, PhoneDeviceAPI } from './hostApi.js';
export type { PhonuxLabels } from './labels.js';
export type { SnapshotsAPI, ViewId, ViewSnapshot } from './snapshots.js';
export type { PhoneModel } from './phoneModels.js';
export type { WorkspacePanelState, WorkspaceState, WorkspaceStorage } from './workspaceState.js';
export type { AddPlacement, AnchorRequest, PanelId, PanelSettingsResolution, ResolvedPanelSettings, ScrollAlign, SettingValues, HeaderButton, SourceLayer, SettingNote, SettingConflict, CatalogName } from './panelSettings.js';
export type { ConfigureResult, PanelResult } from './panelManager.js';
export type { PanelRefusal } from './panelManagerError.js';
export type { PanelHandle } from './panelHandles.js';
export type { ListFilter, PanelReader, PanelReadHandle, PanelSnapshot, PanelState, PanelStatus, PanelViewProps, ViewHandle, WorkspaceStatus } from './panelTemplate.js';
export type { ViewPatch } from './settingsPatch.js';
export type { BezierEase, FadeEase } from './panelSettings.js';
export type { ChromeTuning, CloseExitEase, GlideEase, HeaderButtonBase, HeaderButtonContext } from './panelSettings.js';
export type { SettingsPatch } from './settingsPatch.js';
export type { CssStyle, ElementProps } from './cssStyle.js';
export type { DragToCloseTuning, EdgeScrollTuning, EnterFrom, ExitTo, HeaderButtonIconForm, HeaderButtonTextForm, Overflow, PanelSettings, ScrollOnDrag, ScrollOnMove, ScrollOnOpen, SlideTuning, WorkspaceTuning } from './panelSettings.js';
export type { InstancePatch } from './settingsPatch.js';
/** One recorded call to a fake method, as listed in `FakeHost.calls`. @public */
export interface FakeCall {
    /** Which `Host` member the method belongs to, e.g. 'panels'; 'handle' for a call on a `createFakePanel` handle. */
    api: keyof Host | 'handle';
    /** The method's name; a method of a nested object is dotted. */
    method: string;
    /** The arguments the method received, in order. */
    args: unknown[];
}
/** The `Host` members a host may leave out, which `FakeOverrides.absent` can leave out of a fake. @public */
export type AbsentHostMember = 'snapshots';
/**
 * Replacement members, per API. `absent` leaves the named optional members out of the fake altogether, so a view test renders
 * the frame in which a host has not supplied them yet; `createFakeHost` never supplies `labels`, so it is always absent.
 * @public
 */
export type FakeOverrides = {
    [K in keyof Host]?: Partial<Host[K]>;
} & {
    absent?: readonly AbsentHostMember[];
};
/** A `Host` whose methods record their calls instead of acting. @public */
export interface FakeHost extends Host {
    /** Every method call any of the fakes received, in order. */
    readonly calls: FakeCall[];
}
/**
 * Builds a recording `FakeHost` with inert defaults: `overrides` replaces whole members per API, and every
 * non-overridden method appends to `calls`.
 * @param overrides - Members to replace, per API; an overridden method no longer records. `absent` names optional members to leave out.
 * @public
 */
export declare function createFakeHost(overrides?: FakeOverrides): FakeHost;
/** A `WorkspaceStorage` held in memory, as `memoryWorkspaceStorage` makes it. @public */
export interface MemoryWorkspaceStorage extends WorkspaceStorage {
    /** A copy of the state `save` stored last; null until the first `save`. */
    readonly saved: WorkspaceState | null;
}
/**
 * A `WorkspaceStorage` that keeps the saved state in memory: `load` resolves a copy of what `save` last stored, or of
 * `initial`, and `save` stores a copy, so a test never shares an object with the workspace.
 * @param initial - The state `load` resolves until the first `save`; `null` for none.
 * @public
 */
export declare function memoryWorkspaceStorage(initial?: WorkspaceState | null): MemoryWorkspaceStorage;
/** One panel for `seedWorkspace`: the identity, hostData and visibility the workspace restores it with. @public */
export interface PanelSeed {
    /** The id the restored panel is drawn under, so a test can name it. Unique within the seeds. */
    id: string;
    /** Id of the template that renders the panel. */
    view: string;
    /** What the panel carries as `hostData`, which a saved file never holds. */
    hostData: JsonValue;
    /** Whether the panel restores mounted in the row (true) or parked (false). */
    live: boolean;
    /** The URL the panel shows. */
    url?: string;
    /** The panel's title. */
    title?: string;
    /** How many slots wide the panel restores, which sets its size; left out, one. */
    slots?: number;
    /** Whether the panel is a permanent column: it restores live, unlisted and one slot wide whatever `live` and `slots` say. */
    permanent?: boolean;
    /** Which side of the root the panel restores on; default `'right'`. Seeds on one side keep the order given, left to right. */
    side?: 'left' | 'right';
}
/** What `seedWorkspace` returns: members of `WorkspaceOptions` to spread into `createWorkspace`. @public */
export interface SeededWorkspace {
    /** Holds the seeded file; a `save` replaces it, so a second workspace over it restores what the first left. */
    readonly storage: MemoryWorkspaceStorage;
    /** Draws the seeds' ids for the restore, then counts up from 1 past any id a seed holds. */
    readonly newId: () => string;
    /** The `defaultHostData` that hands each restored panel its seed's `hostData`; a hand-mounted `useProvidePanels` takes it as `...seeded.panels`. */
    readonly panels: {
        readonly defaultHostData: () => JsonValue;
    };
}
/**
 * Members of `WorkspaceOptions` that make a workspace restore `seeds`, in the order given, through the same path a saved
 * file takes: `createWorkspace({ ...seedWorkspace(seeds), templates })`. For tests only; app code adds panels with
 * `definePanel`, `createWorkspace` and `addPanel`. Seed a workspace that declares no panels, and let it restore before
 * adding any: the first ids drawn and the first `hostData` handed out belong to the seeds.
 * @param seeds - The panels to restore, left to right after the root.
 * @param rootId - The id of the workspace's root entry; default is the id of a workspace without a root template.
 * @param laterIds - Engine ids (a panel's `id` in the snapshot) that `newId` hands out after the seeds and before the counter, one per panel added to the live workspace. An instance key is not set here: `addPanel(view, { id })` already names it.
 * @throws Error when two seeds share an id, or a later id repeats another.
 * @public
 */
export declare function seedWorkspace(seeds: readonly PanelSeed[], rootId?: string, laterIds?: readonly string[]): SeededWorkspace;
/** What `createFakePanel` builds: the props to render a view with, and the calls its handle received. @public */
export interface FakePanel<P extends JsonValue = JsonValue> {
    /** The props a template's `view` or `footer` receives: render the component with `{...fake.props}`. */
    readonly props: PanelViewProps<P>;
    /** The panel's handle: the same object as `props.handle`. */
    readonly handle: ViewHandle<P>;
    /** The reader over the one panel: the same object as `props.manager`. */
    readonly manager: PanelReader;
    /** Every operation the handle received, in order, as `{ api: 'handle', method, args }`. */
    readonly calls: FakeCall[];
}
/**
 * Builds a handle and a reader over one in-memory panel, so a view takes `props` from a test with no cast. The panel holds
 * the one state it was given and never changes it; every operation records a call and answers an accepted result that
 * changed nothing.
 * @param state - The panel's state; a field left out takes a default (id 'panel', template 'fake', status 'live').
 * @public
 */
export declare function createFakePanel<P extends JsonValue = JsonValue>(state?: Partial<Omit<PanelState, 'params'>> & {
    params?: P;
}): FakePanel<P>;
export { reportMaximized } from './maximizedStore.js';
export type { MaximizablePanel, MaximizePhase } from './maximizedStore.js';
