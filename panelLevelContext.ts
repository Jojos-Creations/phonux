import * as React from 'react';

/** The panel API level of the template whose view is rendering; undefined outside a template's view. @internal */
export const PanelLevelContext = React.createContext<number | undefined>(undefined);
