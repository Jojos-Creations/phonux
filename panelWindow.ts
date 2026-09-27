/**
 * The `PanelWindow` model -- one browsing panel in the unified row -- and every pure state-transition
 * function that operates on a `PanelWindow[]` array.
 */
import { DEFAULT_PHONE_SIZE, type FormFactor, type JsonValue, type PanelSize, type PanelSummary } from 'phonux';

/**
 * Every entry's default tier/size, History and permanent columns included. A constant, not phoneSizeStore's
 * live size, so this file's helpers stay pure (no device-state argument); derived from DEFAULT_PHONE_SIZE so
 * the two cannot drift. See DESIGN.md, "Where `PanelWindow`'s own default size comes from".
 */
const DEFAULT_PANEL_SIZE: PanelSize = Object.freeze({ formFactor: 'phone', width: DEFAULT_PHONE_SIZE.width, height: DEFAULT_PHONE_SIZE.height });

/**
 * Each tier's own size, the one table setFormFactor and appendPanel copy from (see DESIGN.md, "The tier
 * table"). The 'phone' entry is only a placeholder: a phone panel renders at the live phone model size.
 * 'fill' is the row's own height. Frozen because every panel starts out referencing these same objects.
 */
export const TIER_SIZES: Readonly<Record<FormFactor, PanelSize>> = Object.freeze({
  phone: DEFAULT_PANEL_SIZE,
  tablet: Object.freeze({ formFactor: 'tablet', width: 768, height: 'fill' }),
  desktop: Object.freeze({ formFactor: 'desktop', width: 1200, height: 'fill' }),
});

/**
 * One browsing panel in the unified row, parked and revived by the same capacity rules
 * (usePanelManager.ts) regardless of how it was opened. AdventurePanel.tsx renders every entry
 * here, live or parked. A panel is EITHER live in the row or parked in the adventure card, never
 * both, and is never removed from this array just for being parked -- only `closePanel` drops one.
 */
/** The seeded History entry's id -- every array this model governs carries exactly one. */
export const HISTORY_PANEL_ID = 'history';

/**
 * A panel's row place: on `position`'s side of `panel`, ranked by `priority` among the panels on that same side
 * of that same panel -- lower is nearer, ties keep the current row order. Row order lives in memory only.
 */
export interface PanelAnchor {
  panel: string;
  position: 'left' | 'right';
  priority: number;
}

export interface PanelWindow {
  id: string;
  url: string;
  title?: string;
  webContentsId: number | null;
  /** The guest `<webview>` this panel's own new-window request came FROM -- electron/main.ts's `pageId`. `-1` for a panel that was not opened FROM another page (History's "+" makes these). */
  sourceWebContentsId: number;
  /** Mounted live in the row right now. `false` means parked in the adventure card only -- still fully present in this array, just not rendered as a `<webview>`. */
  live: boolean;
  /** Whether DragToClose's drag-down gesture may close this panel at all. Every panel created by `appendPanel` is unlocked. */
  locked: boolean;
  /** Which component renders this entry (phonux's registry, resolveView) -- read ONLY by the rendering wrapper (LivePanels.tsx); every park/close site reads `collapsible`/`listed`/`locked` instead, never this. An open string, not a closed union: an unregistered value renders a placeholder, never a crash. */
  view: string;
  /** Capacity parks (an open, a revive, the row gesture, a capacity drop) may park this entry; `false` marks an always-shown column exempt from all of them. */
  collapsible: boolean;
  /** Appears in the public `panelList` (History's own row list, and PanelsAPI). */
  listed: boolean;
  /** Opaque per-panel data a create() caller supplied (PanelsAPI.create's `params`); undefined for built-ins. Threaded to PanelSummary.params by this file's own summarisePanel(); no behavior site here reads it. */
  params?: JsonValue;
  /** Where this entry sits in the row (computeRowOrder). Undefined only for History, the root; a hand-built record without one reads as anchored where it already stands, and computeRowOrder writes that anchor. */
  anchor?: PanelAnchor;
  /** Which of the row's two stacking tiers this entry's slot sits in -- read ONLY by LivePanels.tsx's per-slot zIndex. Default 'base'. */
  layer?: 'base' | 'raised';
  /** Whether this entry's reappearance always resolves through the anchor formula (resolveEnterDirection) instead of unconditionally entering from the right -- read ONLY by LivePanels.tsx's enterDirection. Default false. */
  anchoredEnter?: boolean;
  /** This panel's own visual tier; createHistoryPanel/appendPanel always set it. Optional so a record built by hand without it still typechecks. */
  formFactor?: FormFactor;
  /** This panel's own rendered size (LivePanel passes it to Panel/PanelFrame for a non-phone tier). Optional for the same reason as `formFactor`. */
  size?: PanelSize;
}

