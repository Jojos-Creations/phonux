import { type LevelTable } from './panelApiLevel.js';
import type { PanelTemplate } from './panelTemplate.js';
import { type ViewComponent } from './viewRegistry.js';
/**
 * The component that renders `t` inside a row: it reads the row's workspace from context and renders `t.view` with the
 * panel, its own read handle and the reader of every panel. Outside a row that has a workspace there is no handle to
 * give, so it renders the unregistered-view placeholder.
 * @internal
 */
export declare function templateViewFor(t: PanelTemplate, table?: LevelTable): ViewComponent;
/** The component a row draws for `key`: the workspace's template for it, else the placeholder. @internal */
export declare function resolveViewIn(templateOf: (id: string) => PanelTemplate | undefined, key: string): ViewComponent;
