// The public surface of phonux: a name that moves or changes kind here breaks every consumer. test/phonux-barrel.test.ts pins the value
// names; only tsc checks type names (releaseMeasure.typecheck.ts pins one). DESIGN.md says why some exports stay off this list.
export { DEFAULT_PHONE_SIZE, HostMissingProviderError, HostProvider, useHost, } from './hostApi.js';
export { useViewSnapshot, CaptureRegistryContext, CaptureRegistryProvider, noopCaptureTrigger } from './snapshots.js';
export { useViewState, ViewStateMissingProviderError } from './viewState.js';
// Deprecated aliases: same value as their new-name counterpart, kept until removed.
export { PhoneAPIsMissingProviderError, PhoneAPIsProvider, usePhoneAPIs, } from './hostApi.js';
export { registerView, resolveView } from './viewRegistry.js';
/** @deprecated use registerView/resolveView/ViewComponent */
export { registerPanelView, resolvePanelView } from './viewRegistry.js';
export { Panel, DRAG_CLOSE, DragToClose, shouldCloseOnRelease, WindowOverlay, OverlaySlot, OVERLAY_Z, OverlayProvider, OverlayStore, } from './Panel.js';
/** @deprecated use Panel/PanelProps */
export { PhoneView } from './Panel.js';
export { default as PanelFrame } from './PanelFrame.js';
export { PANEL_CORNER_RADIUS_UNITS, panelCornerRadiusPx, panelFrameScrollSx, panelFrameBareSx, PanelHeader, PanelHeaderRow, } from './PanelFrame.js';
/** @deprecated use PanelFrame, PanelHeader, PanelHeaderRow and their PANEL_ and panel-prefixed siblings above */
export { default as PhoneFrame } from './PanelFrame.js';
export { PHONE_CORNER_RADIUS_UNITS, phoneCornerRadiusPx, phoneFrameScrollSx, phoneFrameBareSx, PhoneFrameHeader, PhoneFrameHeaderRow, } from './PanelFrame.js';
export { PHONE_MODELS, findPhoneModel, vendorLabelForUsbVendorId } from './phoneModels.js';
export { PhoneDetectPrompt } from './PhoneDetectPrompt.js';
export { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
export { summarisePanel } from './panelRowEntry.js';
export { DEFAULT_PANEL_SIZE, TIER_SIZES, panelWidthOf } from './panelTiers.js';
export { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
export { PanelRow, usePanelCloseEligible, usePanelNeighborWidths, usePanelPinned, usePanelReorderEligible } from './PanelRow.js';
export { GAP, PANEL_TRANSITION, PanelRowSlot, PanelSizeBox } from './PanelRowSlot.js';
export { Workspace } from './Workspace.js';
export { useProvidePanels } from './panels/useProvidePanels.js';
export { reorderStepsForOffset } from './panelWindow.js';
export { createDefaultTheme } from './defaultTheme.js';
