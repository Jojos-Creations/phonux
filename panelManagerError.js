/**
 * Why a panel operation was refused, and the error a programmer mistake throws. A leaf module: the settings
 * resolver throws from here, and nothing in this file imports another one.
 */
/**
 * A programmer error: a template, option or settings layer that can never be valid. `layer` and `key` name the
 * offending settings layer and catalog name when the code is 'invalid-settings'.
 * @public
 */
export class PanelManagerError extends Error {
    /** Why the error was thrown. */
    code;
    /** The offending settings layer when the code is 'invalid-settings'. */
    layer;
    /** The offending catalog name when the code is 'invalid-settings'. */
    key;
    /**
     * @param code - Why the error is thrown.
     * @param message - Human-readable detail, as `Error.message`.
     * @param where - The settings layer and catalog name at fault, for code 'invalid-settings'.
     */
    constructor(code, message, where = {}) {
        super(message);
        this.name = 'PanelManagerError';
        this.code = code;
        this.layer = where.layer;
        this.key = where.key;
    }
}
