/**
 * Compile-only: a View typed `ViewProps<P>`, with `P` declared by `type`, registers through `registerView`
 * with no cast; a non-generic `registerView` fails here with TS2345. Nothing imports this file; `npm run typecheck`
 * checks it as a root file.
 */
import { createElement } from 'react';
import { registerView, type ViewProps } from './viewRegistry.js';

type NotesParams = { readonly noteId: string };

function NotesViewFixture({ panel }: ViewProps<NotesParams>) {
  return createElement('span', null, panel.params?.noteId);
}

registerView('__typecheck_notes_view__', NotesViewFixture);