/**
 * A panel's own width in the row -- the one rule every width reader goes through. A 'phone' panel
 * ALWAYS uses the live `phoneWidth` the caller passes, never its own stored `size` (a placeholder
 * pinned at `DEFAULT_PHONE_SIZE`, which would freeze it at 390 regardless of the real model). Only
 * 'tablet'/'desktop' read their stored size, capped at `maxLiveWidth` (computeMaxLiveWidth for the current
 * row) so a wide panel always fits beside the fixed columns.
 */
export function panelWidthOf(p: Pick<PanelWindow, 'formFactor' | 'size'>, phoneWidth: number, maxLiveWidth: number): number {
  return (p.formFactor ?? 'phone') === 'phone' ? phoneWidth : Math.min(p.size?.width ?? phoneWidth, maxLiveWidth);
}

/** The one PanelWindow -> PanelSummary projection: every site that hands a panel to a VIEW (LivePanels.tsx's resolved component, useProvidePanels.ts's panelList/recentlyClosed) narrows through this SAME function, so a third-party or built-in view can never see a desktop-only field (webContentsId, collapsible, anchor, layer, anchoredEnter, ...). formFactor/size ARE forwarded (unlike those desktop-only fields): a view's own tier control reads its tier from this projection, not the internal record. */
export const summarisePanel = ({ id, url, title, live, locked, params, formFactor, size }: PanelWindow): PanelSummary => ({
  id, url, title, live, locked, params,
  // Absent, not undefined, when the record lacks them: a summary never lists a key its record never had.
  ...(formFactor !== undefined ? { formFactor } : {}),
  ...(size !== undefined ? { size } : {}),
});

/** History's own seeded entry: never collapsible (an always-shown column), never listed (it must not list itself), always live, locked by default (usePanelClosing.ts's lock gate); raised/anchored so its slot and reappearance behave the way they always have. Same default tier/size as every other entry: a permanent column carries a tier like any other. */
export function createHistoryPanel(): PanelWindow {
  return {
    id: HISTORY_PANEL_ID, url: '', title: 'History', webContentsId: null, sourceWebContentsId: -1, live: true, locked: true,
    view: 'history', collapsible: false, listed: false, layer: 'raised', anchoredEnter: true,
    formFactor: 'phone', size: DEFAULT_PANEL_SIZE,
  };
}

/**
 * Per-call metadata create() may set beyond a bare url/source. No raw `collapsible`/`locked` key: `permanent`
 * is the only door to `collapsible:false` (see `appendPanel`'s own doc comment for what it forces), and
 * `locked` is never settable at all -- create() can never make an unclosable panel.
 */
export interface AppendPanelOptions {
  view?: string;
  title?: string;
  params?: JsonValue;
  listed?: boolean;
  /** `panel` defaults to History, `priority` to one past the far end of that side. Default { position: 'right' }. */
  anchor?: { panel?: string; position: 'left' | 'right'; priority?: number };
  layer?: 'base' | 'raised';
  anchoredEnter?: boolean;
  /** See `CreatePanelOptions.permanent` (phoneViewApi.tsx) for the full contract; `appendPanel` is what enforces it. */
  permanent?: boolean;
  /** The new panel's tier. Ignored for a permanent column, which is always 'phone'. Default 'phone'. */
  formFactor?: FormFactor;
}

type AnchorRequest = NonNullable<AppendPanelOptions['anchor']>;
const sameAnchor = (a: PanelAnchor | undefined, b: PanelAnchor): boolean => !!a && a.panel === b.panel && a.position === b.position && a.priority === b.priority;
/** Spreads the whole record: formFactor, size, webContentsId and params must survive a re-anchor untouched. */
const withAnchor = (p: PanelWindow, anchor: PanelAnchor): PanelWindow => (sameAnchor(p.anchor, anchor) ? p : { ...p, anchor });

