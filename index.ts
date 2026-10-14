// The public surface of phonux: a name that moves or changes kind here breaks every consumer. test/phonux-barrel.test.ts pins the value
// names; type names are pinned by the API reports under etc/. DESIGN.md says why some exports stay off this list.

export {
  DEFAULT_PHONE_SIZE,
  HostMissingProviderError,
  HostProvider,
  useHost,
} from './hostApi.js';
export type {
  PhoneSize,
  ClosedPageEntry,
  JsonValue,
  PanelSize,
  PanelSummary,
  CreatePanelOptions,
  SettingsAPI,
  HistoryAPI,
  PanelsAPI,
  PhoneDeviceAPI,
  Host,
  HostInput,
} from './hostApi.js';

export type { PhonuxLabels } from './labels.js';

export { useViewSnapshot, CaptureRegistryProvider, noopCaptureTrigger } from './snapshots.js';
export type { ViewId, ViewSnapshot, SnapshotsAPI, CaptureRegistry, CaptureTrigger } from './snapshots.js';

export { useViewState, ViewStateMissingProviderError } from './viewState.js';
export type { UseViewState } from './viewState.js';

export {
  Panel,
  DRAG_CLOSE,
  DragToClose,
  WindowOverlay,
  OverlaySlot,
  OVERLAY_Z,
} from './Panel.js';
export { ROW_LAYER_Z } from './rowConstants.js';
export type {
  PanelProps,
  DragHandleProps,
  ReorderHandle,
  OverlaySlotName,
  WindowOverlayProps,
} from './Panel.js';

export { default as PanelFrame } from './PanelFrame.js';
export {
  PANEL_CORNER_RADIUS_UNITS,
  panelCornerRadiusPx,
  panelFrameScrollSx,
  panelFrameBareSx,
  PanelHeader,
  PanelHeaderRow,
} from './PanelFrame.js';
export type {
  PanelFrameProps,
  PanelHeaderProps,
  PanelHeaderRowProps,
} from './PanelFrame.js';

export { PHONE_MODELS, findPhoneModel } from './phoneModels.js';
export type { PhoneModel } from './phoneModels.js';
export { usePhoneSize } from './phoneFit.js';
export { usePhoneFit } from './usePhoneFit.js';

export type { PanelAnchor } from './panelRowOrder.js';
export type { NeighborWidths, PanelRowEntry } from './panelRowEntry.js';
export { DEFAULT_PANEL_SIZE, panelWidthOf } from './panelTiers.js';
export { computeRowLayout } from './panelRowLayout.js';
export { minWorkspaceWidth } from './minWorkspaceWidth.js';
export type { MinWorkspaceWidthInput } from './minWorkspaceWidth.js';
export type { RowLayoutInput, RowLayoutResult } from './panelRowLayout.js';
export { computeRowNumbers } from './rowNumbers.js';
export type { RowNumbers } from './rowNumbers.js';
export { PanelRow, usePanelCapabilities, usePanelCloseEligible, usePanelNeighborWidths, usePanelPinned, usePanelReorderEligible, usePanelReorderSteps, usePanelTuning } from './PanelRow.js';
export { slideToTransition } from './directionalTransition.js';
export { GAP, PANEL_TRANSITION, PanelSizeBox } from './PanelRowSlot.js';
export { PanelHeaderButtons, usePanelHeaderButtons } from './panelHeaderButtons.js';
export { PanelFooter } from './panelFooter.js';
export type { PanelHeaderButtonItem, PanelHeaderButtonItemBase, PanelHeaderIconItem, PanelHeaderTextItem } from './panelHeaderButtons.js';
export { Workspace } from './Workspace.js';
export type { WorkspaceProps } from './Workspace.js';
export { useProvidePanels } from './panels/useProvidePanels.js';
export type { PanelsInput, ProvidedPanels } from './panels/useProvidePanels.js';
export type { PanelWindow } from './panelWindow.js';
export { reorderStepsForOffset } from './panelWindow.js';

export { createDefaultTheme } from './defaultTheme.js';

export type { WorkspacePanelState, WorkspaceState, WorkspaceStorage } from './workspaceState.js';

export { PANEL_SETTINGS_CATALOG, LIBRARY_PANEL_DEFAULTS, LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
export type {
  PanelId,
  AnchorRequest,
  AddPlacement,
  Overflow,
  ScrollAlign,
  ScrollOnOpen,
  ScrollOnMove,
  ScrollOnDrag,
  HeaderButtonContext,
  HeaderButton,
  HeaderButtonBase,
  HeaderButtonIconForm,
  HeaderButtonTextForm,
  PinHalf,
  Pinning,
  PinWhenNotLive,
  PinningWhenNotLive,
  SettingValues,
  PanelSettings,
  ResolvedPanelSettings,
  BezierEase,
  ChromeTuning,
  CloseExitEase,
  FadeEase,
  GlideEase,
  DragToCloseTuning,
  SlideTuning,
  EdgeScrollTuning,
  PanelTuning,
  WorkspaceTuning,
  ResolvedPanelTuning,
  ResolvedWorkspaceTuning,
  SettingNote,
  SettingConflict,
  SourceLayer,
  SettingDescriptor,
  CatalogName,
  SettingClass,
  SettingDoor,
  SettingScope,
  LibraryPanelDefaults,
  PanelUserLayer,
  PanelSettingsResolution,
} from './panelSettings.js';

export type { SettingsPatch, InstancePatch, ViewPatch } from './settingsPatch.js';

export { PANEL_API } from './panelApiLevel.js';
export type { PanelApiLevel } from './panelApiLevel.js';
export { definePanel } from './panelTemplate.js';
export type {
  PanelTemplate,
  PanelViewProps,
  AnyPanelTemplate,
  PanelStatus,
  DeferredPin,
  PanelState,
  ListFilter,
  PanelSnapshot,
  WorkspaceStatus,
  PanelReadHandle,
  ViewHandle,
  PanelReader,
} from './panelTemplate.js';

export { createWorkspace } from './workspaceCore.js';
export { MAX_WORKSPACE_NAME } from './workspaceName.js';
export { createWorkspaceColumn } from './columnHandle.js';
export type { ColumnOptions, ColumnState, ColumnStatus, ColumnStorage, ColumnWorkspaceOptions, WorkspaceColumnHandle } from './columnHandle.js';
export { COLUMN_BOTTOM_BAND, COLUMN_TOP_BAND, WorkspaceColumn } from './WorkspaceColumn.js';
export type { WorkspaceColumnProps } from './WorkspaceColumn.js';
export type { ViewWorkspace, WorkspaceHandle, WorkspaceOptions, WorkspaceWrapProps } from './workspaceCore.js';
export type { WorkspaceLive, WorkspacePanelsInput } from './workspaceLive.js';
export type { PanelHandle } from './panelHandles.js';
export type { ConfigureResult, PanelManager, PanelResult, PinResult, ResetResult } from './panelManager.js';
export { usePanelStates, usePanelState, useWorkspace, useWorkspaceManager } from './panels/usePanelStates.js';
export { PanelResizeGrips } from './PanelResizeGrips.js';
export { ACTIVE_ATTRIBUTE, CHROME_ATTRIBUTE, CHROME_PARTS, DRAGGING_ATTRIBUTE, useActivePanel, usePanelActive, usePanelDragProps, usePanelDragging, usePanelResizing } from './panelChrome.js';
export type { ChromePart } from './panelChrome.js';

export { PanelManagerError } from './panelManagerError.js';
export type { PanelRefusal, PanelManagerErrorCode } from './panelManagerError.js';
