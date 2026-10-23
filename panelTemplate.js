/**
 * The shapes a panel template and the read side of a panel are declared with, and `definePanel`, which checks
 * a template when it is written rather than when a workspace first meets it. No workspace exists yet at this
 * layer: these are declarations plus one validating identity function.
 */
import { reportLevelTieOnce } from './panelLevelChecks.js';
import { checkPanelApi } from './panelApiLevel.js';
import { PanelManagerError } from './panelManagerError.js';
import { resolvePanelSettings } from './panelSettings.js';
const TEMPLATE_ID_MAX = 48;
function templateIdProblem(id) {
    if (typeof id !== 'string')
        return 'must be a string';
    if (id.length < 1 || id.length > TEMPLATE_ID_MAX)
        return `must be 1 to ${TEMPLATE_ID_MAX} characters`;
    if (/\s/.test(id))
        return 'must not contain whitespace';
    if (id.includes('~'))
        return "must not contain '~', which separates a template id from an instance suffix";
    if (id.startsWith('_'))
        return "must not start with '_', which is reserved for the engine";
    if (/^[0-9]+$/.test(id))
        return 'must not be all digits';
    if (id === 'all')
        return "'all' is reserved";
    return undefined;
}
// A memo, forwardRef or lazy component is an object carrying $$typeof, not a function.
const isComponent = (view) => typeof view === 'function' || (typeof view === 'object' && view !== null && '$$typeof' in view);
/**
 * Returns the template unchanged after checking it: a valid id, a component for `view` and for `footer` when given, an `api` the library serves, and a settings layer the
 * resolver accepts on its own.
 * @throws PanelManagerError with code `invalid-template` or `invalid-settings`.
 * @public
 */
export function definePanel(t) {
    if (typeof t !== 'object' || t === null)
        throw new PanelManagerError('invalid-template', 'a template must be an object');
    const idProblem = templateIdProblem(t.id);
    if (idProblem !== undefined)
        throw new PanelManagerError('invalid-template', `template id ${JSON.stringify(t.id)} ${idProblem}`);
    if (!isComponent(t.view))
        throw new PanelManagerError('invalid-template', `template '${t.id}': view must be a React component`);
    if (t.footer !== undefined && !isComponent(t.footer))
        throw new PanelManagerError('invalid-template', `template '${t.id}': footer must be a React component`);
    checkPanelApi(t.id, t.api);
    resolvePanelSettings({ template: t.settings });
    reportLevelTieOnce(t.id, t.api, t.settings);
    return t;
}