/** Every non-History entry's anchor as read off its array position alone: History's side, 0 = nearest. With no History present, every entry reads 'right'. */
function positionalAnchors(panels: readonly PanelWindow[]): Map<string, PanelAnchor> {
  const root = panels.findIndex((p) => p.id === HISTORY_PANEL_ID);
  const out = new Map<string, PanelAnchor>();
  panels.forEach((p, i) => {
    if (p.id !== HISTORY_PANEL_ID) out.set(p.id, i < root ? { panel: HISTORY_PANEL_ID, position: 'left', priority: root - 1 - i } : { panel: HISTORY_PANEL_ID, position: 'right', priority: i - root - 1 });
  });
  return out;
}

/** `request` with its defaults filled against `panels`: History, and one past the highest priority already on that side (`self` excluded). */
function fillAnchor(panels: readonly PanelWindow[], request: AnchorRequest, self?: string): PanelAnchor {
  const panel = request.panel ?? HISTORY_PANEL_ID;
  if (request.priority !== undefined) return { panel, position: request.position, priority: request.priority };
  const positional = positionalAnchors(panels);
  let max = -1;
  for (const p of panels) {
    const a = p.anchor ?? positional.get(p.id);
    if (p.id !== self && p.id !== HISTORY_PANEL_ID && a && a.panel === panel && a.position === request.position) max = Math.max(max, a.priority);
  }
  return { panel, position: request.position, priority: max + 1 };
}

/**
 * The array in the order its anchors describe: a walk from History, each panel's left side (farthest first),
 * then the panel, then its right side (nearest first). Priorities come back renumbered 0.. per side of each
 * panel, so -1 always means "nearest". An anchor naming a missing panel, or one in a cycle, falls back to
 * {History, 'right'} (keeping its priority) instead of recursing forever or dropping the panel.
 */
export function computeRowOrder(panels: PanelWindow[]): PanelWindow[] {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const rowIndex = new Map(panels.map((p, i) => [p.id, i]));
  const positional = positionalAnchors(panels);
  const declared = (p: PanelWindow): PanelAnchor => p.anchor ?? positional.get(p.id)!;
  const fallback = new Set<string>();
  const visiting = new Set<string>();
  const resolved = new Set<string>();
  const resolve = (id: string, path: readonly string[]): void => {
    if (resolved.has(id)) return;
    if (visiting.has(id)) {
      for (const member of path.slice(path.indexOf(id))) fallback.add(member);
      return;
    }
    visiting.add(id);
    const target = declared(byId.get(id)!).panel;
    if (target !== HISTORY_PANEL_ID) {
      if (byId.has(target)) resolve(target, [...path, id]);
      else fallback.add(id);
    }
    visiting.delete(id);
    resolved.add(id);
  };
  const effective = (p: PanelWindow): PanelAnchor => (fallback.has(p.id) ? { panel: HISTORY_PANEL_ID, position: 'right', priority: declared(p).priority } : declared(p));
  const sides = new Map<string, { left: PanelWindow[]; right: PanelWindow[] }>();
  for (const p of panels) {
    if (p.id === HISTORY_PANEL_ID) continue;
    resolve(p.id, []);
  }
  for (const p of panels) {
    if (p.id === HISTORY_PANEL_ID) continue;
    const { panel, position } = effective(p);
    const side = sides.get(panel) ?? { left: [], right: [] };
    side[position].push(p);
    sides.set(panel, side);
  }
  // Nearest first; on a tie the entry nearer in the current row wins (later on the left, earlier on the right).
  const nearestFirst = (list: PanelWindow[], position: 'left' | 'right'): PanelWindow[] =>
    [...list].sort((a, b) => effective(a).priority - effective(b).priority || (position === 'right' ? 1 : -1) * (rowIndex.get(a.id)! - rowIndex.get(b.id)!));
  const out: PanelWindow[] = [];
  const walk = (id: string, self: PanelWindow | undefined): void => {
    const side = sides.get(id);
    const left = nearestFirst(side?.left ?? [], 'left');
    for (let k = left.length - 1; k >= 0; k--) walk(left[k]!.id, withAnchor(left[k]!, { panel: id, position: 'left', priority: k }));
    if (self) out.push(self);
    nearestFirst(side?.right ?? [], 'right').forEach((p, k) => walk(p.id, withAnchor(p, { panel: id, position: 'right', priority: k })));
  };
  walk(HISTORY_PANEL_ID, byId.get(HISTORY_PANEL_ID));
  return out;
}

