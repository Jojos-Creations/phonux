/**
 * The interfaces the header-button and configure entries import from this entry. Nothing here runs: `npm run typecheck`
 * compiles it, and a change to a shape a caller would notice stops it compiling.
 */
import type { CatalogName, PanelHandle, PanelManager, PanelRefusal, PanelResult, PinResult, PinningWhenNotLive, ResetResult } from '../index.js';
import { decidePinChange } from '../panelPin.js';
import type { PinDecision, PinStatus } from '../panelPin.js';
import type { PanelWindow } from '../panelWindow.js';

declare const entry: PanelWindow;
declare const setting: PinningWhenNotLive;
declare const status: PinStatus;

const decision: PinDecision = decidePinChange(entry, status, setting, { by: 'pin' });
const byParkable: PinDecision = decidePinChange(entry, 'closed-anonymous', 'refuse', { parkable: false });
const kind: 'apply' | 'show' | 'defer' | 'refuse' = decision.kind;
const code: PanelRefusal | undefined = byParkable.code;

declare const handle: PanelHandle;
const pinned: PinResult = handle.pin('person');
const unpinned: PinResult = handle.unpin();
const asResult: PanelResult = pinned;
const shown: boolean | undefined = pinned.shown;
const deferred: boolean | undefined = unpinned.deferred;
const named: CatalogName | undefined = pinned.setting;

declare const manager: PanelManager;
const reset: ResetResult = manager.resetLayout('all');
const one: ResetResult = manager.resetLayout('panel-id');
const lists: readonly string[] | undefined = reset.panels ?? one.parked ?? one.returned;

// There is no 'no-room' refusal: a fixed pin never needs room.
// @ts-expect-error 'no-room' is not a PanelRefusal
const noRoom: PanelRefusal = 'no-room';

export type Probe = [typeof kind, typeof code, typeof asResult, typeof shown, typeof deferred, typeof named, typeof lists, typeof noRoom];
