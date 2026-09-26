/**
 * Compile-only proof that useViewState<T>'s generic actually enforces `T extends JsonValue`: a plain,
 * JSON-shaped params type (declared with `type`, not `interface`, same reason registerView.typecheck.ts
 * gives) is accepted with no cast, for both the read and the setter. Never imported by anything;
 * `tsc -p client --noEmit` type-checks it as a root file because it lives under client/src. Widening
 * useViewState's bound from `T extends JsonValue` to bare `T` in viewState.ts, then passing a non-JSON
 * value (e.g. `{ fn: () => {} }`) here, must newly compile -- proving the bound is actually enforced today
 * (see viewState.ts's own useViewState signature).
 */
import { createElement } from 'react';
import { useViewState } from './viewState.js';

type DraftParams = { readonly text: string; readonly pinned: boolean };

function DraftViewStateFixture() {
  const [draft, setDraft] = useViewState<DraftParams>('draft', { text: '', pinned: false });
  return createElement('button', { onClick: () => setDraft({ text: draft.text, pinned: !draft.pinned }) }, draft.text);
}

void DraftViewStateFixture;
