import * as React from 'react';
import { definePanel, type PanelTemplate } from './panelTemplate.js';
import type { ClosedPageEntry } from './hostApi.js';
import type { ClosedPagesList } from './closedPagesList.js';
import { ClosedPagesPanel } from './ClosedPagesPanel.js';

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
  /** The panel's title. Default `Closed pages`. */
  readonly title?: string;
}

/**
 * A panel template that shows the closed pages, with the settings a closed-pages log uses (closable, one at a time,
 * host-creatable). Add it to a workspace's `templates` like any other template.
 * @example
 * const closedPages = createClosedPagesTemplate({ list: closed, onReopen: (entry) => openPage(entry.url) });
 * @public
 */
export function createClosedPagesTemplate({ list, onReopen, id = 'closed-pages', title = 'Closed pages' }: ClosedPagesTemplateOptions): PanelTemplate {
  const view = (): React.ReactElement => <ClosedPagesPanel list={list} onReopen={onReopen} />;
  return definePanel({
    id,
    view,
    settings: {
      title,
      multiple: false,
      hostCreatable: true,
      overflow: 'park',
      capacityReturn: 'manual',
      revealOnScroll: 'never',
      showWhenClosed: 'reopen',
    },
  });
}
