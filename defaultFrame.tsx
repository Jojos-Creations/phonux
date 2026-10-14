/**
 * The frame the library draws around a template's view that draws none of its own: a header with the panel's title, the
 * grab bar of the drag-down close, the phone frame and the template's footer. Built from the exported `Panel`, `PanelFrame`
 * and `DragToClose`, so a bare view looks and behaves like one a developer wrote with them. DESIGN.md, "The default frame".
 */
import * as React from 'react';
import { DragToClose } from './dragToClose.js';
import { useOptionalHost, type PanelSummary } from './hostApi.js';
import { resolveLabels } from './labels.js';
import Panel, { type PanelProps } from './Panel.js';
import PanelFrame from './PanelFrame.js';
import { SizeBox } from './PanelRowSlot.js';
import { usePanelDragProps } from './panelChrome.js';
import { PanelResizeGrips } from './PanelResizeGrips.js';
import { PanelSlotContext } from './panelSlotContext.js';

export function DefaultFrame({ panel, children }: { panel: PanelSummary; children: React.ReactNode }): React.ReactElement {
  const dragProps = usePanelDragProps();
  const labels = resolveLabels(useOptionalHost()?.labels);
  const slot = React.useContext(PanelSlotContext);
  const closeEligible = slot === undefined ? true : slot.collapsible && slot.closable;
  const size = (panel.formFactor ?? 'phone') !== 'phone' ? panel.size : undefined;
  const title = panel.title ?? labels.untitledPanel;
  const body = <PanelFrame {...(size !== undefined ? { size } : {})}>{children}</PanelFrame>;
  // One box around the whole panel, so the frame, the header above it and the grab bar move together while the size animates.
  const boxed = (panelProps: Omit<PanelProps, 'children'>): React.ReactElement => (
    <SizeBox {...(size !== undefined ? { width: size.width, height: size.height === 'fill' ? '100%' : size.height } : {})}>
      <Panel {...panelProps} overlay={<PanelResizeGrips />} sx={{ height: '100%' }} {...(size !== undefined ? { size } : {})}>
        {body}
      </Panel>
    </SizeBox>
  );
  if (!closeEligible) return boxed({ title, viewId: panel.id });
  return (
    <DragToClose {...dragProps}>
      {(grab) => boxed({ title, viewId: panel.id, grabProps: { ...grab } })}
    </DragToClose>
  );
}
