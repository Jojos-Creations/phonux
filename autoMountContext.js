import * as React from 'react';
/** The workspace whose auto-mounted row is rendering, so a hand-mounted row of the same workspace can be told. A module of its own: PanelRow reads it and must not load the mount. */
export const AutoMountContext = React.createContext(undefined);
