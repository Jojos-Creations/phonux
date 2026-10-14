/**
 * The shapes a panel template and the read side of a panel are declared with, and `definePanel`, which checks
 * a template when it is written rather than when a workspace first meets it. No workspace exists yet at this
 * layer: these are declarations plus one validating identity function.
 */

import type * as React from 'react';
import type { JsonValue, PanelSummary, FormFactor } from './hostApi.js';
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

/** A pin change waiting for the panel to become live. @public */
export type DeferredPin =
  | {
      /** Which call to apply once the panel is live: `pin` or `unpin`. */
      by: 'pin' | 'unpin';
    }
  | {
      /** The `parkable` value to apply once the panel is live. */
      parkable: boolean;
    };

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
  /** The panel's current tier. */
  readonly formFactor: FormFactor;
  /** Whether the panel appears in `PanelReader.list` and the panel list a view reads. */
  readonly listed: boolean;
  /** The panel's settings, resolved from every layer. */
  readonly settings: ResolvedPanelSettings;
  /** Whether the panel's `pinning` setting currently reads as pinned. */
  readonly pinned: boolean;
  /** A pin change waiting for the panel to become live, or null when none is. */
  readonly deferredPin: DeferredPin | null;
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

/** The five read-only members every handle and view handle has. @public */
export type PanelReadHandle = {
  /** The panel's id. */
  readonly id: PanelId;
  /** The id of the template the panel was made from. */
  readonly templateId: string;
  /** The panel's current state. */
  getState(): PanelState;
  /** The panel's settings resolved from every layer, with the layer each value came from and any conflicts. */
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

/** A panel kind: its id, the view that renders it, its settings layer and its initial params. @public */
export interface PanelTemplate<P extends JsonValue = JsonValue> {
  /** 1-48 characters, no whitespace, no '~', no leading '_', not all digits, not 'all'; unique in a workspace. */
  readonly id: string;
  /** The panel API level the template was written against; left out, it is the newest (`PANEL_API`). Any other value throws `invalid-template`. */
  readonly api?: PanelApiLevel;
  /** The component that renders the panel. It receives the panel's summary, its own read handle and a reader for every panel. */
  readonly view: React.ComponentType<{
    /** What a view may see of this panel. */
    panel: PanelSummary<P>;
    /** The panel's own read members. */
    handle: ViewHandle<P>;
    /** Read-only access to every panel. */
    manager: PanelReader;
  }>;
  /**
   * The component drawn at the bottom of every panel made from this template, inside the frame and below the content, which
   * scrolls above it. It receives the same props as `view`. Declared on the template and not a setting, so no layer overrides it.
   */
  readonly footer?: React.ComponentType<{
    /** What a footer may see of this panel. */
    panel: PanelSummary<P>;
    /** The panel's own read members and operations. */
    handle: ViewHandle<P>;
    /** Read-only access to every panel. */
    manager: PanelReader;
  }>;
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

/**
 * A template of any params: what a workspace accepts in `templates`, `root` and `registerTemplate`, so a template made with
 * `definePanel` for typed params needs no cast. `any`, because `PanelTemplate<P>` is invariant in `P`. `addPanel` still checks `params` against the template it is given.
 * @public
 */
export type AnyPanelTemplate = PanelTemplate<any>;

/**
 * Returns the template unchanged after checking it: a valid id, a component for `view` and for `footer` when given, an `api` the library serves, and a settings layer the
 * resolver accepts on its own. Throws PanelManagerError, 'invalid-template' or 'invalid-settings'.
 * @public
 */
export function definePanel<P extends JsonValue = JsonValue>(t: PanelTemplate<P>): PanelTemplate<P> {
  if (typeof t !== 'object' || t === null) throw new PanelManagerError('invalid-template', 'a template must be an object');
  const idProblem = templateIdProblem(t.id);
  if (idProblem !== undefined) throw new PanelManagerError('invalid-template', `template id ${JSON.stringify(t.id)} ${idProblem}`);
  if (!isComponent(t.view)) throw new PanelManagerError('invalid-template', `template '${t.id}': view must be a React component`);
  if (t.footer !== undefined && !isComponent(t.footer)) throw new PanelManagerError('invalid-template', `template '${t.id}': footer must be a React component`);
  checkPanelApi(t.id, t.api);
  resolvePanelSettings({ template: t.settings });
  reportLevelTieOnce(t.id, t.api, t.settings);
  return t;
}
