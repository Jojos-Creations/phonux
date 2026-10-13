/**
 * The frame the library draws around a template's view that draws none of its own: a header with the panel's title, the
 * grab bar of the drag-down close, the phone frame and the template's footer. Built from the exported `Panel`, `PanelFrame`
 * and `DragToClose`, so a bare view looks and behaves like one a developer wrote with them. DESIGN.md, "The default frame".
 */
import * as React from 'react';
import { DragToClose } from './dragToClose.js';
import { useHost, useOptionalHost, type PanelSummary } from './hostApi.js';
import { resolveLabels } from './labels.js';
import Panel from './Panel.js';
import PanelFrame from './PanelFrame.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { reorderStepsForOffset } from './panelWindow.js';

export function DefaultFrame({ panel, children }: { panel: PanelSummary; children: React.ReactNode }): React.ReactElement {
  const { panels } = useHost();
  const labels = resolveLabels(useOptionalHost()?.labels);
  const slot = React.useContext(PanelSlotContext);
  const closeEligible = slot === undefined ? true : slot.collapsible && slot.closable;
  const reorderEligible = slot?.draggable ?? false;
  const size = (panel.formFactor ?? 'phone') !== 'phone' ? panel.size : undefined;
  const title = panel.title ?? labels.untitledPanel;
  const body = <PanelFrame {...(size !== undefined ? { size } : {})}>{children}</PanelFrame>;
  if (!closeEligible) return <Panel title={title} viewId={panel.id} {...(size !== undefined ? { size } : {})}>{body}</Panel>;
  return (
    <DragToClose
      onClose={() => panels.close(panel.id)}
      reorder={
        reorderEligible && slot !== undefined
          ? {
              onDragEnd: (offset) => {
                const steps = reorderStepsForOffset(offset, slot.neighborWidths, slot.tuning.rowGap, slot.tuning.hopFraction);
                for (let i = 0; i < Math.abs(steps); i += 1) panels.move(panel.id, steps > 0 ? 'right' : 'left');
              },
            }
          : undefined
      }
    >
      {(grab) => (
        <Panel title={title} viewId={panel.id} grabProps={{ ...grab }} {...(size !== undefined ? { size } : {})}>
          {body}
        </Panel>
      )}
    </DragToClose>
  );
}
