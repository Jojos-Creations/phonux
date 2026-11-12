import { filterStates } from './panelHandles.js';
/** An accepted operation. @internal */
export const accepted = (changed) => ({ ok: true, changed });
/** A refusal; the caller has touched nothing. @internal */
export const refused = (code, message) => ({ ok: false, code, message });
/** The manager over `source`. @internal */
export function makePanelManager(source) {
    return {
        get: (id) => source.handleOf(id),
        list: (f) => filterStates(source.getSnapshot().panels, f)
            .map((s) => source.handleOf(s.id))
            .filter((h) => h !== undefined),
        configure: (id, patch) => source.configure(id, patch, 'panel'),
        configureTemplate: (templateId, patch) => source.configureTemplate(templateId, patch),
        configureTuning: (patch) => source.configureTuning(patch),
        resetLayout: (target) => source.resetLayout(target),
        swap: (show, hide = []) => source.swap(show, hide),
        rootView: () => source.rootView(),
        summonRoot: () => source.summonRoot(),
        dismissRoot: () => source.dismissRoot(),
        familyOf: (id) => source.familyOf(id),
        getSnapshot: () => source.getSnapshot(),
        subscribe: (l) => source.subscribe(l),
    };
}