/** Every non-History entry re-anchored to History from its current array position, so computeRowOrder reproduces this exact order. */
export function deriveAnchorsFromOrder(panels: PanelWindow[]): PanelWindow[] {
  const positional = positionalAnchors(panels);
  return panels.map((p) => (p.id === HISTORY_PANEL_ID ? p : withAnchor(p, positional.get(p.id)!)));
}

/** `id` re-anchored per `request` (defaults as for appendPanel), the row re-ordered to match. The SAME array for an unknown id or a `collapsible: false` entry. */
export function reanchorPanel(panels: PanelWindow[], id: string, request: AnchorRequest): PanelWindow[] {
  const target = panels.find((p) => p.id === id);
  if (!target || !target.collapsible) return panels;
  const anchor = fillAnchor(panels, request, id);
  return computeRowOrder(panels.map((p) => (p.id === id ? { ...p, anchor } : p)));
}

/**
 * Builds a brand-new, live 'extra' panel immutably and places it by `info.anchor` (default: right of
 * History, past every panel already there -- the row's far right end). History is seeded directly, never through this
 * function. `permanent` forces `collapsible:false` and `listed:false` (overriding any `info.listed`
 * passed) since such a column must supply its own close control, never the row's trash; `locked`
 * stays false regardless so that control keeps working with no extra plumbing (usePanelClosing.ts gates
 * only on `locked`).
 */
export function appendPanel(panels: PanelWindow[], info: { sourceWebContentsId: number; url: string } & AppendPanelOptions, id: string): PanelWindow[] {
  const formFactor = info.permanent ? 'phone' : (info.formFactor ?? 'phone');
  const entry: PanelWindow = {
    id,
    url: info.url,
    ...(info.title !== undefined ? { title: info.title } : {}),
    webContentsId: null,
    sourceWebContentsId: info.sourceWebContentsId,
    live: true,
    locked: false,
    view: info.view ?? 'web',
    collapsible: !info.permanent,
    listed: info.permanent ? false : (info.listed ?? true),
    ...(info.params !== undefined ? { params: info.params } : {}),
    anchor: fillAnchor(panels, info.anchor ?? { position: 'right' }),
    layer: info.layer ?? 'base',
    anchoredEnter: info.anchoredEnter ?? false,
    // Every entry carries a tier; a permanent column's is always 'phone'.
    formFactor,
    size: formFactor === 'phone' ? DEFAULT_PANEL_SIZE : { ...TIER_SIZES[formFactor] },
  };
  return computeRowOrder([...panels, entry]);
}

/**
 * The id of the live collapsible panel farthest (by array index) from `fromIndex`, or null with none live.
 * Ties go to the lower index (the strict `>` keeps the first). From an append (`fromIndex` = the new length)
 * that is the LEFT end of the live range; from an open anchored nearest History or a revive left of the range it is the
 * RIGHT end. promoteToLive and usePanelManager.ts's open/restore park both pick through this. `exclude`
 * exempts the panel being opened or restored, which is already live in the array the caller passes, and any
 * panel another action in the same update must keep live.
 */
export function farthestLiveCollapsibleId(panels: PanelWindow[], fromIndex: number, exclude: ReadonlySet<string> = new Set()): string | null {
  let bestId: string | null = null;
  let bestDist = -1;
  panels.forEach((p, i) => {
    if (!p.collapsible || !p.live || exclude.has(p.id)) return;
    const dist = Math.abs(i - fromIndex);
    if (dist > bestDist) {
      bestDist = dist;
      bestId = p.id;
    }
  });
  return bestId;
}

