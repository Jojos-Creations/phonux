/**
 * Compile-only proof of useViewState's types. Never imported by anything; `tsc -p client --noEmit` type-checks
 * it as a root file because it lives under client/src. `DraftParams` is declared with `type`, not `interface`,
 * for the same reason registerView.typecheck.ts gives.
 *
 * JSON bound: widening either check in viewState.ts (the second overload's `T extends JsonValue`, or the
 * first overload's `[T] extends [JsonValue]` on `key`) and adding `useViewState('k', { fn: () => {} })` here
 * must newly compile. useState parity: each `Same` below stops compiling if useViewState infers a different
 * type than React.useState does from the same argument, and the @ts-expect-error stops compiling (TS2578) if
 * an explicit literal-union type argument is ever widened.
 */
import { createElement, useState } from 'react';
import { useViewState } from './viewState.js';

type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;

type DraftParams = { readonly text: string; readonly pinned: boolean };

function DraftViewStateFixture() {
  const [draft, setDraft] = useViewState<DraftParams>('draft', { text: '', pinned: false });
  return createElement('button', { onClick: () => setDraft({ text: draft.text, pinned: !draft.pinned }) }, draft.text);
}

type Status = 'idle' | 'loading' | 'done';

function StatusViewStateFixture() {
  const [status, setStatus] = useViewState<Status>('status', 'idle');
  // @ts-expect-error an explicit literal union is kept exactly, as useState<Status> keeps it
  const reject = () => setStatus('nonsense-value');
  return createElement('button', { onClick: () => setStatus(status === 'idle' ? 'loading' : 'done'), onBlur: reject }, status);
}

function ParityViewStateFixture({ declared }: { declared: Status }) {
  const count = useViewState('count', 0);
  const countViaUseState = useState(0);
  const flags = useViewState('flags', { open: true, tabs: [1, 2] });
  const flagsViaUseState = useState({ open: true, tabs: [1, 2] });
  const kept = useViewState('kept', declared);
  const keptViaUseState = useState(declared);
  const parity: [
    Same<typeof count, typeof countViaUseState>,
    Same<typeof flags, typeof flagsViaUseState>,
    Same<typeof kept, typeof keptViaUseState>,
  ] = [true, true, true];
  count[1]((n) => n + 1);
  return createElement('span', null, String(parity), String(flags[0].open), kept[0]);
}

void DraftViewStateFixture;
void StatusViewStateFixture;
void ParityViewStateFixture;
