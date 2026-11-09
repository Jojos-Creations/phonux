/**
 * The shapes a panel template and the read side of a panel are declared with, and `definePanel`, which checks
 * a template when it is written rather than when a workspace first meets it. No workspace exists yet at this
 * layer: these are declarations plus one validating identity function.
 */

import type * as React from 'react';
import type { JsonValue, PanelSummary } from './hostApi.js';
import { reportLevelTieOnce } from './panelLevelChecks.js';
import { checkPanelApi, type PanelApiLevel } from './panelApiLevel.js';
import { PanelManagerError } from './panelManagerError.js';
import { resolvePanelSettings } from './panelSettings.js';
import type { PanelHandle } from './panelHandles.js';
import type { ConfigureResult } from './panelManager.js';
import type { ViewPatch } from './settingsPatch.js';
import type { PanelId, PanelSettings, PanelSettingsResolution, ResolvedPanelSettings } from './panelSettings.js';

/** Where a panel is: waiting to be added, in the strip, parked or hidden, or closed. @public */
export type PanelStatus = 'pending' | 'live' | 'parked' | 'closed';

/** Where a workspace is in its life: `detached`, `loading`, `ready` or `disposed`. @public */
export type WorkspaceStatus = 'detached' | 'loading' | 'ready' | 'disposed';

/** What `PanelReader.list` keeps; a field left out keeps everything on that field. @public */
export type ListFilter = {
  /** Keep only panels in this status, or in any of these statuses. */
  status?: PanelStatus | readonly PanelStatus[];
  /** Keep only panels whose `listed` equals this. */
  listed?: boolean;
};

/** A readonly snapshot of one panel. @public */
export interface PanelState {
  /** The panel's id. */
  readonly id: PanelId;
  /** The id of the template the panel was made from. */
  readonly templateId: string;
  /** Where the panel is now. */
  readonly status: PanelStatus;
  /** Whether the panel is held: a held park stays parked until a person shows it. */
  readonly held: boolean;
  /** Null while the panel has no engine entry (pending or closed). */
  readonly engineId: string | null;
  /** The panel's index in the row, or null when it has no place in it. */
  readonly index: number | null;
  /** The panel's title, or undefined when none is set. */
  readonly title: string | undefined;
  /** The panel's URL; the empty string when it has none. */
  readonly url?: string;
  /** The opaque, JSON-serializable params the panel was made with, or undefined when it has none. */
  readonly params: JsonValue | undefined;
  /** Whether the panel appears in `PanelReader.list` and the panel list a view reads. */
  readonly listed: boolean;
  /** The panel's settings, resolved from every layer. */
  readonly settings: ResolvedPanelSettings;
  /**
   * The id of the panel whose view opened this one through its own `useWorkspace().panels.addPanel`, or null for a panel the
   * host opened, one added before the workspace was ready, one that arrived alone from another workspace, and a pending or
   * closed panel. A workspace always sets it; a state built by hand may leave it out. Set once when the panel is created; a drag, a reorder or a reopen never changes it. When the opener closes or
   * moves away alone, this becomes the opener's own opener.
   */
  readonly openedBy?: PanelId | null;
}

/** A readonly picture of a workspace at one moment: its version, its status and every panel's state. @public */
export type PanelSnapshot = {
  /** The snapshot's version, for telling one snapshot from another. */
  readonly version: number;
  /** The workspace's status when the snapshot was taken. */
  readonly status: WorkspaceStatus;
  /** The state of every panel. */
  readonly panels: readonly PanelState[];
};

/** The read-only members every handle and view handle has: id, template id, state, settings and subscribe. @public */
export type PanelReadHandle = {
  /** The panel's id. */
  readonly id: PanelId;
  /** The id of the template the panel was made from. */
  readonly templateId: string;
  /**
   * The panel's current state.
   * @throws PanelManagerError with code `invalid-options` when the workspace knows no panel with this id.
   */
  getState(): PanelState;
  /**
   * The panel's settings resolved from every layer, with the layer each value came from and any conflicts.
   * @throws PanelManagerError with code `invalid-options` when the workspace knows no panel with this id.
   */
  getSettings(): PanelSettingsResolution;
  /** Calls `l` when the panel changes; returns a function that stops the calls. */
  subscribe(l: () => void): () => void;
};

/** What a template's view receives as `handle`: the panel's own handle, its read members and its operations; its `configure` takes only the keys a view may set. @public */
export type ViewHandle<P extends JsonValue = JsonValue> = Omit<PanelHandle<P>, 'configure'> & {
  /** Changes the settings a view may change on its own panel; any other key answers `not-view-settable`. */
  configure(patch: ViewPatch): ConfigureResult;
};

/** What a template's view receives as `manager`: read-only access to every panel. @public */
export type PanelReader = {
  /** The read handle of the panel with this id, or undefined when there is none. */
  get(id: PanelId): PanelReadHandle | undefined;
  /** The state of every panel `f` keeps; all panels when `f` is left out. */
  list(f?: ListFilter): readonly PanelState[];
  /** A readonly picture of the whole workspace. */
  getSnapshot(): PanelSnapshot;
  /** Calls `l` when the workspace changes; returns a function that stops the calls. */
  subscribe(l: () => void): () => void;
};

/**
 * The props a template's `view` and `footer` receive. Not the legacy `ViewProps` of the view registry; that name is a different shape.
 * @public
 */
export interface PanelViewProps<P extends JsonValue = JsonValue> {
  /** What a view may see of this panel. */
  panel: PanelSummary<P>;
  /** The panel's own read members and operations; its `configure` takes only the keys a view may set. */
  handle: ViewHandle<P>;
  /** Read-only access to every panel. */
  manager: PanelReader;
}

