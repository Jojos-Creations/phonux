/**
 * The shapes of the three configure calls. Nothing here runs: `npm run typecheck` compiles it, and a key at the wrong
 * call must fail to compile before it can answer `wrong-scope` at run time.
 */
import type { ConfigureResult, InstancePatch, PanelHandle, PanelManager, ViewHandle, ViewPatch, WorkspaceTuning } from '../index.js';

declare const manager: PanelManager;
declare const handle: PanelHandle;
declare const view: ViewHandle;

const onPanel: ConfigureResult = manager.configure('a', { closable: false, tuning: { slide: { durationSec: 0.2 } }, title: null });
const onHandle: ConfigureResult = handle.configure({ scrollOnOpen: 'center' });
const onTemplate: ConfigureResult = manager.configureTemplate('t', { hostCreatable: true, multiple: null, maxInstances: 3 });
const onTuning: ConfigureResult = manager.configureTuning({ rowGap: 20, slide: null, initialScroll: { panel: 'a' } });
const onView: ConfigureResult = view.configure({ title: 'x', placeOnAdd: { anchor: { panel: 'a', position: 'left' } }, enterFrom: 'anchor' });

// @ts-expect-error a template key is not an InstancePatch key
manager.configure('a', { hostCreatable: true });
// @ts-expect-error a template key is not an InstancePatch key
handle.configure({ maxInstances: 2 });
// @ts-expect-error the template call takes only the three template keys
manager.configureTemplate('t', { closable: false });
// @ts-expect-error the tuning call takes only tuning keys
manager.configureTuning({ closable: false });
// @ts-expect-error a view may not ask for closable
view.configure({ closable: false });
// @ts-expect-error a view may place itself only by an anchor
view.configure({ placeOnAdd: 'row-start' });
const patch: InstancePatch = {};
const viewPatch: ViewPatch = {};
const tuning: WorkspaceTuning = {};

export type Probe = [typeof onPanel, typeof onHandle, typeof onTemplate, typeof onTuning, typeof onView, typeof patch, typeof viewPatch, typeof tuning];
