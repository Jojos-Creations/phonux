// The tile-picture controller: the policy (faded or hidden panels, one-color pictures), a bounded store with
// least-recently-touched eviction, and persistence through a host-supplied storage. The rasteriser is injected, so
// this module draws nothing and names no location where pictures are kept.

import type { CaptureRegistry, CaptureTrigger, SnapshotsAPI, ViewId, ViewSnapshot } from './snapshots.js';
import { isFadedOrHidden, isOneColour, tilePictureBox } from './capturePolicy.js';

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

// Defaults for a host that sets no bound; each is a bound the host may raise or lower.
const DEFAULT_MAX_PICTURES = 60;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

interface Entry {
  readonly snapshot: ViewSnapshot;
  readonly touch: number;
}

interface Picture {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** Builds a tile-picture controller. @public */
export function createTileCapture(options: TileCaptureOptions): TileCapture {
  const { rasterise, storage } = options;
  const maxPictures = options.maxPictures ?? DEFAULT_MAX_PICTURES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const registered = new Map<ViewId, { el: HTMLElement; extent: 'viewport' | 'full' }>();
  const entries = new Map<ViewId, Entry>();
  let bytes = 0;
  let nextTouch = 1;
  // Per id, so evicting one panel never discards another panel's capture still in flight.
  const generations = new Map<ViewId, number>();
  const generationOf = (viewId: ViewId): number => generations.get(viewId) ?? 0;
  const listeners = new Map<ViewId, Set<() => void>>();

  let restored = false;
  // Evicted before restore read storage: the stored copy must not come back.
  const evictedBeforeRestore = new Set<ViewId>();
  // Storage writes run in order and only after restore has read the store, so a read never sees a half-applied write.
  let openWrites: () => void = () => {};
  let writes: Promise<void> = new Promise<void>((resolve) => {
    openWrites = resolve;
  });
  const enqueue = (task: () => Promise<void>): void => {
    writes = writes.then(task).catch(() => undefined);
  };

  const notify = (viewId: ViewId): void => {
    for (const listener of listeners.get(viewId) ?? []) listener();
  };

  /** Removes a panel's picture from memory. Returns whether one was there. */
  const forget = (viewId: ViewId): boolean => {
    const entry = entries.get(viewId);
    if (!entry) return false;
    entries.delete(viewId);
    bytes -= entry.snapshot.src.length;
    return true;
  };

  const leastRecentlyTouched = (except?: ViewId): ViewId | undefined => {
    let victim: ViewId | undefined;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [viewId, entry] of entries) {
      if (viewId === except) continue;
      if (entry.touch < oldest) {
        oldest = entry.touch;
        victim = viewId;
      }
    }
    return victim;
  };

  /** Drops least-recently-touched pictures, other than `except`, until both caps hold. Returns the dropped ids. */
  const enforceCaps = (except?: ViewId): ViewId[] => {
    const dropped: ViewId[] = [];
    while (entries.size > maxPictures || bytes > maxBytes) {
      const victim = leastRecentlyTouched(except);
      if (victim === undefined) break;
      forget(victim);
      dropped.push(victim);
      notify(victim);
    }
    return dropped;
  };

  const register: CaptureRegistry['register'] = (viewId, el, extent) => {
    registered.set(viewId, { el, extent });
    return () => {
      // Only this registration's own entry: a later register() of the same id must not be undone by an older cleanup.
      if (registered.get(viewId)?.el === el) registered.delete(viewId);
    };
  };

  /** Measures, rasterises and checks one picture. Null when there is nothing worth keeping. */
  const pictureOf = async (el: HTMLElement, extent: 'viewport' | 'full'): Promise<Picture | null> => {
    if (isFadedOrHidden(el)) return null;
    // 'full' is the scroll extent, past what is visible; the client extent is what the viewport shows.
    const width = extent === 'full' ? el.scrollWidth : el.clientWidth;
    const height = extent === 'full' ? el.scrollHeight : el.clientHeight;
    if (width <= 0 || height <= 0) return null;
    const box = tilePictureBox(width, height);
    const raster = await rasterise({ element: el, extent, width, height, pictureWidth: box.width, pictureHeight: box.height });
    if (!raster?.src.startsWith('data:image/')) return null;
    if (raster.pixels.length !== box.width * box.height * 4) return null;
    // The panel may have faded while the rasteriser ran; its picture then shows the fade.
    if (isFadedOrHidden(el)) return null;
    // A picture of one color is a blank or transparent panel: the last good picture stays.
    if (isOneColour(raster.pixels)) return null;
    return { src: raster.src, width, height };
  };

