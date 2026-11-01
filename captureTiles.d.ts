import type { CaptureRegistry, CaptureTrigger, SnapshotsAPI, ViewId } from './snapshots.js';
/** A picture's stored form: what `TilePictureStorage` reads and writes. Plain data, so any storage can hold it. @public */
export interface TilePictureRecord {
    /** The panel the picture shows. */
    readonly viewId: ViewId;
    /** A data: URL for an <img>. Its length is what the byte cap counts. */
    readonly src: string;
    /** CSS px of the view photographed. */
    readonly width: number;
    /** CSS px of the view photographed. */
    readonly height: number;
    /** The extent the picture covers: 'viewport' or 'full'. */
    readonly extent: 'viewport' | 'full';
    /** Epoch ms of the capture. */
    readonly capturedAt: number;
    /** Ordering of the last capture: a larger number is more recent. */
    readonly touch: number;
}
/**
 * Where the host keeps pictures between relaunches. The library never picks a place; the host supplies the
 * implementation. Every method may reject; the controller treats a failed write as a picture that is not kept.
 * @public
 */
export interface TilePictureStorage {
    /** Every stored record. Called once, by `TileCapture.restore`. */
    readAll(): Promise<readonly TilePictureRecord[]>;
    /** Writes the record for `record.viewId`, replacing any earlier one. */
    write(record: TilePictureRecord): Promise<void>;
    /** Removes the records for these panels. Removing an absent record is not an error. */
    remove(viewIds: readonly ViewId[]): Promise<void>;
}
/** What the rasteriser is asked to draw. @public */
export interface TileRequest {
    /**
     * The live panel element. Read it before the returned promise settles; the panel may leave the page soon after
     * the capture is requested.
     */
    readonly element: HTMLElement;
    /** The extent to draw: 'viewport' (visible size) or 'full' (scroll size). */
    readonly extent: 'viewport' | 'full';
    /** The view's size in CSS px. */
    readonly width: number;
    /** The view's size in CSS px. */
    readonly height: number;
    /** The picture's width in pixels, at most 260. Draw at exactly this size. */
    readonly pictureWidth: number;
    /** The picture's height in pixels, at most 520. Draw at exactly this size. */
    readonly pictureHeight: number;
}
/** A rasterised picture. @public */
export interface TileRaster {
    /** A data: image URL, WebP where the browser can encode it. */
    readonly src: string;
    /** RGBA pixels of the picture, exactly `pictureWidth * pictureHeight * 4` long. Used to reject one-color pictures. */
    readonly pixels: Uint8ClampedArray;
}
/**
 * The host's rasteriser: draws a panel to a picture of the requested size. Resolve `null` when there is nothing to
 * draw. Never called for a faded or hidden panel. @public
 */
export type TileRasteriser = (request: TileRequest) => Promise<TileRaster | null>;
/** Options for `createTileCapture`. @public */
export interface TileCaptureOptions {
    /** Draws a panel. The library bundles no DOM capture package; this is the only way a picture is made. */
    readonly rasterise: TileRasteriser;
    /**
     * Where pictures persist across relaunches. Without it pictures live in memory only.
     * @defaultValue none (memory only)
     */
    readonly storage?: TilePictureStorage;
    /**
     * The most pictures kept, in memory and in storage.
     * @defaultValue 60
     */
    readonly maxPictures?: number;
    /**
     * The most bytes kept, counted as the length of each picture's data URL, in memory and in storage.
     * @defaultValue 10485760
     */
    readonly maxBytes?: number;
}
/**
 * The tile-picture controller: a `CaptureRegistry` for panels, a `CaptureTrigger` for the host's park, close and
 * evict moments, and the `SnapshotsAPI` a `HostProvider` reads from. @public
 */
export interface TileCapture extends CaptureRegistry, CaptureTrigger, SnapshotsAPI {
    /**
     * Loads the stored pictures. Pictures of panels not in `liveIds` are removed, here and in storage. Until this
     * resolves, pictures captured in this session are kept and nothing is written to storage. Call it once, at mount.
     */
    restore(liveIds: readonly ViewId[]): Promise<void>;
}
/** Builds a tile-picture controller. @public */
export declare function createTileCapture(options: TileCaptureOptions): TileCapture;
