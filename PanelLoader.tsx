/**
 * What a panel shows while its content loads. A placeholder is up from the first frame, so a panel is never an empty space.
 * The host gets a short window to say what the placeholder shows, and the generic one stands in otherwise. The content comes
 * in when `load` resolves. A failed or timed-out load ends in a view with a way to try again, so a load always ends somewhere.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';

/** How long the host has to say what the placeholder shows, in ms. @public */
export const PANEL_PLACEHOLDER_WINDOW_MS = 200;
/** How long a load may take before the panel offers to try again, in ms. @public */
export const PANEL_LOAD_TIMEOUT_MS = 15_000;
/** How long the placeholder takes to fade off the content, in ms. */
const FADE_MS = 120;
/** One breath of the generic placeholder, in ms. */
const PULSE_MS = 1400;

/** Why a load ended without content. @public */
export type PanelLoadFailure = 'error' | 'timeout';

/** The props of `PanelLoader`. @public */
export interface PanelLoaderProps {
  /** Resolves when the content is ready to show. */
  readonly load: () => Promise<unknown>;
  /** The content, mounted once `load` resolves. */
  readonly children: React.ReactNode;
  /** What the placeholder shows. A promise must resolve inside `windowMs`; a later answer is dropped, so the placeholder never swaps late. */
  readonly placeholder?: () => React.ReactNode | Promise<React.ReactNode>;
  /** The view for a failed load. When omitted, a line of text and a Try again button. */
  readonly failed?: (retry: () => void, why: PanelLoadFailure) => React.ReactNode;
  /** The host's window, in ms. Default `PANEL_PLACEHOLDER_WINDOW_MS`. */
  readonly windowMs?: number;
  /** The load's time limit, in ms. Default `PANEL_LOAD_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

const FILL = { position: 'absolute', inset: 0 } as const;

/**
 * Blocks in the shape of a page. They are still until the host's window closes, so a quick load shows no motion at all.
 * The pulse and the fade below use the Web Animations API: a theme's `animation: none` and `transition: none` reset would silence CSS.
 */
function GenericPlaceholder({ windowMs, still }: { windowMs: number; still: boolean }): React.JSX.Element {
  const block = { bgcolor: 'action.hover', borderRadius: 1 } as const;
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (still) return undefined;
    const pulses = [...(box.current?.children ?? [])].map((el) => el.animate?.([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], { duration: PULSE_MS, delay: windowMs, iterations: Infinity, easing: 'ease-in-out' }));
    return () => pulses.forEach((pulse) => pulse?.cancel());
  }, [windowMs, still]);
  return (
    <Box
      ref={box}
      data-panel-placeholder="generic"
      sx={{ ...FILL, display: 'flex', flexDirection: 'column', gap: 1.5, p: 2, bgcolor: 'background.paper' }}
    >
      <Box sx={{ ...block, flex: 1 }} />
      <Box sx={{ ...block, height: 16, width: '70%' }} />
      <Box sx={{ ...block, height: 16, width: '45%' }} />
    </Box>
  );
}

/** Shows `placeholder` until `load` resolves, then `children`. Mount it where the content goes; it fills its parent. @public */
export function PanelLoader({ load, children, placeholder, failed, windowMs = PANEL_PLACEHOLDER_WINDOW_MS, timeoutMs = PANEL_LOAD_TIMEOUT_MS }: PanelLoaderProps): React.JSX.Element {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const configReduced = useReducedMotionConfig() === true;
  const systemReduced = useReducedMotion() === true;
  const still = configReduced || systemReduced;
  const [attempt, setAttempt] = React.useState(0);
  const [outcome, setOutcome] = React.useState<'waiting' | 'ready' | PanelLoadFailure>('waiting');
  const [custom, setCustom] = React.useState<{ node: React.ReactNode } | null>(null);
  const [covering, setCovering] = React.useState(true);
  const given = React.useRef({ load, placeholder });
  given.current = { load, placeholder };

  React.useEffect(() => {
    let current = true;
    let windowOpen = true;
    setOutcome('waiting');
    setCovering(true);
    const windowTimer = setTimeout(() => { windowOpen = false; }, windowMs);
    const limit = setTimeout(() => { if (current) setOutcome((was) => (was === 'waiting' ? 'timeout' : was)); }, timeoutMs);
    const asked = given.current.placeholder?.();
    // A sync answer is up on this commit; a promise only counts inside the window.
    if (asked !== undefined) void Promise.resolve(asked).then((node) => { if (current && windowOpen) setCustom({ node }); }, () => undefined);
    // A late success still wins over the timeout: the content is what the person came for.
    given.current.load().then(
      () => { if (current) setOutcome('ready'); },
      () => { if (current) setOutcome('error'); },
    );
    return () => {
      current = false;
      clearTimeout(windowTimer);
      clearTimeout(limit);
    };
  }, [attempt, windowMs, timeoutMs]);

  const cover = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (outcome !== 'ready') return undefined;
    if (still) { setCovering(false); return undefined; }
    const fade = cover.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' });
    const done = setTimeout(() => setCovering(false), FADE_MS);
    return () => {
      clearTimeout(done);
      fade?.cancel();
    };
  }, [outcome, still]);

  const retry = (): void => setAttempt((n) => n + 1);
  const why = outcome === 'error' || outcome === 'timeout' ? outcome : null;
  return (
    <Box data-panel-loader={why === null ? outcome : 'failed'} sx={{ position: 'relative', flex: 1, minHeight: 0, width: '100%', height: '100%' }}>
      {outcome === 'ready' && children}
      {why !== null && (
        <Box data-panel-load-failed={why} role="alert" sx={{ ...FILL, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, p: 2, textAlign: 'center', bgcolor: 'background.paper', fontSize: 13 }}>
          {failed ? failed(retry, why) : <>{labels.couldNotLoad}<Button size="small" data-panel-load-retry="" onClick={retry}>{labels.tryAgain}</Button></>}
        </Box>
      )}
      {why === null && covering && (
        <Box ref={cover} aria-busy={outcome === 'waiting'} sx={{ ...FILL, pointerEvents: 'none' }}>
          <GenericPlaceholder windowMs={windowMs} still={still} />
          {custom && <Box data-panel-placeholder="host" sx={{ ...FILL, bgcolor: 'background.paper' }}>{custom.node}</Box>}
        </Box>
      )}
    </Box>
  );
}
