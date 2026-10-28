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
  JsonValue,
  PanelSize,
  PanelSummary,
  CreatePanelOptions,
  PanelsAPI,
  PhoneDeviceAPI,
  Host,
  HostInput,
} from './hostApi.js';

export type { PhonuxLabels } from './labels.js';

export { useViewSnapshot, CaptureRegistryProvider, noopCaptureTrigger } from './snapshots.js';
export type { ViewId, ViewSnapshot, SnapshotsAPI, CaptureRegistry, CaptureTrigger } from './snapshots.js';

export { createTileCapture } from './captureTiles.js';
export type {
  TileCapture,
  TileCaptureOptions,
  TilePictureRecord,
  TilePictureStorage,
  TileRaster,
  TileRasteriser,
  TileRequest,
} from './captureTiles.js';
export { useRecaptureOnSettle } from './captureRecapture.js';
export type { RecaptureOnSettleOptions } from './captureRecapture.js';

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
export type { GrabDragEnd, GrabDragMove, HandleKeyEvent, HandlePointerEvent, PreviewExit, PreviewOut } from './dragToClose.js';
export type { CssStyle, ElementProps } from './cssStyle.js';

export { default as PanelFrame } from './PanelFrame.js';
export {
  PANEL_CORNER_RADIUS_UNITS,
  PHONE_FRAME_ATTRIBUTE,
  panelCornerRadiusPx,
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
export { usePhoneFit, type PhoneFitResult } from './usePhoneFit.js';

export type { PanelAnchor } from './panelRowOrder.js';
export type { NeighborWidths, PanelRowEntry } from './panelRowEntry.js';
export { DEFAULT_PANEL_SIZE, panelWidthOf } from './panelTiers.js';
export { computeRowLayout } from './panelRowLayout.js';
export { minWorkspaceWidth } from './minWorkspaceWidth.js';
export type { MinWorkspaceWidthInput } from './minWorkspaceWidth.js';
export type { RowLayoutInput, RowLayoutResult } from './panelRowLayout.js';
export { computeRowNumbers } from './rowNumbers.js';
export type { RowNumbers } from './rowNumbers.js';
export { PanelRow, usePanelCapabilities, usePanelNeighborWidths, usePanelReorderSteps, usePanelTuning } from './PanelRow.js';
export { usePanelRowDrop } from './usePanelRowDrop.js';
export type { PanelRowDrop } from './usePanelRowDrop.js';
export { slideToTransition } from './directionalTransition.js';
export { GAP, PANEL_TRANSITION, PanelSizeBox, usePanelSizeGlide, type PanelSizeGlide } from './PanelRowSlot.js';
export { PanelHeaderButtons, usePanelHeaderButtons } from './panelHeaderButtons.js';
export { PanelSizeControl, type PanelSizeControlProps } from './panelSizeControl.js';
export { PanelFooter } from './panelFooter.js';
export type { PanelHeaderButtonItem, PanelHeaderButtonItemBase, PanelHeaderIconItem, PanelHeaderTextItem } from './panelHeaderButtons.js';
export { Workspace } from './Workspace.js';
export type { WorkspaceProps } from './Workspace.js';
export { WorkspacePanel, WorkspaceTrash } from './WorkspacePanel.js';
export type { WorkspacePanelProps, WorkspaceTrashProps } from './WorkspacePanel.js';
export type { WorkspacePanelEntry, WorkspaceTileCounts, WorkspaceTileSize } from './workspacePanelModel.js';
export { useProvidePanels } from './panels/useProvidePanels.js';
export { feedRowWheel } from './panels/useRowScrollGesture.js';
export type { PanelsInput, ProvidedPanels } from './panels/useProvidePanels.js';
export type { PanelWindow } from './panelWindow.js';
export { reorderStepsForOffset } from './panelWindow.js';

export { createDefaultTheme, PhonuxThemeProvider } from './defaultTheme.js';
export type { PhonuxTheme } from './defaultTheme.js';

export type { WorkspacePanelState, WorkspaceState, WorkspaceStorage } from './workspaceState.js';
export { isWorkspaceState } from './workspaceState.js';

export { PANEL_SETTINGS_CATALOG, LIBRARY_PANEL_DEFAULTS, LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
export type {
  PanelId,
  AnchorRequest,
  AddPlacement,
  Overflow,
  EnterFrom,
  ExitTo,
  ScrollAlign,
  ScrollOnOpen,
  ScrollOnMove,
  ScrollOnDrag,
  HeaderButtonContext,
  HeaderButton,
  HeaderButtonBase,
  HeaderButtonIconForm,
  HeaderButtonTextForm,
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
  WorkspaceTuning,
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
  PanelTouch,
  PanelViewProps,
  AnyPanelTemplate,
  PanelStatus,
  PanelState,
  ListFilter,
  PanelSnapshot,
  WorkspaceStatus,
  PanelReadHandle,
  ViewHandle,
  PanelReader,
} from './panelTemplate.js';

export { createWorkspace } from './workspaceCore.js';
export type { OccupantMove, OpenPlacement, OpenRow, PlaceOpen } from './openPlacement.js';
export { MAX_WORKSPACE_NAME } from './workspaceName.js';
export { createWorkspaceColumn } from './columnHandle.js';
export type { ColumnOptions, ColumnState, ColumnStatus, ColumnStorage, ColumnWorkspaceOptions, WorkspaceColumnHandle } from './columnHandle.js';
export { COLUMN_BOTTOM_BAND, COLUMN_TOP_BAND, WorkspaceColumn } from './WorkspaceColumn.js';
export {
  COLUMN_BAND_ATTRIBUTE,
  COLUMN_SLOT_ATTRIBUTE,
  columnBandRoom,
  DEFAULT_COLUMN_BANDS,
  NeighbourAboveSlot,
  NeighbourBelowSlot,
  WORKSPACE_NAME_CONTROL_HEIGHT,
  WORKSPACE_NAME_INPUT_ATTRIBUTE,
  withSlotChanges,
  WorkspaceNameSlot,
} from './columnBands.js';
export type { AddedColumnSlot, ColumnBand, ColumnBands, ColumnSlot, ColumnSlotChanges, ColumnSlotProps } from './columnBands.js';
export type { WorkspaceColumnProps } from './WorkspaceColumn.js';
export type { AddPanelOptions, MovePanelOptions, MovePanelResult, ViewWorkspace, WorkspaceHandle, WorkspaceOptions, WorkspaceWrapProps } from './workspaceCore.js';
export type { WorkspaceLive, WorkspacePanelsInput } from './workspaceLive.js';
export type { PanelHandle } from './panelHandles.js';
export type { ConfigureResult, PanelManager, PanelResult, ResetResult } from './panelManager.js';
export { usePanelStates, usePanelState, useWorkspace, useWorkspaceManager } from './panels/usePanelStates.js';
export { ACTIVE_ATTRIBUTE, CHROME_ATTRIBUTE, CHROME_PARTS, DRAGGING_ATTRIBUTE, useActivePanel, usePanelActive, usePanelDragProps, usePanelDragging, usePanelResizing, usePanelSetDragging, usePanelSliding } from './panelChrome.js';
export type { PanelRect, PanelRectEvent } from './panelChrome.js';
export type { ChromePart } from './panelChrome.js';
export { usePanelPresence } from './panelPresence.js';
export type { PanelPresence, PanelPresenceReason } from './panelPresence.js';

export { PanelManagerError } from './panelManagerError.js';
export type { PanelRefusal, PanelManagerErrorCode } from './panelManagerError.js';
export { usePanelDots, type PanelDots } from './usePanelDots.js';
export { useWorkspaceRow, type WorkspaceRow, type WorkspaceRowEntry } from './workspaceRow.js';

export {
  PANEL_ROOT_ATTRIBUTE,
  ROW_ID_ATTRIBUTE,
  ROW_SCROLLER_ATTRIBUTE,
  ROW_SLOT_ATTRIBUTE,
  ROW_STRIP_ATTRIBUTE,
  WORKSPACE_CELL_ATTRIBUTE,
  WORKSPACE_COLUMN_ATTRIBUTE,
  panelRootOf,
  rowPanelIdOf,
} from './rowDom.js';
export { MAXIMIZED_ATTRIBUTE, toggleMaximize, usePanelMaximize } from './panelMaximize.js';
export type { PanelMaximize } from './panelMaximize.js';
export { maximizedPanel, useMaximizedPanel } from './maximizedStore.js';
export type { MaximizablePanel, MaximizePhase } from './maximizedStore.js';
export { stepRow } from './rowStep.js';
export { useRowFrameBand } from './rowFrameBand.js';
export type { RowFrameBand } from './rowFrameBand.js';
export { PANEL_BAR_HEIGHT_PX, PANEL_FOOTER_ROOM_PX, rowFootReserve } from './panelChromeSize.js';
export { showPanels, whenAccepted, whenColumnReady, whenPanel } from './panelWaits.js';
export type { WaitOptions } from './panelWaits.js';
