/**
 * The generic header buttons a panel declares in `headerButtons`: the hook that lists them, the component that draws
 * them as MUI IconButtons (icon form) or Buttons (text form), and the press path that runs the developer's `onClick`.
 */
import * as React from 'react';
import { useIsPresent } from 'motion/react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { HeaderButton, HeaderButtonContext } from './panelSettings.js';
import type { ViewHandle } from './panelTemplate.js';
import { PanelLevelContext } from './panelLevelContext.js';
import { reportItemShapeOnce } from './panelLevelChecks.js';
import { PanelSlotContext, type HeaderButtonsSlot } from './panelSlotContext.js';

/** What every listed header button has, whichever form it takes. @public */
export interface PanelHeaderButtonItemBase {
  /** The slot id. */
  readonly id: string;
  /** The accessible name; in the text form also the text drawn. */
  readonly label: string;
  /** Which end of the header row the button sits at. */
  readonly side: 'start' | 'end';
  /** The sort position among the buttons on the same side; ties break by id. */
  readonly order: number;
  /** Whether the button shows as pressed; undefined for a slot that declares no `pressed`. */
  readonly pressed: boolean | undefined;
  /** Whether the button is disabled: it stays focusable and a press does nothing. */
  readonly disabled: boolean;
  /** Whether the button is left out of the drawn cluster. */
  readonly hidden: boolean;
  /** Longer help text, or undefined. */
  readonly description: string | undefined;
  /** Tooltip text, or undefined. */
  readonly tooltip: string | undefined;
  /** Extra styles for the drawn button. */
  readonly sx: HeaderButton['sx'];
  /** Runs the slot's `onClick` as the person's gesture; does nothing while disabled, hidden or while the panel is leaving. */
  press(): void;
}

/** A listed button of the icon form: `icon` is what the slot's icon resolved to, null included. @public */
export interface PanelHeaderIconItem extends PanelHeaderButtonItemBase {
  /** Marks the icon form. */
  readonly form: 'icon';
  /** The icon to draw. */
  readonly icon: React.ReactNode;
}

/** A listed button of the text form: it draws its label as text and has no icon. @public */
export interface PanelHeaderTextItem extends PanelHeaderButtonItemBase {
  /** Marks the text form. */
  readonly form: 'text';
  /** Always undefined in the text form. */
  readonly icon: undefined;
}

/** One declared header button as `usePanelHeaderButtons` lists it, its functions already evaluated for the panel's current state; `form` tells the two forms apart. @public */
export type PanelHeaderButtonItem = PanelHeaderIconItem | PanelHeaderTextItem;

const NONE: readonly PanelHeaderButtonItem[] = [];
const NO_SUBSCRIBE = (): (() => void) => () => {};

/** The attribute that marks a header row of a panel with declared buttons, and holds the panel's id. */
export const HEADER_ROW_ATTRIBUTE = 'data-header-buttons-row';

interface Runtime {
  /** Failures already delivered as notes, so one failure is one note. */
  readonly noted: Set<string>;
  readonly buttons: Map<string, HTMLElement>;
  text: string | undefined;
  readonly listeners: Set<() => void>;
  /** The slot that held focus when it was pressed, and where its header row stood among all of them. */
  pending: { id: string; index: number; row: HTMLElement | null; done: boolean } | undefined;
  /** The header row of a focused slot that left the document without being pressed, or undefined. */
  lost: { row: HTMLElement | null } | undefined;
  /** The button focus last rested on, which keeps the tab stop while it stays enabled. */
  current: string | undefined;
  /** The one button in the tab order, or undefined until the first layout settles. */
  stop: string | undefined;
  readonly stopListeners: Set<() => void>;
}

const RUNTIMES = new WeakMap<object, Runtime>();

function runtimeOf(handle: object): Runtime {
  let runtime = RUNTIMES.get(handle);
  if (runtime === undefined) {
    runtime = { noted: new Set(), buttons: new Map(), text: undefined, listeners: new Set(), pending: undefined, lost: undefined, current: undefined, stop: undefined, stopListeners: new Set() };
    RUNTIMES.set(handle, runtime);
  }
  return runtime;
}

