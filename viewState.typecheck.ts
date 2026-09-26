/**
 * Compile-only proof that useViewState<T>'s generic actually enforces `T extends JsonValue`: a plain,
 * JSON-shaped params type (declared with `type`, not `interface`, same reason registerView.typecheck.ts
 * gives) is accepted with no cast, for both the read and the setter. Never imported by anything;
 * `tsc -p client --noEmit` type-checks it as a root file because it lives under client/src. Widening
 * useViewState's bound from `T extends JsonValue` to bare `T` in viewState.ts, then passing a non-JSON
 * value (e.g. `{ fn: () => {} }`) here, must newly compile -- proving the bound is actually enforced today
 * (see viewState.ts's own useViewState signature).
 *
 * The second fixture below proves the companion property: a bare literal initial value still widens the
 * way `React.useState`'s does, despite the `JsonValue` bound. Replacing `Widen<T>` with bare `T` in
 * useViewState's return type (viewState.ts) must newly fail this file on `setCount(7)` (TS2345, `7` not
 * assignable to `0`) -- proving Widen<T> is load-bearing, not the JsonValue bound this file's first fixture
 * already covers.
 */
import { createElement } from 'react';
import { useViewState } from './viewState.js';

type DraftParams = { readonly text: string; readonly pinned: boolean };

function DraftViewStateFixture() {
  const [draft, setDraft] = useViewState<DraftParams>('draft', { text: '', pinned: false });
  return createElement('button', { onClick: () => setDraft({ text: draft.text, pinned: !draft.pinned }) }, draft.text);
}

function LiteralWidensViewStateFixture() {
  const [count, setCount] = useViewState('count', 0);
  return createElement('button', { onClick: () => setCount(7) }, String(count));
}

void DraftViewStateFixture;
void LiteralWidensViewStateFixture;
