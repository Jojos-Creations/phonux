// What Embla reads that jsdom lacks: breakpoints through matchMedia, slides in view through IntersectionObserver.
const g = globalThis as unknown as { window: Window & typeof globalThis; IntersectionObserver?: unknown };
g.window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
class NoIntersections {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
g.IntersectionObserver ??= NoIntersections;
(g.window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoIntersections;
