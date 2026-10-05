/**
 * The shapes a panel template and the read side of a panel are declared with, and `definePanel`, which checks
 * a template when it is written rather than when a workspace first meets it. No workspace exists yet at this
 * layer: these are declarations plus one validating identity function.
 */

import type * as React from 'react';
import type { JsonValue, PanelSummary, FormFactor } from './hostApi.js';
import { PanelManagerError } from './panelManagerError.js';
import { resolvePanelSettings } from './panelSettings.js';
import type { PanelId, PanelSettings, PanelSettingsResolution, ResolvedPanelSettings } from './panelSettings.js';

/** Where a panel is: waiting to be added, in the strip, parked or hidden, or closed. @public */
export type PanelStatus = 'pending' | 'live' | 'parked' | 'closed';

/** A pin change waiting for the panel to become live. @public */
export type DeferredPin = { by: 'pin' | 'unpin' } | { parkable: boolean };

/** @public */
export type WorkspaceStatus = 'detached' | 'loading' | 'ready' | 'disposed';

/** @public */
export type ListFilter = { status?: PanelStatus | readonly PanelStatus[]; listed?: boolean };

/** A readonly snapshot of one panel. @public */
export interface PanelState {
  readonly id: PanelId;
  readonly templateId: string;
  readonly status: PanelStatus;
  readonly held: boolean;
  /** Null while the panel has no engine entry (pending or closed). */
  readonly engineId: string | null;
  readonly index: number | null;
  readonly title: string | undefined;
  readonly url: string;
  readonly params: JsonValue | undefined;
  readonly formFactor: FormFactor;
  readonly listed: boolean;
  readonly settings: ResolvedPanelSettings;
  readonly pinned: boolean;
  readonly deferredPin: DeferredPin | null;
}

/** @public */
export type PanelSnapshot = { readonly version: number; readonly status: WorkspaceStatus; readonly panels: readonly PanelState[] };

/** The five read-only members every handle and view handle has. @public */
export type PanelReadHandle = {
  readonly id: PanelId;
  readonly templateId: string;
  getState(): PanelState;
  getSettings(): PanelSettingsResolution;
  subscribe(l: () => void): () => void;
};

/** What a template's view receives as `handle`: the panel's own read members, widened by the operations that follow. @public */
export type ViewHandle<P extends JsonValue = JsonValue> = PanelReadHandle;

/** What a template's view receives as `manager`: read-only access to every panel. @public */
export type PanelReader = {
  get(id: PanelId): PanelReadHandle | undefined;
  list(f?: ListFilter): readonly PanelState[];
  getSnapshot(): PanelSnapshot;
  subscribe(l: () => void): () => void;
};

/** A panel kind: its id, the view that renders it, its settings layer and its initial params. @public */
export interface PanelTemplate<P extends JsonValue = JsonValue> {
  /** 1-48 characters, no whitespace, no '~', no leading '_', not all digits, not 'all'; unique in a workspace. */
  readonly id: string;
  readonly view: React.ComponentType<{ panel: PanelSummary<P>; handle: ViewHandle<P>; manager: PanelReader }>;
  readonly settings?: PanelSettings;
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
 * Returns the template unchanged after checking it: a valid id, a component for `view`, and a settings layer the
 * resolver accepts on its own. Throws PanelManagerError, 'invalid-template' or 'invalid-settings'.
 * @public
 */
export function definePanel<P extends JsonValue = JsonValue>(t: PanelTemplate<P>): PanelTemplate<P> {
  if (typeof t !== 'object' || t === null) throw new PanelManagerError('invalid-template', 'a template must be an object');
  const idProblem = templateIdProblem(t.id);
  if (idProblem !== undefined) throw new PanelManagerError('invalid-template', `template id ${JSON.stringify(t.id)} ${idProblem}`);
  if (!isComponent(t.view)) throw new PanelManagerError('invalid-template', `template '${t.id}': view must be a React component`);
  resolvePanelSettings({ template: t.settings });
  return t;
}