/** The panel's buttons in document order, as [id, element]. */
function orderedButtons(runtime: Runtime): [string, HTMLElement][] {
  return [...runtime.buttons.entries()].sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

const isDisabled = (el: HTMLElement): boolean => el.getAttribute('aria-disabled') === 'true';

/** The buttons arrow keys and the tab stop can rest on: the enabled ones, or all of them when none is. */
function reachable(runtime: Runtime): [string, HTMLElement][] {
  const all = orderedButtons(runtime);
  const enabled = all.filter(([, el]) => !isDisabled(el));
  return enabled.length > 0 ? enabled : all;
}

/** Puts the tab stop on the button focus last rested on, or on the first reachable one. */
function syncTabStop(runtime: Runtime): void {
  const pool = reachable(runtime);
  const next = (pool.find(([id]) => id === runtime.current) ?? pool[0])?.[0];
  if (next === runtime.stop) return;
  runtime.stop = next;
  for (const l of [...runtime.stopListeners]) l();
}

/** Arrow, Home and End move focus along the buttons; the row is one tab stop. */
function rove(runtime: Runtime, from: string, key: string): boolean {
  const pool = reachable(runtime);
  const at = pool.findIndex(([id]) => id === from);
  const to = key === 'Home' ? 0 : key === 'End' ? pool.length - 1 : key === 'ArrowRight' ? at + 1 : key === 'ArrowLeft' ? at - 1 : -1;
  if (to < 0 || to >= pool.length || to === at) return key === 'Home' || key === 'End' || key === 'ArrowRight' || key === 'ArrowLeft';
  pool[to]![1].focus({ preventScroll: true });
  return true;
}

function announceTo(runtime: Runtime, text: string): void {
  runtime.text = text;
  for (const l of [...runtime.listeners]) l();
}

/** Where a verb's `source` argument sits, so a call in the press can default it to the person. */
const SOURCE_AT: Readonly<Record<string, number>> = { show: 0, hide: 0, toggleVisibility: 0, close: 0, open: 0, move: 1, place: 1, setSlots: 1, scrollTo: 1, pin: 0, unpin: 0 };

/** The panel's handle with every verb defaulting to the person while `inGesture()` holds, and to code after. */
function gestureHandle(base: ViewHandle, inGesture: () => boolean): ViewHandle {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const member = (base as unknown as Record<string, unknown>)[key];
    const at = SOURCE_AT[key];
    if (typeof member !== 'function' || at === undefined) {
      out[key] = member;
      continue;
    }
    out[key] = (...args: unknown[]): unknown => {
      const call = Array.from({ length: at }, (_, k) => args[k]);
      call[at] = args[at] ?? (inGesture() ? 'person' : 'code');
      return (member as (...a: unknown[]) => unknown)(...call);
    };
  }
  return out as unknown as ViewHandle;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

const fieldOf = <T,>(v: T | ((c: HeaderButtonContext) => T), c: HeaderButtonContext): T => (typeof v === 'function' ? (v as (c: HeaderButtonContext) => T)(c) : v);

interface Failure {
  readonly id: string;
  readonly message: string;
}

/** The header rows of panels that are still staying; a leaving panel's row is inert and no focus target. */
function headerRows(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(`[${HEADER_ROW_ATTRIBUTE}]:not([inert])`)];
}

/**
 * The header buttons the panel above declares, sorted start side first, then by order, then by id; empty outside a row slot.
 * @public
 */
