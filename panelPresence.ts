/**
 * Why a view is or is not drawn: one hook that reads the four facts a view cannot otherwise see (exiting, closing,
 * parked, scrolled away) and names the one that holds.
 */
import * as React from 'react';
import { useIsPresent } from 'motion/react';
import { AwayContext } from './panelAway.js';
import { PanelSlotContext } from './panelSlotContext.js';

/**
 * Why a view is or is not drawn: `shown` (drawn in the window), `exiting` (drawn, and on its way out for a reason
 * the other values do not name), `closing` (a person or code is closing it), `parked` (it is parked and leaves the
 * row) or `scrolledAway` (the row is scrolled so its slot is outside the window).
 * @public
 */
export type PanelPresenceReason = 'shown' | 'exiting' | 'closing' | 'parked' | 'scrolledAway';

/**
 * What a view reads of its own presence. `shown` is true for `shown` and `exiting`; when more than one reason holds,
 * `reason` names the first of `closing`, `parked`, `scrolledAway`, `exiting`, `shown` that does.
 * @public
 */
export interface PanelPresence {
  /** Whether the view is drawn in the window now. */
  readonly shown: boolean;
  /** The reason, as {@link PanelPresenceReason}. */
  readonly reason: PanelPresenceReason;
}

const NO_SUBSCRIPTION = (): (() => void) => () => {};
const NEVER = (): boolean => false;

/**
 * The presence of the panel this view draws, read-only and live: it re-renders the view when the reason changes. Outside
 * a row the reason is `shown`, since nothing can close, park or scroll a view that no row draws.
 * @public
 */
export function usePanelPresence(): PanelPresence {
  const slot = React.useContext(PanelSlotContext);
  const awayStore = React.useContext(AwayContext);
  const handle = slot?.handle;
  const id = slot?.id;
  const present = useIsPresent();
  const parked = React.useSyncExternalStore(handle === undefined ? NO_SUBSCRIPTION : handle.subscribe, handle === undefined ? NEVER : () => handle.getState().status === 'parked', NEVER);
  const away = React.useSyncExternalStore(
    awayStore === undefined || id === undefined ? NO_SUBSCRIPTION : (listener) => awayStore.subscribe(id, listener),
    awayStore === undefined || id === undefined ? NEVER : () => awayStore.has(id),
    NEVER,
  );
  const closing = slot?.closing === true;
  const reason: PanelPresenceReason = closing ? 'closing' : parked ? 'parked' : away ? 'scrolledAway' : !present ? 'exiting' : 'shown';
  return { shown: reason === 'shown' || reason === 'exiting', reason };
}