  /** Stores a picture as the newest, then drops the least-recently-touched others to meet the caps. */
  const store = (viewId: ViewId, picture: Picture, extent: 'viewport' | 'full', capturedAt: number): void => {
    // A picture that could never fit leaves the last good one in place.
    if (maxPictures < 1 || picture.src.length > maxBytes) return;
    forget(viewId);
    const touch = nextTouch++;
    const snapshot: ViewSnapshot = { viewId, src: picture.src, width: picture.width, height: picture.height, extent, capturedAt, stale: false };
    entries.set(viewId, { snapshot, touch });
    bytes += picture.src.length;
    const dropped = enforceCaps(viewId);
    if (storage) {
      const record: TilePictureRecord = { viewId, src: picture.src, width: picture.width, height: picture.height, extent, capturedAt, touch };
      enqueue(() => storage.write(record));
      if (dropped.length > 0) enqueue(() => storage.remove(dropped));
    }
    notify(viewId);
  };

  const capture: CaptureTrigger['capture'] = (viewId) => {
    const target = registered.get(viewId);
    // A faded or hidden panel would draw over its last good picture.
    if (!target || isFadedOrHidden(target.el)) return;
    // Sampled now, before the async work: an evict in this same tick must already count against this capture.
    const generation = generationOf(viewId);
    const { el, extent } = target;
    Promise.resolve()
      .then(() => pictureOf(el, extent))
      // The caller is fire-and-forget and has nothing to catch with; a failed capture is a missing picture.
      .catch(() => null)
      .then((picture) => {
        if (!picture || generationOf(viewId) !== generation) return;
        store(viewId, picture, extent, Date.now());
      });
  };

  const evict: CaptureTrigger['evict'] = (viewId) => {
    generations.set(viewId, generationOf(viewId) + 1);
    if (!restored) evictedBeforeRestore.add(viewId);
    if (forget(viewId)) notify(viewId);
    if (storage) enqueue(() => storage.remove([viewId]));
  };

  const get: SnapshotsAPI['get'] = (viewId) => entries.get(viewId)?.snapshot ?? null;

  const subscribe: SnapshotsAPI['subscribe'] = (viewId, listener) => {
    let set = listeners.get(viewId);
    if (!set) {
      set = new Set();
      listeners.set(viewId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(viewId);
    };
  };

  const restore: TileCapture['restore'] = async (liveIds) => {
    const live = new Set(liveIds);
    let stored: readonly TilePictureRecord[] = [];
    if (storage) {
      try {
        stored = await storage.readAll();
      } catch {
        stored = [];
      }
    }
    const changed = new Set<ViewId>();
    for (const record of stored) {
      if (!live.has(record.viewId) || evictedBeforeRestore.has(record.viewId) || entries.has(record.viewId)) continue;
      const snapshot: ViewSnapshot = {
        viewId: record.viewId,
        src: record.src,
        width: record.width,
        height: record.height,
        extent: record.extent,
        capturedAt: record.capturedAt,
        stale: false,
      };
      entries.set(record.viewId, { snapshot, touch: record.touch });
      bytes += record.src.length;
      nextTouch = Math.max(nextTouch, record.touch + 1);
      changed.add(record.viewId);
    }
    const gone: ViewId[] = [];
    for (const viewId of [...entries.keys()]) {
      if (live.has(viewId)) continue;
      forget(viewId);
      gone.push(viewId);
      changed.add(viewId);
    }
    for (const record of stored) if (!live.has(record.viewId)) gone.push(record.viewId);
    const capped = enforceCaps();
    for (const viewId of capped) changed.add(viewId);
    restored = true;
    evictedBeforeRestore.clear();
    if (storage) {
      const removals = [...new Set([...gone, ...capped])];
      if (removals.length > 0) enqueue(() => storage.remove(removals));
    }
    openWrites();
    for (const viewId of changed) notify(viewId);
  };

  return { register, capture, evict, get, subscribe, restore };
}
