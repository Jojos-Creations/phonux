/**
 * Row order as anchor metadata: every entry but the row's root names the entry it sits beside, the side, and
 * how near. computeRowOrder turns anchors into an order; deriveAnchorsFromOrder turns an order back into anchors.
 * The root's id is always a parameter, never a constant here: which entry is the root is the app's choice.
 */

/**
 * An entry's place in the row: on `position`'s side of the entry `panel`, ranked by `priority` among the
 * entries on that same side of that same entry. Lower is nearer; ties keep the current row order.
 * @public
 */
export interface PanelAnchor {
  panel: string;
  position: 'left' | 'right';
  priority: number;
}

type Anchored = { id: string; anchor?: PanelAnchor };

const sameAnchor = (a: PanelAnchor | undefined, b: PanelAnchor): boolean => !!a && a.panel === b.panel && a.position === b.position && a.priority === b.priority;
/** Spreads the whole record: every other field must survive a re-anchor untouched. */
const withAnchor = <T extends Anchored>(p: T, anchor: PanelAnchor): T => (sameAnchor(p.anchor, anchor) ? p : { ...p, anchor });

/** Every non-root entry's anchor as read off its array position alone: the root's side, 0 = nearest. With no root present, every entry reads 'right'. */
function positionalAnchors(panels: readonly Anchored[], rootId: string): Map<string, PanelAnchor> {
  const root = panels.findIndex((p) => p.id === rootId);
  const out = new Map<string, PanelAnchor>();
  panels.forEach((p, i) => {
    if (p.id !== rootId) out.set(p.id, i < root ? { panel: rootId, position: 'left', priority: root - 1 - i } : { panel: rootId, position: 'right', priority: i - root - 1 });
  });
  return out;
}

/**
 * The entries in the order their anchors describe: a walk from the root, each entry's left side (farthest
 * first), then the entry, then its right side (nearest first). Priorities come back renumbered from 0 per side
 * of each entry, so a priority of -1 always lands nearest. An anchor naming a missing entry, or one in a cycle,
 * falls back to the root's right side (keeping its priority) instead of recursing forever or dropping the entry.
 * @public
 */
export function computeRowOrder<T extends { id: string; anchor?: PanelAnchor }>(panels: readonly T[], rootId: string): T[] {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const rowIndex = new Map(panels.map((p, i) => [p.id, i]));
  const positional = positionalAnchors(panels, rootId);
  const declared = (p: T): PanelAnchor => p.anchor ?? positional.get(p.id)!;
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
    if (target !== rootId) {
      if (byId.has(target)) resolve(target, [...path, id]);
      else fallback.add(id);
    }
    visiting.delete(id);
    resolved.add(id);
  };
  const effective = (p: T): PanelAnchor => (fallback.has(p.id) ? { panel: rootId, position: 'right', priority: declared(p).priority } : declared(p));
  const sides = new Map<string, { left: T[]; right: T[] }>();
  for (const p of panels) {
    if (p.id === rootId) continue;
    resolve(p.id, []);
  }
  for (const p of panels) {
    if (p.id === rootId) continue;
    const { panel, position } = effective(p);
    const side = sides.get(panel) ?? { left: [], right: [] };
    side[position].push(p);
    sides.set(panel, side);
  }
  // Nearest first; on a tie the entry nearer in the current row wins (later on the left, earlier on the right).
  const nearestFirst = (list: T[], position: 'left' | 'right'): T[] =>
    [...list].sort((a, b) => effective(a).priority - effective(b).priority || (position === 'right' ? 1 : -1) * (rowIndex.get(a.id)! - rowIndex.get(b.id)!));
  const out: T[] = [];
  const walk = (id: string, self: T | undefined): void => {
    const side = sides.get(id);
    const left = nearestFirst(side?.left ?? [], 'left');
    for (let k = left.length - 1; k >= 0; k--) walk(left[k]!.id, withAnchor(left[k]!, { panel: id, position: 'left', priority: k }));
    if (self) out.push(self);
    nearestFirst(side?.right ?? [], 'right').forEach((p, k) => walk(p.id, withAnchor(p, { panel: id, position: 'right', priority: k })));
  };
  walk(rootId, byId.get(rootId));
  return out;
}

/**
 * Every non-root entry re-anchored to the root from its current array position, so computeRowOrder reproduces
 * this exact order.
 * @public
 */
export function deriveAnchorsFromOrder<T extends { id: string; anchor?: PanelAnchor }>(panels: readonly T[], rootId: string): T[] {
  const positional = positionalAnchors(panels, rootId);
  return panels.map((p) => (p.id === rootId ? p : withAnchor(p, positional.get(p.id)!)));
}
