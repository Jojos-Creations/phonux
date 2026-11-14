/** The longest workspace name, in characters. @public */
export declare const MAX_WORKSPACE_NAME = 60;
/** The name a workspace has when none was given. @internal */
export declare const DEFAULT_WORKSPACE_NAME = "Space";
/** `raw` trimmed and cut to `MAX_WORKSPACE_NAME` characters, or undefined when nothing is left of it or it is no string. @internal */
export declare function cleanWorkspaceName(raw: unknown): string | undefined;