export function usePanelHeaderButtons(): readonly PanelHeaderButtonItem[] {
  const given = React.useContext(PanelSlotContext)?.headerButtonSlots;
  const present = useIsPresent();
  const handle = given?.handle;
  const level = React.useContext(PanelLevelContext);
  const runtime = handle === undefined ? undefined : runtimeOf(handle);
  const state = React.useSyncExternalStore(handle?.subscribe ?? NO_SUBSCRIBE, () => handle?.getState(), () => handle?.getState());

  const items: PanelHeaderButtonItem[] = [];
  const failures: Failure[] = [];
  if (given !== undefined && handle !== undefined && runtime !== undefined && state !== undefined) {
    const c: HeaderButtonContext = { state, settings: handle.getSettings().value };
    for (const id of Object.keys(given.slots)) {
      const slot = given.slots[id]!;
      try {
        const label = fieldOf(slot.label, c);
        if (typeof label !== 'string' || label === '') throw new Error('its label is empty');
        const pressed = slot.pressed === undefined ? undefined : Boolean(slot.pressed(c));
        const disabled = Boolean(fieldOf(slot.disabled ?? false, c));
        const hidden = Boolean(fieldOf(slot.hidden ?? false, c));
        const description = slot.description === undefined ? undefined : fieldOf(slot.description, c);
        const tooltip = slot.tooltip === undefined ? undefined : fieldOf(slot.tooltip, c);
        const common = {
          id,
          label,
          side: slot.side ?? 'end',
          order: slot.order ?? 0,
          pressed,
          disabled,
          hidden,
          description,
          tooltip,
          sx: slot.sx,
          press: () => pressSlot(given, runtime, id, slot, c, { present, disabled, hidden }),
        };
        if (slot.icon === undefined) items.push({ ...common, form: 'text', icon: undefined });
        else items.push({ ...common, form: 'icon', icon: typeof slot.icon === 'function' ? (slot.icon as (c: HeaderButtonContext) => React.ReactNode)(c) : slot.icon });
      } catch (e) {
        failures.push({ id, message: `header button '${id}': ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    items.sort((a, b) => (a.side === b.side ? a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.side === 'start' ? -1 : 1));
    reportItemShapeOnce(handle.templateId, level, items);
  }

  // A failure is told once; it is told again only after the slot has evaluated cleanly in between.
  const failureKeys = failures.map((f) => `${f.id}\u0000${f.message}`).join('\u0001');
  React.useEffect(() => {
    if (given === undefined || runtime === undefined || handle === undefined) return;
    const current = new Set(failures.map((f) => `${f.id}\u0000${f.message}`));
    for (const key of [...runtime.noted]) if (key.startsWith('eval\u0000') && !current.has(key.slice(5))) runtime.noted.delete(key);
    for (const f of failures) {
      const key = `eval\u0000${f.id}\u0000${f.message}`;
      if (runtime.noted.has(key)) continue;
      runtime.noted.add(key);
      given.note({ code: 'header-button-error', panelId: handle.id, key: 'headerButtons', message: f.message });
    }
  }, [failureKeys]);

  // The row of a panel on its way out takes no more presses or focus; React does not own this attribute.
  React.useEffect(() => {
    if (present || handle === undefined) return;
    const doc = typeof document === 'undefined' ? undefined : document;
    for (const row of doc?.querySelectorAll(`[${HEADER_ROW_ATTRIBUTE}]`) ?? []) if (row.getAttribute(HEADER_ROW_ATTRIBUTE) === handle.id) row.setAttribute('inert', '');
  }, [present]);

  // After a commit that moved or removed the button that had focus, focus goes back to it or, failing that, to a header row.
  React.useEffect(() => {
    if (given === undefined || handle === undefined || runtime === undefined) return;
    if (runtime.pending === undefined && runtime.lost === undefined) return;
    const pending = runtime.pending;
    const lostRow = runtime.lost?.row;
    const doc = (runtime.buttons.values().next().value as HTMLElement | undefined)?.ownerDocument ?? (typeof document === 'undefined' ? undefined : document);
    if (doc === undefined) return;
    const active = doc.activeElement;
    const ownsActive = active !== null && [...runtime.buttons.values()].includes(active as HTMLElement);
    if (active !== null && active !== doc.body && !ownsActive) {
      runtime.pending = undefined;
      runtime.lost = undefined;
      return;
    }
    const rows = headerRows(doc);
    const own = rows.find((r) => r.getAttribute(HEADER_ROW_ATTRIBUTE) === handle.id);
    // The press that closes or parks its own panel commits its state after the render that first sees the press, so a pending press outlives the refocus below.
    if (!present || (state !== undefined && state.status !== 'live')) {
      runtime.pending = undefined;
      runtime.lost = undefined;
      const others = rows.filter((r) => r !== own);
      const at = pending?.index ?? (own === undefined ? 0 : rows.indexOf(own));
      (others[at] ?? others[at - 1])?.focus({ preventScroll: true });
      return;
    }
    runtime.lost = undefined;
    if (pending !== undefined) {
      if (pending.done) return;
      pending.done = true;
    }
    const button = pending === undefined ? undefined : runtime.buttons.get(pending.id);
    // Called even when the button still holds focus: a browser drops focus from a node a reorder moves, a test DOM does not.
    if (button?.isConnected) {
      button.focus({ preventScroll: true });
      return;
    }
    // A row that carries no tabindex because every slot is now hidden still has to take the focus.
    const row = pending?.row ?? lostRow ?? own;
    if (row?.isConnected) {
      if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
      row.focus({ preventScroll: true });
    }
  });

  if (given === undefined) return NONE;
  return items;
}

function pressSlot(
  given: HeaderButtonsSlot,
  runtime: Runtime,
  id: string,
  slot: HeaderButton,
  c: HeaderButtonContext,
  now: { present: boolean; disabled: boolean; hidden: boolean },
): void {
  if (!now.present || now.disabled || now.hidden) return;
  const button = runtime.buttons.get(id);
  if (button !== undefined && button.ownerDocument.activeElement === button) {
    const rows = headerRows(button.ownerDocument);
    const own = button.closest(`[${HEADER_ROW_ATTRIBUTE}]`);
    runtime.pending = { id, index: own === null ? 0 : rows.indexOf(own as HTMLElement), row: own as HTMLElement | null, done: false };
  }
  let inGesture = true;
  const handle = gestureHandle(given.handle, () => inGesture);
  let result: unknown;
  try {
    result = slot.onClick(handle, { ...c, announce: (text) => announceTo(runtime, text) });
  } catch (e) {
    given.report(e);
  } finally {
    inGesture = false;
  }
  if (isThenable(result)) result.then(undefined, (e: unknown) => given.report(e));
}

/** Hides only the slot whose icon element throws while rendering, and tells the workspace once. */
class SlotBoundary extends React.Component<{ id: string; onCaught: (id: string, e: unknown) => void; children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(e: unknown): void {
    this.props.onCaught(this.props.id, e);
  }
  override render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function SlotButton({ item, runtime }: { item: PanelHeaderButtonItem; runtime: Runtime }): React.ReactElement {
  const described = React.useId();
  const el = React.useRef<HTMLElement | null>(null);
  const stop = React.useSyncExternalStore(
    (l) => {
      runtime.stopListeners.add(l);
      return () => void runtime.stopListeners.delete(l);
    },
    () => runtime.stop,
    () => undefined,
  );
  React.useLayoutEffect(() => {
    const id = item.id;
    return () => {
      const node = el.current;
      if (node !== null && node.ownerDocument.activeElement === node && runtime.pending === undefined) runtime.lost = { row: node.closest<HTMLElement>(`[${HEADER_ROW_ATTRIBUTE}]`) };
      if (runtime.buttons.get(id) === node) runtime.buttons.delete(id);
    };
  }, [item.id]);
  const text = item.form === 'text';
  const label = React.useRef<HTMLSpanElement | null>(null);
  const [clipped, setClipped] = React.useState(false);
  // A truncated label has no other way to be read in full, so it becomes the tooltip when no tooltip is declared.
  React.useLayoutEffect(() => {
    const span = label.current;
    if (!text || span === null) return undefined;
    const measure = (): void => setClipped(span.scrollWidth > span.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(span);
    return () => observer.disconnect();
  }, [text, item.label]);
  const color = item.sx === undefined ? { color: 'inherit' } : [{ color: 'inherit' }, item.sx];
  const base = Array.isArray(color) ? color : [color];
  const sx = text
    ? [...base, { textTransform: 'none', minWidth: 0, minHeight: 24, maxWidth: '9em', fontSize: 'inherit' }, ...(item.disabled ? [{ opacity: 0.38, cursor: 'default' }] : [])]
    : item.disabled
      ? [...base, { opacity: 0.38, cursor: 'default' }]
      : (color as never);
  const shared = {
    size: 'small' as const,
    'aria-label': item.label,
    onClick: () => item.press(),
    tabIndex: stop === undefined || stop === item.id ? 0 : -1,
    onFocus: () => {
      runtime.current = item.id;
      syncTabStop(runtime);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (rove(runtime, item.id, e.key)) e.preventDefault();
    },
    sx: sx as never,
    ref: (node: HTMLButtonElement | null) => {
      el.current = node;
      if (node !== null) runtime.buttons.set(item.id, node);
    },
    ...(item.pressed === undefined ? {} : { 'aria-pressed': item.pressed }),
    ...(item.disabled ? { 'aria-disabled': true } : {}),
    ...(item.description === undefined ? {} : { 'aria-describedby': described }),
  };
  const button = text ? (
    <Button {...shared} color="inherit">
      <span ref={label} data-header-button-text="" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
    </Button>
  ) : (
    <IconButton {...shared}>{item.icon}</IconButton>
  );
  return (
    <>
      {text ? <Tooltip title={item.tooltip ?? (clipped ? item.label : '')}>{button}</Tooltip> : item.tooltip === undefined ? button : <Tooltip title={item.tooltip}>{button}</Tooltip>}
      {item.description === undefined ? null : (
        <span hidden id={described}>
          {item.description}
        </span>
      )}
    </>
  );
}

const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } as const;

/**
 * Draws the panel's header buttons: all of them in order, or only those of one `side`. The polite status region
 * that `announce` writes to is the last child of the end side, or of the whole cluster. Outside a row slot, or with
 * nothing to draw, it draws nothing.
 * @public
 */
export function PanelHeaderButtons({ side }: { side?: 'start' | 'end' }): React.ReactElement | null {
  const items = usePanelHeaderButtons();
  const handle = React.useContext(PanelSlotContext)?.headerButtonSlots?.handle;
  const given = React.useContext(PanelSlotContext)?.headerButtonSlots;
  const runtime = handle === undefined ? undefined : runtimeOf(handle);
  const text = React.useSyncExternalStore(
    (l) => {
      runtime?.listeners.add(l);
      return () => void runtime?.listeners.delete(l);
    },
    () => runtime?.text,
    () => runtime?.text,
  );
  // After every render of a cluster, so a button added, removed, disabled or enabled moves the one tab stop if it must.
  React.useLayoutEffect(() => {
    if (runtime !== undefined) syncTabStop(runtime);
  });
  if (runtime === undefined || given === undefined || handle === undefined) return null;
  const shown = items.filter((i) => !i.hidden && (side === undefined || i.side === side));
  const status = side !== 'start' && text !== undefined ? (
    <span role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
      {text}
    </span>
  ) : null;
  if (shown.length === 0 && status === null) return null;
  const caught = (id: string, e: unknown): void => {
    const message = `header button '${id}': ${e instanceof Error ? e.message : String(e)}`;
    const key = `render\u0000${id}\u0000${message}`;
    if (runtime.noted.has(key)) return;
    runtime.noted.add(key);
    given.note({ code: 'header-button-error', panelId: handle.id, key: 'headerButtons', message });
  };
  return (
    <>
      {shown.map((item) => (
        <SlotBoundary key={item.id} id={item.id} onCaught={caught}>
          <SlotButton item={item} runtime={runtime} />
        </SlotBoundary>
      ))}
      {status}
    </>
  );
}

/** What PanelRow puts in the slot context for an entry: its resolved slots with its handle, or nothing when it declares none. @internal */
export function headerButtonsOf(
  slots: HeaderButtonsSlot['slots'],
  handle: ViewHandle | undefined,
  report: HeaderButtonsSlot['report'],
  note: HeaderButtonsSlot['note'],
): HeaderButtonsSlot | undefined {
  return handle === undefined || Object.keys(slots).length === 0 ? undefined : { slots, handle, report, note };
}
