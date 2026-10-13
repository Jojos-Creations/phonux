// node step-end-probe.mjs <libDir> [firefox|webkit|chromium] [slots=1,4] [width=1800]
// Builds a stepping 'visible' row of the library at <libDir> (History + panels of the given slots), sends wheel deltaX +300 every 900 ms
// until well past the last stop, then the same back, and prints one JSON line per step: scrollLeft, the browser's own scroll range,
// the library's numbers (stops, endPad, maxScroll, atStop), every panel's drawn width and rect, and the scroll events seen.
// Needs: esbuild and react/react-dom resolvable from <libDir>/node_modules, and playwright (cwd, or PLAYWRIGHT_DIR=/path/to/node_modules).
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ENTRY_SRC = `// A workspace as the app builds one: History as the scrolling root, panels of the given slots, a stepping row, StrictMode.
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
const GESTURE = (q.get('gesture') ?? 'step') as 'step' | 'free';
const REVEAL = q.get('reveal');
const ROOT = 'root';
const FRAME = q.get('frame') ?? 'none';
const GAP = 16;
const PHONE = 390;
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
    if (REVEAL) latest.scrollTo(REVEAL, 'into-view');
  };
  const bar = (side: 'left' | 'right') => (
    <div data-grab={\`\${name}:\${side}\`} onPointerDown={onDown(side)} onPointerMove={onMove} onPointerUp={onUp} style={{ position: 'absolute', [side]: 0, top: 0, bottom: 0, width: 24, background: '#c33', touchAction: 'none', cursor: 'ew-resize' }} />
  );
  if (FRAME === 'auto') return <div data-box={name} style={{ position: 'relative', width: '100%', height: '100%' }}>{name}</div>;
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

const ids = SLOTS.map((_, k) => \`p\${k + 1}\`);
const ws = createWorkspace({
  root: definePanel({ id: ROOT, view: ((props: any) => <View {...props} name={ROOT} />) as any, settings: { title: 'History', frame: FRAME } }),
  templates: ids.map((id, k) => definePanel({ id, view: ((props: any) => <View {...props} name={id} />) as any, settings: { slots: SLOTS[k], maxSlots: 64, frame: FRAME } as any })),
  tuning: { rowGesture: GESTURE, shrinkOutOfView: MODE } as any,
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
  const p = useProvidePanels({ workspace: ws, rootId: ws.rootId, phoneWidth: 390, containerWidth: w, overflowContainerRef: ref } as any);
  latest = p;
  const host = createFakeHost({ panels: p });
  (window as any).__g = { container: () => ref.current, provided: () => latest, stops: () => latest.rowNumbers.stops, cap: () => Math.floor((latest.maxLiveWidth + GAP) / (PHONE + GAP)) };
  const tree = (
    <HostProvider host={host}>
      <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <Workspace overflowContainerRef={ref} rowRef={rowRef} containerWidth={w} rowResizeSettled phoneWidth={390} fixedColumnCount={p.fixedViewCount} liveWidths={p.liveWidths} rowScroll={p.rowScroll} rowNumbers={p.rowNumbers} tuning={p.tuning}>
          <PanelRow entries={p.entries} rootId={ws.rootId} closingIds={NONE} enteringViaAnchorIds={NONE} rowNumbers={p.rowNumbers} maxLiveWidth={p.maxLiveWidth} workspace={ws} />
        </Workspace>
      </div>
    </HostProvider>
  );
  return REDUCE ? <MotionConfig reducedMotion="always">{tree}</MotionConfig> : tree;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
`;
const [libArg, engine = 'firefox', slots = '1,4', widthArg = '1800'] = process.argv.slice(2);
if (!libArg) throw new Error('usage: node step-end-probe.mjs <libDir> [firefox|webkit|chromium] [slots] [width]');
const lib = resolve(libArg);
const width = Number(widthArg);
const req = createRequire(join(lib, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
const pwNs = process.env.PLAYWRIGHT_DIR ? await import(pathToFileURL(createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright')).href) : await import('playwright');
const pw = pwNs.chromium ? pwNs : pwNs.default;
const dir = mkdtempSync(join(tmpdir(), 'step-end-'));
writeFileSync(join(dir, 'entry.tsx'), ENTRY_SRC);
await build({
  entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm',
  define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib, ...(process.env.REACT_DIR ? { react: `${process.env.REACT_DIR}/node_modules/react`, 'react-dom': `${process.env.REACT_DIR}/node_modules/react-dom` } : {}) }, nodePaths: [join(lib, 'node_modules')], logLevel: 'warning',
});
const html = '<!doctype html><html><body style="margin:0;user-select:none;-webkit-user-select:none"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(join(dir, 'out.js')) : html); }).listen(0);
const browser = await pw[engine].launch();
const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
await page.goto(`http://localhost:${srv.address().port}/?mode=visible&slots=${slots}&control=none&reduce=0&frame=none`);
await page.waitForSelector('[data-box="p1"]');
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const c = window.__g.container();
  window.__events = [];
  c.addEventListener('scroll', () => window.__events.push(Math.round(c.scrollLeft * 100) / 100));
});
const snap = () => page.evaluate(() => {
  const g = window.__g, c = g.container(), p = g.provided(), n = p.rowNumbers;
  const cs = getComputedStyle(c);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.right * 10) / 10]; };
  const events = window.__events.splice(0);
  return {
    scrollLeft: c.scrollLeft, scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, browserMax: c.scrollWidth - c.clientWidth,
    paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
    lib: { stops: n.stops, stopFirsts: n.stopFirsts, atStop: n.atStop, endPad: n.endPad, maxScroll: Math.max(0, n.rowMarginLeft + n.stripWidth + n.endPad - n.windowWidth), windowWidth: n.windowWidth, stripWidth: n.stripWidth, rowMarginLeft: n.rowMarginLeft, drawnWidths: n.drawnWidths },
    strip: rect(c.querySelector('[data-row-strip]')), endPadEl: rect(c.querySelector('[data-row-end-pad]')),
    boxes: [...c.querySelectorAll('[data-box]')].filter((b) => { const r = b.getBoundingClientRect(); return r.right > 1 && r.left < innerWidth - 1; }).map((b) => [b.getAttribute('data-box'), ...rect(b)]),
    events,
  };
});
const direction = [['right', 300, 'go'], ['left', -300, 'back']];
const out = [];
for (const [name, delta] of direction.map(([, d, n]) => [n, d])) {
  for (let i = 1; i <= 9; i++) {
    await page.mouse.move(600, 300);
    await page.mouse.wheel(delta, 0);
    await page.waitForTimeout(900);
    const s = await snap();
    out.push({ phase: name, step: i, ...s });
    console.log(JSON.stringify({ engine, slots, width, phase: name, step: i, ...s }));
  }
}
await browser.close(); srv.close();


