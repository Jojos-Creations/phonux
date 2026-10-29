/**
 * The one polite live region of a workspace: the Workspace renders it and a control that acts without a visible change
 * (a key that moves or closes a panel) says what it did through this context.
 */
import * as React from 'react';
/** Says `text` in the workspace's polite live region; undefined outside a Workspace. @internal */
export const AnnounceContext = React.createContext(undefined);
