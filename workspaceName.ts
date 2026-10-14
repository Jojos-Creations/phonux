/** The longest workspace name, in characters. @public */
export const MAX_WORKSPACE_NAME = 60;

/** The name a workspace has when none was given. @internal */
export const DEFAULT_WORKSPACE_NAME = 'Workspace';

/** `raw` trimmed and cut to `MAX_WORKSPACE_NAME` characters, or undefined when nothing is left of it or it is no string. @internal */
export function cleanWorkspaceName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = Array.from(raw.trim()).slice(0, MAX_WORKSPACE_NAME).join('').trim();
  return trimmed === '' ? undefined : trimmed;
}
