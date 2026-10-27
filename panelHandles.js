/** The read handle of panel `id` built from `templateId`: exactly the read members. @internal */
export function makeHandle(source, id, templateId) {
    return {
        id,
        templateId,
        getState: () => source.stateOf(id),
        getSettings: () => source.settingsOf(id),
        subscribe: (l) => source.subscribePanel(id, l),
    };
}
/** The handle of panel `id` built from `templateId`: the read members and every operation. @internal */
export function makeViewHandle(source, id, templateId) {
    return {
        id,
        templateId,
        getState: () => source.stateOf(id),
        getSettings: () => source.settingsOf(id),
        subscribe: (l) => source.subscribePanel(id, l),
        show: (src = 'code') => source.operate(id, { verb: 'show' }, src),
        hide: (src = 'code') => source.operate(id, { verb: 'hide' }, src),
        toggleVisibility: (src = 'code') => source.operate(id, { verb: 'toggleVisibility' }, src),
        close: (src = 'code') => source.operate(id, { verb: 'close' }, src),
        open: (src = 'code') => source.operate(id, { verb: 'open' }, src),
        move: (by, src = 'code') => source.operate(id, { verb: 'move', by }, src),
        place: (value, src = 'code') => source.operate(id, { verb: 'place', value }, src),
        setSlots: (slots, src = 'code') => source.operate(id, { verb: 'setSlots', slots }, src),
        scrollTo: (align, src = 'code') => source.operate(id, { verb: 'scrollTo', align }, src),
        configure: (patch) => source.configure(id, patch, 'panel'),
    };
}
/** The handle panel `id`'s own view receives: the operable handle with a `configure` that takes only what a view may set. @internal */
export function makeOwnHandle(source, id, templateId) {
    return { ...makeViewHandle(source, id, templateId), configure: (patch) => source.configure(id, patch, 'view') };
}
/** `states` kept by `f`: a field left out keeps everything on that field. @internal */
export function filterStates(states, f) {
    if (f === undefined)
        return states;
    const wanted = f.status === undefined ? undefined : Array.isArray(f.status) ? f.status : [f.status];
    return states.filter((s) => (wanted === undefined || wanted.includes(s.status)) && (f.listed === undefined || s.listed === f.listed));
}
/** The reader a template's view receives: exactly get, list, getSnapshot and subscribe. @internal */
export function makeReader(source) {
    return {
        get: (id) => source.readHandleOf(id),
        list: (f) => filterStates(source.getSnapshot().panels, f),
        getSnapshot: () => source.getSnapshot(),
        subscribe: (l) => source.subscribe(l),
    };
}
