// A workspace as the app builds one: History as the scrolling root, panels of the given slots, a stepping row, StrictMode.
// Every panel draws a visible box (PanelSizeBox) with a grabber on each edge that resizes it the way the app's grabber will:
// press -> setResizing(true); move -> setDrawnWidth(px, pin); release -> setSlots(nearest), setDrawnWidth(null), setResizing(false).
// Query: mode=<off|visible|hidden> slots=2,1,2 control=<none|setslots|nopin> reduce=<0|1>
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { HostProvider, PanelRow, PanelSizeBox, Workspace, createWorkspace, definePanel, usePanelResizing, useProvidePanels } from 'LIB/index.js';
import { createFakeHost } from 'LIB/fakeHost.js';

const q = new URLSearchParams(location.search);
const MODE = (q.get('mode') ?? 'visible') as 'off' | 'visible' | 'hidden';
const SLOTS = (q.get('slots') ?? '1,2,1').split(',').map(Number);
const CONTROL = q.get('control') ?? 'none';
const REDUCE = q.get('reduce') === '1';
const ROOT = 'root';
const GAP = Number(q.get('gap') ?? 16);
const PHONE = Number(q.get('phone') ?? 390);
const NONE = new Set<string>();
let latest: any;

function View({ panel, name }: { panel: any; name: string }) {
  const [, setResizing, setDrawnWidth] = usePanelResizing();
  const drag = React.useRef<{ side: 'left' | 'right'; startX: number; startWidth: number; width: number } | null>(null);
  const cap = () => {
    const fit = Math.floor((latest.maxLiveWidth + GAP) / (PHONE + GAP));
    return Math.max(1, Math.min(64, fit));
  };
  const onDown = (side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { side, startX: e.clientX, startWidth: panel.size.width, width: panel.size.width };
    setResizing(true);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null) return;
    const dx = e.clientX - d.startX;
    d.width = d.startWidth + (d.side === 'right' ? dx : -dx);
    if (CONTROL === 'setslots') {
      const n = Math.max(1, Math.min(cap(), Math.round((d.width + GAP) / (PHONE + GAP))));
      latest.setSlots(panel.id, n);
    } else setDrawnWidth(d.width, d.side === 'left' && CONTROL !== 'nopin' ? 'end' : 'start');
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const n = Math.max(1, Math.min(cap(), Math.round((d.width + GAP) / (PHONE + GAP))));
    latest.setSlots(panel.id, n);
    setDrawnWidth(null);
    setResizing(false);
  };
  const bar = (side: 'left' | 'right') => (
    <div data-grab={`${name}:${side}`} onPointerDown={onDown(side)} onPointerMove={onMove} onPointerUp={onUp} style={{ position: 'absolute', [side]: 0, top: 0, bottom: 0, width: 24, zIndex: 5, background: '#c33', touchAction: 'none', cursor: 'ew-resize' }} />
  );
  return (
    <PanelSizeBox width={panel.size.width} height={typeof panel.size.height === 'number' ? panel.size.height : 700}>
      <div data-box={name} style={{ position: 'relative', width: '100%', height: '100%', background: name === ROOT ? '#243' : '#335', color: '#fff' }}>
        {name}
        {name !== ROOT && bar('left')}
        {name !== ROOT && bar('right')}
      </div>
    </PanelSizeBox>
  );
}

const ids = SLOTS.map((_, k) => `p${k + 1}`);
const ws = createWorkspace({
  root: definePanel({ id: ROOT, view: ((props: any) => <View {...props} name={ROOT} />) as any, settings: { title: 'History' } }),
  templates: ids.map((id, k) => definePanel({ id, view: ((props: any) => <View {...props} name={id} />) as any, settings: { slots: SLOTS[k], maxSlots: 64 } as any })),
  tuning: { rowGesture: 'step', shrinkOutOfView: MODE, rowGap: GAP } as any,
  mount: false,
});
for (const id of ids) ws.addPanel(id);

function App() {
  const ref = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const p = useProvidePanels({ workspace: ws, rootId: ws.rootId, phoneWidth: PHONE, containerWidth: w, overflowContainerRef: ref } as any);
  latest = p;
  const host = createFakeHost({ panels: p });
  (window as any).__g = { container: () => ref.current, provided: () => latest, stops: () => latest.rowNumbers.stops, cap: () => Math.floor((latest.maxLiveWidth + GAP) / (PHONE + GAP)) };
  const tree = (
    <HostProvider host={host}>
      <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <Workspace overflowContainerRef={ref} rowRef={rowRef} containerWidth={w} rowResizeSettled phoneWidth={PHONE} fixedColumnCount={p.fixedViewCount} liveWidths={p.liveWidths} rowScroll={p.rowScroll} rowNumbers={p.rowNumbers} tuning={p.tuning}>
          <PanelRow entries={p.entries} rootId={ws.rootId} closingIds={NONE} enteringViaAnchorIds={NONE} rowNumbers={p.rowNumbers} maxLiveWidth={p.maxLiveWidth} workspace={ws} />
        </Workspace>
      </div>
    </HostProvider>
  );
  return REDUCE ? <MotionConfig reducedMotion="always">{tree}</MotionConfig> : tree;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
