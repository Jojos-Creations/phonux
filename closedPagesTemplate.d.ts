import { type PanelTemplate } from './panelTemplate.js';
import type { ClosedPageEntry } from './hostApi.js';
import type { ClosedPagesList } from './closedPagesList.js';
/**
 * The options of `createClosedPagesTemplate`.
 * @public
 */
export interface ClosedPagesTemplateOptions {
    /** The list the panel shows, from `useClosedPages`. */
    readonly list: ClosedPagesList;
    /** Called with the entry the person chose to reopen. */
    readonly onReopen: (entry: ClosedPageEntry) => void;
    /** The template id. Default `closed-pages`. */
    readonly id?: string;
    /** The panel's title. Default: the `closedPagesTitle` label. */
    readonly title?: string;
}
/**
 * A panel template that shows the closed pages, with the settings a closed-pages log uses (closable, one at a time,
 * host-creatable). Add it to a workspace's `templates` like any other template.
 * @example
 * ```ts
 * const closedPages = createClosedPagesTemplate({ list: closed, onReopen: (entry) => openPage(entry.url) });
 * ```
 * @public
 */
export declare function createClosedPagesTemplate({ list, onReopen, id, title }: ClosedPagesTemplateOptions): PanelTemplate;
