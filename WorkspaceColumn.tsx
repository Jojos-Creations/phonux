/**
 * The column component: every workspace of a `WorkspaceColumnHandle` in a cell of its own, one above the other, with the current
 * one in view. The person moves by ArrowUp/ArrowDown and by the buttons at the top and bottom centre, which name the neighbour
 * or offer to create one; the column itself never scrolls under a wheel or a trackpad. DESIGN.md, "The workspace column".
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import { slideToTransition } from './directionalTransition.js';
import { resolveLabels } from './labels.js';
import { DRAGGING_ATTRIBUTE } from './panelChrome.js';
import { resolveWorkspaceTuning } from './panelTuning.js';
import { columnCoreOf, type WorkspaceColumnHandle } from './columnHandle.js';
import type { WorkspaceHandle } from './workspaceCore.js';
import { MAX_WORKSPACE_NAME } from './workspaceName.js';

/** The room above a workspace's row for the name of the workspace above and the name input, in px, below the column's `topInset`. @public */
export const COLUMN_TOP_BAND = 76;
/** The room below a workspace's row for the name of the workspace below, in px. @public */
export const COLUMN_BOTTOM_BAND = 26;

/** The least height of a control the column draws, px: a pointer target of 24. */
const TARGET = 24;

const DefaultCell = React.lazy(() => import('./autoMount.js').then((m) => ({ default: m.AutoRoot })));

const EDITABLE_ROLES = '[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"],[role="menu"],[role="menubar"],[role="tablist"],[role="tree"],[role="grid"],[role="radiogroup"]';

/**
 * Whether a vertical arrow key belongs to something other than the column: a modified or repeated key, one a handler already took,
 * one typed in a field or widget that uses the arrows, one while a dialog is open or an IME is composing, or one during a keyboard drag.
 * @internal
 */
export function arrowKeyBelongsElsewhere(e: KeyboardEvent, doc: Document): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229) return true;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  for (const node of [e.target, doc.activeElement]) {
    if (!(node instanceof Element)) continue;
    if (node.closest('input,textarea,select')) return true;
    if (node.closest(EDITABLE_ROLES)) return true;
    const editable = node.closest('[contenteditable]');
    if (editable !== null && editable.getAttribute('contenteditable') !== 'false') return true;
    // dnd-kit marks the item a keyboard drag is carrying pressed.
    if (node.closest('[aria-pressed="true"][aria-roledescription]')) return true;
  }
  return doc.querySelector(`dialog[open],[aria-modal="true"],[${DRAGGING_ATTRIBUTE}]`) !== null;
}

