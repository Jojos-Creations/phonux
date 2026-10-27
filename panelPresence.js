/**
 * Why a view is or is not drawn: one hook that reads the four facts a view cannot otherwise see (exiting, closing,
 * parked, scrolled away) and names the one that holds.
 */
import * as React from 'react';
import { useIsPresent } from 'motion/react';
import { AwayContext } from './panelAway.js';
import { PanelSlotContext } from './panelSlotContext.js';
const NO_SUBSCRIPTION = () => () => { };
const NEVER = () => false;
/**
 * The presence of the panel this view draws, read-only and live: it re-renders the view when the reason changes. Outside
 * a row the reason is `shown`, since nothing can close, park or scroll a view that no row draws.
 * @public
 */
export function usePanelPresence() {
    const slot = React.useContext(PanelSlotContext);
    const awayStore = React.useContext(AwayContext);
    const handle = slot?.handle;
    const id = slot?.id;
    const present = useIsPresent();
    const parked = React.useSyncExternalStore(handle === undefined ? NO_SUBSCRIPTION : handle.subscribe, handle === undefined ? NEVER : () => handle.getState().status === 'parked', NEVER);
    const away = React.useSyncExternalStore(awayStore === undefined || id === undefined ? NO_SUBSCRIPTION : (listener) => awayStore.subscribe(id, listener), awayStore === undefined || id === undefined ? NEVER : () => awayStore.has(id), NEVER);
    const closing = slot?.closing === true;
    const reason = closing ? 'closing' : parked ? 'parked' : away ? 'scrolledAway' : !present ? 'exiting' : 'shown';
    return { shown: reason === 'shown' || reason === 'exiting', reason };
}
