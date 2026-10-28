// The tile-picture controller: the policy (faded or hidden panels, one-color pictures), a bounded store with
// least-recently-touched eviction, and persistence through a host-supplied storage. The rasterizer is injected, so
// this module draws nothing and names no location where pictures are kept.
import { isFadedOrHidden, isOneColour, tilePictureBox } from './capturePolicy.js';
// Defaults for a host that sets no bound; each is a bound the host may raise or lower.
const DEFAULT_MAX_PICTURES = 60;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
/** Builds a tile-picture controller. @public */
export function createTileCapture(options) {
    const { rasterise, storage } = options;
    const maxPictures = options.maxPictures ?? DEFAULT_MAX_PICTURES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const registered = new Map();
    const entries = new Map();
    let bytes = 0;
    let nextTouch = 1;
    // Per id, so evicting one panel never discards another panel's capture still in flight.
    const generations = new Map();
    const generationOf = (viewId) => generations.get(viewId) ?? 0;
    const listeners = new Map();
    let restored = false;
    // Evicted before restore read storage: the stored copy must not come back.
    const evictedBeforeRestore = new Set();
    // Storage writes run in order and only after restore has read the store, so a read never sees a half-applied write.
    let openWrites = () => { };
    let writes = new Promise((resolve) => {
        openWrites = resolve;
    });
    const enqueue = (task) => {
        writes = writes.then(task).catch(() => undefined);
    };
    const notify = (viewId) => {
        for (const listener of listeners.get(viewId) ?? [])
            listener();
    };
    /** Removes a panel's picture from memory. Returns whether one was there. */
    const forget = (viewId) => {
        const entry = entries.get(viewId);
        if (!entry)
            return false;
        entries.delete(viewId);
        bytes -= entry.snapshot.src.length;
        return true;
    };
    const leastRecentlyTouched = (except) => {
        let victim;
        let oldest = Number.POSITIVE_INFINITY;
        for (const [viewId, entry] of entries) {
            if (viewId === except)
                continue;
            if (entry.touch < oldest) {
                oldest = entry.touch;
                victim = viewId;
            }
        }
        return victim;
    };
    /** Drops least-recently-touched pictures, other than `except`, until both caps hold. Returns the dropped ids. */
    const enforceCaps = (except) => {
        const dropped = [];
        while (entries.size > maxPictures || bytes > maxBytes) {
            const victim = leastRecentlyTouched(except);
            if (victim === undefined)
                break;
            forget(victim);
            dropped.push(victim);
            notify(victim);
        }
        return dropped;
    };
    const register = (viewId, el, extent) => {
        registered.set(viewId, { el, extent });
        return () => {
            // Only this registration's own entry: a later register() of the same id must not be undone by an older cleanup.
            if (registered.get(viewId)?.el === el)
                registered.delete(viewId);
        };
    };
    /** Measures, rasterizes and checks one picture. Null when there is nothing worth keeping. */
    const pictureOf = async (el, extent) => {
        await imagesSettled(el);
        if (!el.isConnected)
            return null;
        if (isFadedOrHidden(el))
            return null;
        // 'full' is the scroll extent, past what is visible; the client extent is what the viewport shows.
        const width = extent === 'full' ? el.scrollWidth : el.clientWidth;
        const height = extent === 'full' ? el.scrollHeight : el.clientHeight;
        if (width <= 0 || height <= 0)
            return null;
        const box = tilePictureBox(width, height);
        const raster = await rasterise({ element: el, extent, width, height, pictureWidth: box.width, pictureHeight: box.height });
        if (!raster?.src.startsWith('data:image/'))
            return null;
        if (raster.pixels.length !== box.width * box.height * 4)
            return null;
        // The panel may have faded while the rasterizer ran; its picture then shows the fade.
        if (isFadedOrHidden(el))
            return null;
        // A picture of one color is a blank or transparent panel: the last good picture stays.
        if (isOneColour(raster.pixels))
            return null;
        return { src: raster.src, width, height };
    };
    /** Stores a picture as the newest, then drops the least-recently-touched others to meet the caps. */
    const store = (viewId, picture, extent, capturedAt) => {
        // A picture that could never fit leaves the last good one in place.
        if (maxPictures < 1 || picture.src.length > maxBytes)
            return;
        forget(viewId);
        const touch = nextTouch++;
        const snapshot = { viewId, src: picture.src, width: picture.width, height: picture.height, extent, capturedAt, stale: false };
        entries.set(viewId, { snapshot, touch });
        bytes += picture.src.length;
        const dropped = enforceCaps(viewId);
        if (storage) {
            const record = { viewId, src: picture.src, width: picture.width, height: picture.height, extent, capturedAt, touch };
            enqueue(() => storage.write(record));
            if (dropped.length > 0)
                enqueue(() => storage.remove(dropped));
        }
        notify(viewId);
    };
    const capture = (viewId) => {
        const target = registered.get(viewId);
        // A faded or hidden panel would draw over its last good picture.
        if (!target || isFadedOrHidden(target.el))
            return;
        // Sampled now, before the async work: an evict in this same tick must already count against this capture.
        const generation = generationOf(viewId);
        const { el, extent } = target;
        Promise.resolve()
            .then(() => pictureOf(el, extent))
            // The caller is fire-and-forget and has nothing to catch with; a failed capture is a missing picture.
            .catch(() => null)
            .then((picture) => {
            if (!picture || generationOf(viewId) !== generation)
                return;
            store(viewId, picture, extent, Date.now());
        });
    };
    const evict = (viewId) => {
        generations.set(viewId, generationOf(viewId) + 1);
        if (!restored)
            evictedBeforeRestore.add(viewId);
        if (forget(viewId))
            notify(viewId);
        if (storage)
            enqueue(() => storage.remove([viewId]));
    };
    const get = (viewId) => entries.get(viewId)?.snapshot ?? null;
    const subscribe = (viewId, listener) => {
        let set = listeners.get(viewId);
        if (!set) {
            set = new Set();
            listeners.set(viewId, set);
        }
        set.add(listener);
        return () => {
            set.delete(listener);
            if (set.size === 0)
                listeners.delete(viewId);
        };
    };
    const restore = async (liveIds) => {
        const live = new Set(liveIds);
        let stored = [];
        if (storage) {
            try {
                stored = await storage.readAll();
            }
            catch {
                stored = [];
            }
        }
        const changed = new Set();
        for (const record of stored) {
            if (!live.has(record.viewId) || evictedBeforeRestore.has(record.viewId) || entries.has(record.viewId))
                continue;
            const snapshot = {
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
        const gone = [];
        for (const viewId of [...entries.keys()]) {
            if (live.has(viewId))
                continue;
            forget(viewId);
            gone.push(viewId);
            changed.add(viewId);
        }
        for (const record of stored)
            if (!live.has(record.viewId))
                gone.push(record.viewId);
        const capped = enforceCaps();
        for (const viewId of capped)
            changed.add(viewId);
        restored = true;
        evictedBeforeRestore.clear();
        if (storage) {
            const removals = [...new Set([...gone, ...capped])];
            if (removals.length > 0)
                enqueue(() => storage.remove(removals));
        }
        openWrites();
        for (const viewId of changed)
            notify(viewId);
    };
    return { register, capture, evict, get, subscribe, restore };
}
/** How long a capture waits for a panel's pictures to load before it takes what is there. */
const IMAGE_WAIT_MS = 5000;
/** Settles once every `<img>` under `el` has loaded or failed, or after `IMAGE_WAIT_MS`: a panel still loading is not pictured blank. */
function imagesSettled(el) {
    const pending = [...el.querySelectorAll('img')].filter((img) => !img.complete);
    if (pending.length === 0)
        return Promise.resolve();
    return new Promise((resolve) => {
        let left = pending.length;
        const timer = setTimeout(resolve, IMAGE_WAIT_MS);
        const one = () => {
            left -= 1;
            if (left > 0)
                return;
            clearTimeout(timer);
            resolve();
        };
        for (const img of pending) {
            img.addEventListener('load', one, { once: true });
            img.addEventListener('error', one, { once: true });
        }
    });
}
