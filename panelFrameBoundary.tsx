/**
 * The zero-DOM boundary above a template's view. A view that draws its own `Panel` or `PanelFrame` claims it before paint and is
 * mounted exactly once, as it was before the default frame existed; a view that claims nothing is bare and is drawn inside the
 * library's frame instead. DESIGN.md, "The default frame", has the mechanisms that were rejected and why.
 */
import * as React from 'react';
import { DefaultFrame } from './defaultFrame.js';
import type { PanelSummary } from './hostApi.js';
import { FrameClaimContext, type FrameClaims } from './panelFrameClaim.js';
import { PanelSlotContext } from './panelSlotContext.js';
import type { PanelTemplate } from './panelTemplate.js';

/** Whether a template's view was last found bare, by template object: the second panel of a bare template is drawn framed at once, so only the first one's view mounts twice. */
const BARE_TEMPLATES = new WeakMap<PanelTemplate, boolean>();

/** Draws `children` as they are, or inside the library's frame when the view below claims no part of one and the panel's `frame` setting is 'auto'. @internal */
export function FrameBoundary({ template, panel, children }: { template: PanelTemplate; panel: PanelSummary; children: React.ReactNode }): React.ReactElement {
  const frame = React.useContext(PanelSlotContext)?.frame ?? 'auto';
  const [bare, setBare] = React.useState(() => frame === 'auto' && BARE_TEMPLATES.get(template) === true);
  const claimed = React.useRef(0);
  const bareNow = React.useRef(bare);
  bareNow.current = bare;
  const claims = React.useMemo<FrameClaims>(
    () => ({
      claim: () => {
        claimed.current += 1;
        // A claim that arrives after the library drew its frame (a lazy view, one that rendered nothing first) takes that frame back.
        if (bareNow.current) {
          BARE_TEMPLATES.set(template, false);
          setBare(false);
        }
        return () => {
          claimed.current -= 1;
        };
      },
    }),
    [template],
  );
  // After the view's own layout effects: its Panel has claimed by now.
  React.useLayoutEffect(() => {
    const wants = frame === 'auto' && claimed.current === 0;
    if (frame === 'auto') BARE_TEMPLATES.set(template, wants);
    if (wants !== bareNow.current) setBare(wants);
  }, [frame, bare, template]);
  const view = <FrameClaimContext.Provider value={claims}>{children}</FrameClaimContext.Provider>;
  return bare ? <DefaultFrame panel={panel}>{view}</DefaultFrame> : view;
}