function NameInput({ workspace, label, inset }: { workspace: WorkspaceHandle; label: string; inset: number }): React.ReactElement {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = (): void => {
    if (draft !== null) workspace.rename(draft);
    setDraft(null);
  };
  return (
    <InputBase
      value={draft ?? workspace.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      inputProps={{ 'aria-label': label, maxLength: MAX_WORKSPACE_NAME, 'data-workspace-name-input': '', style: { textAlign: 'center', padding: 0, height: TARGET } }}
      sx={{ position: 'absolute', top: 24 + inset, left: '50%', transform: 'translateX(-50%)', width: 280, maxWidth: 'calc(100% - 32px)', height: TARGET, fontSize: 14, zIndex: 1 }}
    />
  );
}

/** The props of `WorkspaceColumn`. @public */
export interface WorkspaceColumnProps {
  /** The column to draw. */
  column: WorkspaceColumnHandle;
  /**
   * What fills a workspace's cell: the app's own hand-wired row for that workspace. Omitted: the row the library mounts itself, as
   * `createWorkspace` does. A returned row puts the column's `topInset` plus `COLUMN_TOP_BAND` plus its row gap above its panels.
   */
  children?: (workspace: WorkspaceHandle) => React.ReactNode;
}

/**
 * Draws a column: one cell per workspace, the current one in view, the others inert and hidden from assistive technology but
 * still mounted, so their panels keep their state. Moving to another workspace moves focus into its cell when focus was in the one left.
 * @public
 */
export function WorkspaceColumn({ column, children }: WorkspaceColumnProps): React.ReactElement {
  const core = columnCoreOf(column);
  const snap = React.useSyncExternalStore(core.subscribe, core.snapshot, core.snapshot);
  // The system preference too, because an app's MotionConfig may not carry it.
  const systemReduced = useReducedMotion() === true;
  const reduced = useReducedMotionConfig() === true || systemReduced;
  const move = React.useMemo(() => slideToTransition(resolveWorkspaceTuning(snap.tuning).slide), [snap.tuning]);
  const labels = React.useMemo(() => resolveLabels(snap.labels), [snap.labels]);
  const cells = React.useRef(new Map<string, HTMLElement>());
  const left = React.useRef<number>(snap.current);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (arrowKeyBelongsElsewhere(e, document)) return;
      if (column.step(e.key === 'ArrowUp' ? 'up' : 'down')) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [column]);

  // An inert cell drops the focus inside it; the arrow keys keep working only if focus lands somewhere in the column again.
  React.useLayoutEffect(() => {
    const was = snap.workspaces[left.current];
    left.current = snap.current;
    const now = snap.workspaces[snap.current];
    if (was === undefined || now === undefined || was === now) return;
    const from = cells.current.get(was.id);
    const to = cells.current.get(now.id);
    if (from !== undefined && to !== undefined && from.contains(document.activeElement)) to.focus({ preventScroll: true });
  }, [snap.current, snap.workspaces]);

  const create = (index: number): void => {
    column.scrollTo(column.addWorkspace({ index }));
  };

  return (
    <Box data-workspace-column="" sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', transform: `translateY(${-Math.max(snap.current, 0) * 100}%)`, transition: reduced ? 'none' : `transform ${move.duration}s cubic-bezier(${move.ease.join(',')})` }}>
        {snap.workspaces.map((ws, i) => {
          const active = i === snap.current;
          const above = snap.workspaces[i - 1];
          const below = snap.workspaces[i + 1];
          return (
            <Box
              key={ws.id}
              ref={(el: HTMLElement | null) => {
                if (el === null) cells.current.delete(ws.id);
                else cells.current.set(ws.id, el);
              }}
              data-workspace-cell=""
              data-workspace-id={ws.id}
              data-workspace-active={active ? '' : undefined}
              tabIndex={-1}
              aria-hidden={active ? undefined : true}
              inert={!active}
              sx={{ position: 'relative', height: '100%', outline: 'none' }}
            >
              <Button
                data-workspace-neighbour="above"
                size="small"
                onClick={() => (above === undefined ? create(i) : column.scrollTo(above))}
                aria-label={above === undefined ? labels.newWorkspace : labels.goToWorkspace(above.name)}
                sx={{ position: 'absolute', top: snap.topInset, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100% - 32px)', height: TARGET, minHeight: 0, py: 0, zIndex: 1, textTransform: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
              >
                {above === undefined ? labels.newWorkspace : above.name}
              </Button>
              <NameInput workspace={ws} label={labels.workspaceName} inset={snap.topInset} />
              {children === undefined ? (
                <React.Suspense fallback={null}>
                  <DefaultCell workspace={ws} columnTop={COLUMN_TOP_BAND} themed={false} />
                </React.Suspense>
              ) : (
                children(ws)
              )}
              <Button
                data-workspace-neighbour="below"
                size="small"
                onClick={() => (below === undefined ? create(i + 1) : column.scrollTo(below))}
                aria-label={below === undefined ? labels.newWorkspace : labels.goToWorkspace(below.name)}
                sx={{ position: 'absolute', bottom: COLUMN_BOTTOM_BAND - TARGET, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100% - 32px)', height: TARGET, minHeight: 0, py: 0, zIndex: 1, textTransform: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
              >
                {below === undefined ? labels.newWorkspace : below.name}
              </Button>
            </Box>
          );
        })}
      </div>
      {snap.workspaces.length === 0 ? (
        <Button data-workspace-neighbour="empty" size="small" onClick={() => create(0)} sx={{ position: 'absolute', top: snap.topInset, left: '50%', transform: 'translateX(-50%)', height: TARGET, minHeight: 0, textTransform: 'none' }}>
          {labels.newWorkspace}
        </Button>
      ) : null}
    </Box>
  );
}