/** Where a template's panels handle a mouse as a finger: see {@link PanelTemplate.touch}. @public */
export type PanelTouch = boolean | 'content';

/** A panel kind: its id, the view that renders it, its settings layer and its initial params. @public */
export interface PanelTemplate<P extends JsonValue = JsonValue> {
  /** 1-48 characters, no whitespace, no '~', no leading '_', not all digits, not 'all'; unique in a workspace. */
  readonly id: string;
  /** The panel API level the template was written against; left out, it is the newest (`PANEL_API`). Any other value throws `invalid-template`. */
  readonly api?: PanelApiLevel;
  /** The component that renders the panel. It receives the panel's summary, its own `ViewHandle` (read members, operations on its own panel, and a `configure` that takes only `ViewPatch` keys) and a reader for every panel. */
  readonly view: React.ComponentType<PanelViewProps<P>>;
  /**
   * The component drawn at the bottom of every panel made from this template, inside the frame and below the content, which
   * scrolls above it. It receives the same props as `view`. Declared on the template and not a setting, so no layer overrides it.
   */
  readonly footer?: React.ComponentType<PanelViewProps<P>>;
  /**
   * Handles a mouse as a finger in every panel made from this template, while that panel is active and the pointer is inside
   * it: a drag scrolls the content under it and coasts on release, scrollbars are hidden, and the cursor is a finger dot.
   * `true` covers the whole panel, its header and footer included; `'content'` only its frame, leaving the header and footer
   * to the mouse. The drag never moves the row. Option (Alt) held at the press, and text fields and sliders, keep the mouse.
   * Defaults to false.
   */
  readonly touch?: PanelTouch;
  /**
   * Lets a person drag the grab bar of a panel made from this template up and down while it is in a row: a drag down past
   * `tuning.dragToClose` closes it, and a `DragToClose` given `previewOut` lifts its tile out. Defaults to false, where the
   * grab bar drags only sideways, to reorder, and Delete on it and the header's close button still close the panel.
   * `DragToClose` outside a row always drags vertically.
   */
  readonly verticalDrag?: boolean;
  /**
   * Whether a press on a panel made from this template, while it is not in use, only puts it in use. Left out, the
   * workspace's `tuning.firstPressFocusOnly` decides. Set it to override that one way or the other for this template.
   */
  readonly firstPressFocusOnly?: boolean;
  /** The template's settings layer, applied to every panel made from it. */
  readonly settings?: PanelSettings;
  /** The params a panel made from this template starts with. */
  readonly params?: P;
}

const TEMPLATE_ID_MAX = 48;

function templateIdProblem(id: unknown): string | undefined {
  if (typeof id !== 'string') return 'must be a string';
  if (id.length < 1 || id.length > TEMPLATE_ID_MAX) return `must be 1 to ${TEMPLATE_ID_MAX} characters`;
  if (/\s/.test(id)) return 'must not contain whitespace';
  if (id.includes('~')) return "must not contain '~', which separates a template id from an instance suffix";
  if (id.startsWith('_')) return "must not start with '_', which is reserved for the engine";
  if (/^[0-9]+$/.test(id)) return 'must not be all digits';
  if (id === 'all') return "'all' is reserved";
  return undefined;
}

// A memo, forwardRef or lazy component is an object carrying $$typeof, not a function.
const isComponent = (view: unknown): boolean => typeof view === 'function' || (typeof view === 'object' && view !== null && '$$typeof' in view);

// `any`, not JsonValue: PanelTemplate<P> is invariant in P, so only `any` accepts a template of every params.
/**
 * A template of any params: what a workspace accepts in `templates`, `root` and `registerTemplate`, so a template made with
 * `definePanel` for typed params needs no cast. `addPanel` still checks `params` against the template it is given.
 * @public
 */
export type AnyPanelTemplate = PanelTemplate<any>;

/**
 * Returns the template unchanged after checking it: a valid id, a component for `view` and for `footer` when given, a `touch` of a boolean or `'content'`, a boolean `verticalDrag` and a boolean `firstPressFocusOnly` when given, an `api` the library serves, and a settings layer the
 * resolver accepts on its own. 
 * @throws PanelManagerError with code `invalid-template` or `invalid-settings`.
 * @public
 */
export function definePanel<P extends JsonValue = JsonValue>(t: PanelTemplate<P>): PanelTemplate<P> {
  if (typeof t !== 'object' || t === null) throw new PanelManagerError('invalid-template', 'a template must be an object');
  const idProblem = templateIdProblem(t.id);
  if (idProblem !== undefined) throw new PanelManagerError('invalid-template', `template id ${JSON.stringify(t.id)} ${idProblem}`);
  if (!isComponent(t.view)) throw new PanelManagerError('invalid-template', `template '${t.id}': view must be a React component`);
  if (t.footer !== undefined && !isComponent(t.footer)) throw new PanelManagerError('invalid-template', `template '${t.id}': footer must be a React component`);
  if (t.touch !== undefined && typeof t.touch !== 'boolean' && t.touch !== 'content') throw new PanelManagerError('invalid-template', `template '${t.id}': touch must be a boolean or 'content'`);
  if (t.verticalDrag !== undefined && typeof t.verticalDrag !== 'boolean') throw new PanelManagerError('invalid-template', `template '${t.id}': verticalDrag must be a boolean`);
  if (t.firstPressFocusOnly !== undefined && typeof t.firstPressFocusOnly !== 'boolean') throw new PanelManagerError('invalid-template', `template '${t.id}': firstPressFocusOnly must be a boolean`);
  checkPanelApi(t.id, t.api);
  resolvePanelSettings({ template: t.settings });
  reportLevelTieOnce(t.id, t.api, t.settings);
  return t;
}
