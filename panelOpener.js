/**
 * `next` with every opener that left the list replaced by that opener's own opener, from `prev`, so the children of a
 * closed panel move up to its parent. An opener `prev` never held is kept: a family arriving from another workspace may
 * add a child before its parent.
 */
export function keepOpeners(prev, next) {
    if (next === prev || !next.some((p) => p.openedBy !== undefined))
        return next;
    const now = new Set(next.map((p) => p.id));
    const before = new Map(prev.map((p) => [p.id, p.openedBy]));
    let changed = false;
    const out = next.map((p) => {
        let opener = p.openedBy;
        // A hand-edited file can hold a cycle; the list's length bounds any honest chain.
        for (let hops = 0; opener !== undefined && !now.has(opener) && before.has(opener) && hops <= prev.length; hops += 1)
            opener = before.get(opener);
        if (opener !== undefined && !now.has(opener) && before.has(opener))
            opener = undefined;
        if (opener === p.openedBy)
            return p;
        changed = true;
        if (opener !== undefined)
            return { ...p, openedBy: opener };
        const { openedBy: _cut, ...rest } = p;
        return rest;
    });
    return changed ? out : next;
}
/** The engine ids of `id` and every panel it opened, directly or through others, in row order; empty when the list holds no `id`. */
export function familyIds(entries, id) {
    if (!entries.some((p) => p.id === id))
        return [];
    const children = new Map();
    for (const p of entries) {
        if (p.openedBy === undefined || p.marker === true)
            continue;
        const list = children.get(p.openedBy);
        if (list === undefined)
            children.set(p.openedBy, [p.id]);
        else
            list.push(p.id);
    }
    const family = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
        for (const child of children.get(queue.shift()) ?? []) {
            if (family.has(child))
                continue;
            family.add(child);
            queue.push(child);
        }
    }
    return entries.filter((p) => family.has(p.id)).map((p) => p.id);
}
