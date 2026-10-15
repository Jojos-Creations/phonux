// The dot bar in a real browser: six 390px panels in a 16px-gap strip, a scroller of ?w= px, a 1000px track.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { usePanelDots } from 'LIB/usePanelDots.js';

const W = Number(new URLSearchParams(location.search).get('w') ?? 600);
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const numbers = {
  rowScroll: true,
  windowWidth: W,
  stripWidth: 6 * 390 + 5 * 16,
  rowMarginLeft: 0,
  endPad: 0,
  ids,
  widths: ids.map(() => 390),
  leftOffsets: ids.map((_, k) => k * 406),
} as any;
const entries = ids.map((id) => ({ id }));

function App() {
  const scroller = React.useRef<HTMLDivElement>(null);
  const dots = usePanelDots({ rowNumbers: numbers, entries, trackWidth: 1000, minDotPx: 1, scroller });
  const drag = React.useRef<ReturnType<NonNullable<typeof dots.startOvalDrag>> | null>(null);
  const x0 = React.useRef(0);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#fff' }}>
      <div ref={scroller} data-row-scroller="" style={{ overflowX: 'auto', width: W, height: 120, whiteSpace: 'nowrap' }}>
        {ids.map((id, k) => (
          <div key={id} data-panel={id} style={{ display: 'inline-block', width: 390, height: 100, marginRight: 16, background: '#335' }} />
        ))}
      </div>
      <div data-track="" style={{ position: 'absolute', left: 0, top: 300, width: 1000, height: 40 }}>
        {dots.dots.map((d) => (
          <button type="button" key={d.id} data-dot={d.id} onClick={() => dots.selectDot(d.id)} aria-label={`Panel ${d.id}`} style={{ position: 'absolute', left: d.left, width: d.width, height: 8, top: 0, padding: 0, border: 0, background: d.hollow ? 'transparent' : '#fff' }} />
        ))}
        <div
          role="slider"
          aria-label="Visible window"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(dots.oval.left)}
          tabIndex={0}
          data-oval=""
          onPointerDown={(e) => {
            x0.current = e.clientX;
            drag.current = dots.startOvalDrag();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => drag.current?.drag(e.clientX - x0.current)}
          onPointerUp={() => { drag.current?.end(); drag.current = null; }}
          style={{ position: 'absolute', top: 14, height: 14, left: dots.oval.left, width: dots.oval.width, border: '1px solid #fff' }}
        />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))).render(<App />);
