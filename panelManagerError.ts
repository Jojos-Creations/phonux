/**
 * Why a panel operation was refused, and the error a programmer mistake throws. A leaf module: the settings
 * resolver throws from here, and nothing in this file imports another one.
 */

/**
 * The typed answer to an operation a panel's resolved settings or its current state do not allow. These are
 * results, never thrown.
 * @public
 */
export type PanelRefusal =
  | 'disposed'
  | 'not-attached'
  | 'not-ready'
  | 'is-pending'
  | 'is-closed'
  | 'not-live'
  | 'busy'
  | 'not-closable'
  | 'not-parkable'
  | 'not-draggable'
  | 'not-placeable'
  | 'not-resizable'
  | 'tier-not-allowed'
  | 'would-empty-row'
  | 'instance-limit'
  | 'unknown-panel'
  | 'wrong-scope'
  | 'would-reshape-row'
  | 'settings-conflict'
  | 'not-view-settable';

/**
 * The reasons a programmer error is thrown. Anything a person's action can cause is a PanelRefusal instead.
 * @public
 */
export type PanelManagerErrorCode =
  | 'invalid-template'
  | 'duplicate-template'
  | 'unknown-template'
  | 'template-collision'
  | 'root-mismatch'
  | 'invalid-options'
  | 'invalid-settings'
  | 'instance-id-required'
  | 'already-attached'
  | 'disposed';

/**
 * A programmer error: a template, option or settings layer that can never be valid. `layer` and `key` name the
 * offending settings layer and catalog name when the code is 'invalid-settings'.
 * @public
 */
export class PanelManagerError extends Error {
  readonly code: PanelManagerErrorCode;
  readonly layer: string | undefined;
  readonly key: string | undefined;

  constructor(code: PanelManagerErrorCode, message: string, where: { readonly layer?: string; readonly key?: string } = {}) {
    super(message);
    this.name = 'PanelManagerError';
    this.code = code;
    this.layer = where.layer;
    this.key = where.key;
  }
}