/**
 * Which side of the row a park/reveal at `id` reads as, for the exit/enter animation: 'left' when `id`'s
 * own array index sits below every OTHER live collapsible panel's index, 'right' otherwise (a parked panel
 * between two live ones included). Computed fresh from array position every time, never a persisted flag,
 * so an append's park always reads 'left' and a park for an open anchored nearest History reads 'right'.
 */
export function sideOfLiveRange(panels: PanelWindow[], id: string): 'left' | 'right' {
  const ownIndex = panels.findIndex((p) => p.id === id);
  let firstOtherLiveIndex = Number.POSITIVE_INFINITY;
  panels.forEach((p, i) => {
    if (p.collapsible && p.live && p.id !== id) firstOtherLiveIndex = Math.min(firstOtherLiveIndex, i);
  });
  return ownIndex < firstOtherLiveIndex ? 'left' : 'right';
}

/** The row-slot index of the LEFTMOST (lowest-index) live collapsible panel, or -1 if none are live. */
export function leftmostLiveIndex(panels: PanelWindow[]): number {
  for (let i = 0; i < panels.length; i++) if (panels[i]!.collapsible && panels[i]!.live) return i;
  return -1;
}

/** The row-slot index of the RIGHTMOST (highest-index) live collapsible panel, or -1 if none are live. */
export function rightmostLiveIndex(panels: PanelWindow[]): number {
  let found = -1;
  panels.forEach((p, i) => {
    if (p.collapsible && p.live) found = i;
  });
  return found;
}

/** The first PARKED collapsible panel strictly after `index` -- a rightward gesture's own "next one to bring in", or null with nothing parked on that side. */
export function firstParkedAfter(panels: PanelWindow[], index: number): PanelWindow | null {
  for (let i = index + 1; i < panels.length; i++) if (panels[i]!.collapsible && !panels[i]!.live) return panels[i]!;
  return null;
}

/** The last PARKED collapsible panel strictly before `index` -- a leftward gesture's own "next one to bring in", or null with nothing parked on that side. */
export function lastParkedBefore(panels: PanelWindow[], index: number): PanelWindow | null {
  for (let i = index - 1; i >= 0; i--) if (panels[i]!.collapsible && !panels[i]!.live) return panels[i]!;
  return null;
}

/**
 * Clicking ANY adventure-card row (live or parked) activates it -- flips `live` in place, never
 * moving the entry's array position. Returns `null` for an unknown id or one already live (a
 * legitimate no-op, not an error). When promoting `id` would exceed `capacity`, demotes exactly one
 * OTHER live panel: whichever `farthestLiveCollapsibleId` picks from `id`'s own index, the same far
 * rule an open/restore parks by. Never demotes a `collapsible: false` entry or any id in `keep`.
 */
export function promoteToLive(panels: PanelWindow[], id: string, capacity: number, keep: ReadonlySet<string> = new Set()): PanelWindow[] | null {
  const target = panels.find((p) => p.id === id);
  if (!target || target.live) return null;
  const ownIndex = panels.findIndex((p) => p.id === id);
  const liveCountAfter = panels.filter((p) => p.collapsible && p.live).length + 1;
  let next = panels.map((p) => (p.id === id ? { ...p, live: true } : p));
  if (liveCountAfter > capacity) {
    // `panels` (pre-promotion): `id` itself still reads live:false there, so it is naturally excluded
    // from the search without needing `keep`.
    const demote = farthestLiveCollapsibleId(panels, ownIndex, keep);
    if (demote) {
      next = next.map((p) => (p.id === demote ? { ...p, live: false } : p));
    }
  }
  return next;
}

/**
 * Closes one panel COMPLETELY: it leaves the array, live or parked, so it leaves the row and History
 * together. Returns what a caller needs to log it and to undo it -- the array without it, the panel itself
 * and the index it had -- or `null` for an unknown `id` (already closed, cleared): nothing to do, not an
 * error. Every panel anchored to it takes over its own anchor, so they close up in the place it held.
 */
