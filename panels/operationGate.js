/**
 * The turn's operation gate, kept outside React: its tokens live in plain maps so every closure of every render reads
 * the same turn, however many commits a flushSync makes inside one call. usePanelManager owns the React side: it
 * forces a commit on release and calls `settle` from a layout effect with the highest token that commit has seen.
 */
/** A new gate with no tokens. `release` is called by the gate's `release` and must force a commit. */
export function createOperationGate(release) {
    let seq = 0;
    const tokens = new Map();
    let closeToken = 0;
    const gate = {
        busy: (ids, kind) => {
            if (ids.some((id) => tokens.has(id)))
                return true;
            if (kind === 'close')
                return [...tokens.values()].some((t) => t.source === 'manager');
            return closeToken !== 0;
        },
        take: (ids, kind) => {
            if (gate.busy(ids, kind))
                return undefined;
            const token = ++seq;
            for (const id of ids)
                tokens.set(id, { token, source: 'manager', kind });
            if (kind === 'close')
                closeToken = token;
            return token;
        },
        takeRaw: (ids, kind) => {
            if (ids.some((id) => tokens.get(id)?.source === 'manager'))
                return undefined;
            const token = ++seq;
            for (const id of ids)
                tokens.set(id, { token, source: 'raw', kind });
            return token;
        },
        takeFree: (ids, kind) => {
            const free = ids.filter((id) => !tokens.has(id));
            return free.length === 0 ? undefined : gate.takeRaw(free, kind);
        },
        release,
        leaving: () => new Set([...tokens].filter(([, t]) => t.kind !== 'other').map(([id]) => id)),
    };
    const settle = (published) => {
        for (const [id, t] of tokens)
            if (t.token <= published)
                tokens.delete(id);
        if (closeToken <= published)
            closeToken = 0;
    };
    return { gate, settle };
}
