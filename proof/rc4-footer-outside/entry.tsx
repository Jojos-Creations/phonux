// The footer floats below the frame in a real browser: a 390 by 700 frame in a relative slot of the same size (as the app sizes it), with and without a footer.
import { createRoot } from 'react-dom/client';
import PanelFrame from 'LIB/PanelFrame.js';
import { PanelFooterContext } from 'LIB/panelFooter.js';
import { HostProvider } from 'LIB/index.js';
import { createFakeHost } from 'LIB/fakeHost.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 390);
const withFooter = q.get('footer') !== '0';
const footer = <span data-footer="">footer</span>;
createRoot(document.getElementById('root')!).render(
  <HostProvider host={createFakeHost()}>
  <PanelFooterContext.Provider value={withFooter ? footer : null}>
    <div data-slot="" style={{ position: 'relative', width: W, height: 700, background: '#222' }}>
      <PanelFrame size={{ width: 390, height: 700 }}>
        <div data-body="">body</div>
      </PanelFrame>
    </div>
  </PanelFooterContext.Provider>
  </HostProvider>,
);
