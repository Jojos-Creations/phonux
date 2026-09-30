/**
 * Workspace state as a saved file: the JSON shape, its guard, and the pure pair that turns the panel list into
 * that shape and back. DESIGN.md ("Workspace state persistence") holds the rules; this file holds no React and
 * no host code.
 */
import type { FormFactor, JsonValue } from './hostApi.js';
import { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
import { appendPanel, type PanelWindow } from './panelWindow.js';

/**
 * One saved panel. `id` only names this panel inside its own file, so an `anchor` can point at another entry;
 * it is replaced on restore. Never saved: `hostData`, `size`, `locked`, `collapsible`, `anchoredEnter` and the
 * host's root column.
 * @public
 */
export type WorkspacePanelState = {
  id: string;
  view: string;
  url: string;
  title?: string;
  params?: JsonValue;
  listed?: boolean;
  live: boolean;
  // Inline, not PanelAnchor: an interface is not assignable to JsonValue.
  anchor: { panel: string; position: 'left' | 'right'; priority: number };
  formFactor?: FormFactor;
  permanent?: boolean;
  layer?: 'base' | 'raised';
};

/**
 * The saved workspace: a version and one entry per saved panel, in row order. The host's root column is not in it.
 * @public
 */
export type WorkspaceState = {
  version: 1;
  panels: WorkspacePanelState[];
};

/**
 * What a host implements to keep the workspace between launches. `load` resolves the saved state, or `null` when
 * there is none. `save` is fire-and-forget and must not throw.
 * @public
 */
export type WorkspaceStorage = {
  load(): Promise<WorkspaceState | null>;
  save(state: WorkspaceState): void;
};

const FORM_FACTORS: readonly unknown[] = ['phone', 'tablet', 'desktop'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOptional = (value: unknown, type: 'string' | 'boolean'): boolean => value === undefined || typeof value === type;

function isSavedPanel(value: unknown): value is WorkspacePanelState {
  if (!isRecord(value)) return false;
  const { anchor } = value;
  return (
    typeof value.id === 'string' &&
    typeof value.view === 'string' &&
    typeof value.url === 'string' &&
    typeof value.live === 'boolean' &&
    isOptional(value.title, 'string') &&
    isOptional(value.listed, 'boolean') &&
    isOptional(value.permanent, 'boolean') &&
    (value.formFactor === undefined || FORM_FACTORS.includes(value.formFactor)) &&
    (value.layer === undefined || value.layer === 'base' || value.layer === 'raised') &&
    isRecord(anchor) &&
    typeof anchor.panel === 'string' &&
    (anchor.position === 'left' || anchor.position === 'right') &&
    typeof anchor.priority === 'number' &&
    Number.isFinite(anchor.priority)
  );
}

/**
 * Whether `value` is a workspace file this version understands: version 1, a `panels` array of well-typed entries
 * with unique ids. Unknown extra keys are accepted (a later optional field is additive); `params` is not deep-checked.
 */
export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.panels)) return false;
  const panels: unknown[] = value.panels;
  if (!panels.every(isSavedPanel)) return false;
  return new Set(panels.map((p) => p.id)).size === panels.length;
}

/**
 * The saved form of `panels`: every entry but the root, with only the documented keys. `permanent` is derived
 * (`!collapsible`) because PanelWindow has no such field, and an absent optional stays absent so no key holds
 * `undefined`.
 */
export function projectWorkspaceState(panels: readonly PanelWindow[], rootId: string): WorkspaceState {
  const positional = new Map(deriveAnchorsFromOrder(panels, rootId).map((p) => [p.id, p.anchor]));
  return {
    version: 1,
    panels: panels
      .filter((p) => p.id !== rootId)
      .map((p) => {
        const anchor = p.anchor ?? positional.get(p.id)!;
        return {
          id: p.id,
          view: p.view,
          url: p.url,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.params !== undefined ? { params: p.params } : {}),
          ...(p.listed !== undefined ? { listed: p.listed } : {}),
          live: p.live,
          anchor: { panel: anchor.panel, position: anchor.position, priority: anchor.priority },
          ...(p.formFactor !== undefined ? { formFactor: p.formFactor } : {}),
          ...(!p.collapsible ? { permanent: true } : {}),
          ...(p.layer !== undefined ? { layer: p.layer } : {}),
        };
      }),
  };
}

/**
 * The panels `state` describes, in row order and without the root, each under a fresh id from `freshId`. `hostData`
 * is left for the caller: only the host knows what a new panel carries.
 */
export function hydrateWorkspaceState(state: WorkspaceState, freshId: () => string, rootId: string): PanelWindow[] {
  // Every entry's id is drawn before anything else, so a saved id that happens to equal a fresh one is never reused.
  const fresh = state.panels.map(() => freshId());
  const freshOf = new Map(state.panels.map((s, i) => [s.id, fresh[i]!]));
  // One id nothing else holds stands in for every anchor target the file does not contain: a saved id kept as it
  // is could equal a fresh one (both count up from 1 each launch) and attach the panel to a stranger.
  let missing: string | undefined;
  const targetOf = (saved: string): string => {
    if (saved === rootId) return rootId;
    const mapped = freshOf.get(saved);
    if (mapped !== undefined) return mapped;
    missing ??= freshId();
    return missing;
  };
  const built = state.panels.map((s, i) => {
    // appendPanel owns the creation rules (permanent forces listed false and phone, size comes from the tier).
    const entry = appendPanel(
      [],
      { url: s.url, view: s.view, title: s.title, params: s.params, listed: s.listed, layer: s.layer, formFactor: s.formFactor, permanent: s.permanent },
      fresh[i]!,
      rootId,
    )[0]!;
    // A permanent column is never parked, so one saved as parked would never render and never be revealed.
    const live = s.permanent === true ? true : s.live;
    return { ...entry, live, anchor: { panel: targetOf(s.anchor.panel), position: s.anchor.position, priority: s.anchor.priority } };
  });
  // One pass over the whole set: placing entries one at a time would rewrite an anchor that names a later entry.
  return computeRowOrder(built, rootId);
}
