/**
 * The `phonux/testing/row` entry: a driver that renders a workspace with the real engine in a jsdom window, on a virtual frame
 * clock, so a test steps frames instead of waiting on real time. Import it before `react` and before anything that loads
 * `motion`: it installs the jsdom window and the clock, and motion binds its frame loop to the clock it finds at load.
 * The fake host stays record-only; this is a separate tool for the tests that need the row itself. Why: DESIGN.md, "Testing without a host".
 */
import { FRAME_MS, frameClock } from './testingClock.js';
export { FRAME_MS, frameClock };
/**
 * What `renderWorkspace` needs of a workspace: any `WorkspaceHandle` is one. Named here, not borrowed, so this entry's
 * declaration reaches no type the entry does not export.
 * @public
 */
export interface RenderableWorkspace {
    /** Where the workspace is in its life; the driver waits for 'ready'. */
    readonly status: string;
    /** Read access to the workspace's panels. */
    readonly panels: {
        /** The handle of the panel with this id (its key), or undefined when the workspace knows none. */
        get(id: string): {
            getState(): {
                readonly engineId: string | null;
            };
        } | undefined;
        /** A handle for every panel. */
        list(): ReadonlyArray<{
            getState(): {
                readonly engineId: string | null;
            };
        }>;
    };
    /** Takes the workspace away. */
    dispose(): void;
}
/** The drawn parts of one panel; a part the panel does not draw is null. @public */
export interface RenderedPanel {
    /** The row slot holding the panel. */
    readonly root: HTMLElement;
    /** The panel's header row. */
    readonly header: HTMLElement | null;
    /** The strip a person grabs to drag the panel. */
    readonly grabBar: HTMLElement | null;
    /** The panel's footer. */
    readonly footer: HTMLElement | null;
}
/** How a pointer drag is played: the pointer moves in equal steps, one frame apart, then rests before it lets go. @public */
export interface DragOptions {
    /** How far the pointer moves right, in px. */
    dx: number;
    /** How far the pointer moves down, in px. */
    dy: number;
    /** How many equal moves make the drag; 5 when left out. */
    steps?: number;
    /** How many frames the pointer rests before the release; 8 when left out. 0 releases at full speed, a flick. */
    hold?: number;
    /** Leave the pointer down; `release` lets go. */
    keepDown?: boolean;
}
/** What `renderWorkspace` hands a test. @public */
export interface RenderedWorkspace {
    /** The scroll container the workspace's row scrolls in. */
    readonly scroller: HTMLElement;
    /** The drawn parts of the panel with this id (its key); undefined while the panel is not in the row. */
    panel(id: string): RenderedPanel | undefined;
    /**
     * Runs `count` virtual frames, one at a time, with the renders and promise continuations each one causes.
     * @param count - How many frames to run.
     */
    frames(count: number): Promise<void>;
    /**
     * Gives the window a new size and runs frames until every animation has finished.
     * @param width - The window's width in px.
     * @param height - The window's height in px; left as it is when left out.
     */
    setWidth(width: number, height?: number): Promise<void>;
    /**
     * Plays a pointer drag on `target` (a part of a panel) and, unless `keepDown`, runs frames until every animation has finished.
     * @param target - The element the pointer goes down on.
     * @param options - The drag to play.
     */
    drag(target: Element, options: DragOptions): Promise<void>;
    /**
     * Lets go of a pointer a `keepDown` drag left down, then runs frames until every animation has finished.
     * @param dx - The pointer's total move right, in px, as the drag gave it.
     * @param dy - The pointer's total move down, in px, as the drag gave it.
     */
    release(dx: number, dy: number): Promise<void>;
    /**
     * Presses `target` as a person does (pointer down, pointer up, click), then runs frames until every animation has finished.
     * A press inside a panel not in use only puts it in use, so its target gets no click; press again to click it.
     * @param target - The element to press.
     */
    press(target: Element): Promise<void>;
    /** Takes the workspace away: disposes it and empties the document. */
    dispose(): Promise<void>;
}
/**
 * Renders `workspace` as the default start does, in a window of `size`, and resolves once the workspace is ready, its row is
 * drawn and every animation has finished. The workspace must render itself: one made with `mount: false` has nothing to drive.
 * Create the workspace after importing this entry, so there is a `document` for it to render into.
 * @param workspace - The workspace to render.
 * @param size - The window's size in px; 1000 wide and 800 tall when left out.
 * @public
 */
export declare function renderWorkspace(workspace: RenderableWorkspace, size?: {
    width: number;
    height?: number;
}): Promise<RenderedWorkspace>;