export function closePanel(panels: PanelWindow[], id: string): { remaining: PanelWindow[]; closed: PanelWindow; index: number } | null {
  const index = panels.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const closed = panels[index]!;
  const inherited = closed.anchor ?? positionalAnchors(panels).get(id);
  const rest = panels.filter((p) => p.id !== id).map((p) => (inherited && p.anchor?.panel === id ? { ...p, anchor: { ...inherited } } : p));
  return { remaining: computeRowOrder(rest), closed, index };
}

/**
 * Moves `id` one PRESENT slot toward `direction` (present = `!collapsible || live`, the same filter LivePanels.tsx
 * renders), swapping past whichever other present panel sits there -- History and a permanent column included;
 * a parked panel physically between the two present ones simply shifts by one array slot, keeping
 * firstParkedAfter/lastParkedBefore/sideOfLiveRange meaningful afterward. Every anchor is then re-read from the
 * new order. Returns the SAME array reference for every no-op: unknown id, a `collapsible: false` source (an
 * always-shown column is never dragged), a parked panel, or one already at that edge.
 */
export function movePanel(panels: PanelWindow[], id: string, direction: 'left' | 'right'): PanelWindow[] {
  const present = panels.filter((p) => !p.collapsible || p.live);
  const presentIndex = present.findIndex((p) => p.id === id);
  if (presentIndex < 0 || !present[presentIndex]!.collapsible) return panels;
  const neighbor = present[direction === 'left' ? presentIndex - 1 : presentIndex + 1];
  if (!neighbor) return panels;
  const from = panels.findIndex((p) => p.id === id);
  const to = panels.findIndex((p) => p.id === neighbor.id);
  const next = panels.slice();
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return deriveAnchorsFromOrder(next);
}

/** The widths of the present panels a drag can cross, nearest first on each side; LivePanels.tsx stops each side at the first `collapsible: false` one. */
export interface NeighborWidths {
  readonly left: readonly number[];
  readonly right: readonly number[];
}

/**
 * How many movePanel hops a horizontal drag of `offsetX` px asks for (+right/-left). A hop past a neighbour
 * moves the dragged panel by that NEIGHBOUR's span (its width plus `gap`), so each hop lands half-way across
 * the next neighbour's span, counted from where the previous hop ended; the dragged panel's own width never
 * enters it. Exactly half a span is a hop either way, and this never returns -0.
 */
export function reorderStepsForOffset(offsetX: number, neighbors: NeighborWidths, gap: number): number {
  const distance = Math.abs(offsetX);
  let travelled = 0;
  let steps = 0;
  for (const width of offsetX > 0 ? neighbors.right : neighbors.left) {
    const span = width + gap;
    if (distance < travelled + span / 2) break;
    travelled += span;
    steps++;
  }
  return steps === 0 ? 0 : Math.sign(offsetX) * steps;
}

/**
 * `id` at `next`'s tier, its `size` REPLACED by a fresh copy of that tier's TIER_SIZES entry. Returns the SAME
 * array reference for every no-op: an unknown id, a `collapsible: false` entry (History or a permanent column,
 * movePanel's own source guard), or a panel already at `next`. A parked panel may change tier and stays parked.
 */
export function setFormFactor(panels: PanelWindow[], id: string, next: FormFactor): PanelWindow[] {
  const target = panels.find((p) => p.id === id);
  if (!target || !target.collapsible || (target.formFactor ?? 'phone') === next) return panels;
  return panels.map((p) => (p.id === id ? { ...p, formFactor: next, size: { ...TIER_SIZES[next] } } : p));
}

/**
 * Reverses closePanel for one panel: puts `panel` back at `index` (clamped to
 * the current length, so a shorter array still takes it), `webContentsId` reset
 * because whatever it pointed at was unmounted when it closed. An id that is
 * already present leaves `panels` unchanged (a double undo never duplicates).
 * Whether it comes back live or parked is the caller's choice: it is whatever
 * `panel.live` says. Anchors are re-read from the result, since its old anchor
 * may no longer describe that index.
 */
export function restorePanel(panels: PanelWindow[], panel: PanelWindow, index: number): PanelWindow[] {
  if (panels.some((p) => p.id === panel.id)) return panels;
  const at = Math.max(0, Math.min(index, panels.length));
  return deriveAnchorsFromOrder([...panels.slice(0, at), { ...panel, webContentsId: null }, ...panels.slice(at)]);
}
