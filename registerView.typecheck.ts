/**
 * Compile-only proof that a View typed with `ViewProps<P>`, where `P` is declared with `type` (not
 * `interface`), registers through `registerView` with no `as`/`<any>` cast. Never imported by anything;
 * `tsc -p client --noEmit` type-checks it as a root file because it lives under client/src. Reverting
 * `registerView` to its old non-generic signature must fail this file with TS2345 (see panelRegistry.tsx).
 */
import { createElement } from 'react';
import { registerView, type ViewProps } from './panelRegistry.js';

type NotesParams = { readonly noteId: string };

function NotesViewFixture({ panel }: ViewProps<NotesParams>) {
  return createElement('span', null, panel.params?.noteId);
}

registerView('__typecheck_notes_view__', NotesViewFixture);
