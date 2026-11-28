import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { createSvgIcon } from '@mui/material/utils';
import type { PhonuxLabels } from './labels.js';
import { QrCode } from './qrCode.js';
import { CheckIcon, MIN_TOUCH_PX, useShareLabels } from './shareParts.js';

/** What the other side of an exchange has said so far. @public */
export interface TrustProgress {
  /** What they call themselves; null while they have said nothing. */
  theirName: string | null;
  /** They have answered, with or without letting this side send to them. */
  answered: boolean;
  /** This side can now send them files. */
  canSendToThem: boolean;
}

/** Why a call was refused: `not-a-code` is text that is no code at all, `ended` a code that is unknown or over. @public */
export type TrustFailure = 'not-a-code' | 'ended' | 'other';

/** One code exchange under way. `maker` made the code, `joiner` typed it. @public */
export interface TrustExchange {
  /** Which side this is. */
  readonly role: 'maker' | 'joiner';
  /** The code, shown as text and as a QR code to the maker. */
  readonly code: string;
  /** Epoch milliseconds the code stops working. */
  readonly endsAt: number;
  /** Reads what the other side said. Rejects with an error `failureOf` names `ended` once the code is over. */
  check(): Promise<TrustProgress>;
  /** Lets them send under `name`, until `expiresAt` (no end when left out). The maker's answer ends the exchange; the joiner's is followed by waiting for the maker. */
  allow(options: { name: string; expiresAt?: number }): Promise<void>;
  /** Answers without letting them send, with the same effect on the exchange as `allow`. */
  decline(): Promise<void>;
  /** Forgets the exchange on this side. */
  close(): void;
  /** Whether this side already answered, so a screen opened again does not ask again. */
  answered(): boolean;
}

/** The exchanges `TrustScreen` drives. @public */
export interface TrustExchanges {
  /** Makes a code; `name` is what this side calls itself to whoever takes it. */
  invite(name: string): Promise<TrustExchange>;
  /** Takes a code someone made. Rejects with an error `failureOf` can name. */
  join(code: string, name: string): Promise<TrustExchange>;
  /** The exchange left open earlier, or null. Read only once, on mount, and must answer at once. */
  pending(): TrustExchange | null;
  /** Names why a call rejected. */
  failureOf(error: unknown): TrustFailure;
}

/** What `TrustScreen` takes. @public */
export interface TrustScreenProps {
  /** The exchanges the screen makes, joins and answers. Its `pending()` is read once, on mount: to show another account's exchanges, remount the screen (give it a new `key`). */
  trust: TrustExchanges;
  /** Called when the exchange is over and the screen has nothing left to show. */
  onDone: () => void;
  /** Called when the close button is pressed; without it no close button is drawn. */
  onClose?: () => void;
  /** Called each time the trusted list may have changed, so the app can read it again. */
  onChanged?: () => void;
  /** How often a waiting screen asks the other side, in milliseconds. Defaults to 4000. */
  pollMs?: number;
  /** Words that replace the host's labels for this screen only. */
  labels?: Partial<PhonuxLabels>;
}

type Step =
  | { id: 'start' }
  | { id: 'code'; exchange: TrustExchange }
  | { id: 'waiting'; exchange: TrustExchange; theirName: string | null }
  | { id: 'decide'; exchange: TrustExchange; theirName: string }
  | { id: 'join' }
  | { id: 'answer'; exchange: TrustExchange; theirName: string }
  | { id: 'result'; exchange: TrustExchange; yes: boolean; theirName: string }
  | { id: 'ended'; role: 'maker' | 'joiner' };

type Length = 'none' | 'week' | 'month';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const endOf = (length: Length): number | undefined => (length === 'none' ? undefined : Date.now() + (length === 'week' ? 7 : 30) * DAY_MS);

const CloseIcon = createSvgIcon(<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />, 'Close');
const CopyIcon = createSvgIcon(<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z" />, 'ContentCopy');
const ClockIcon = createSvgIcon(<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />, 'Schedule');

const pill = { borderRadius: 999, textTransform: 'none', fontWeight: 600, minHeight: MIN_TOUCH_PX } as const;

function Field({ label, value, onChange, error, describedBy, autoFocus, mono }: { label: string; value: string; onChange: (value: string) => void; error?: boolean; describedBy?: string; autoFocus?: boolean; mono?: boolean }): React.ReactElement {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error === true}
      autoFocus={autoFocus === true}
      fullWidth
      slotProps={{ htmlInput: { maxLength: 64, spellCheck: false, autoComplete: 'off', ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }) }, input: { sx: { borderRadius: 3, ...(mono ? { fontFamily: 'ui-monospace, monospace' } : {}) } } }}
    />
  );
}

function Message({ id, children }: { id?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box id={id} role="alert" sx={{ color: 'error.main', fontSize: 'body2.fontSize' }}>
      {children}
    </Box>
  );
}

function CodeBlock({ code, labels }: { code: string; labels: PhonuxLabels }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const [refused, setRefused] = React.useState(false);
  const shown = React.useRef<HTMLElement>(null);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setRefused(false);
    } catch {
      // No permission, a page that is not secure or a web view with no clipboard: the code is selected so it can be copied by hand.
      setCopied(false);
      setRefused(true);
      const node = shown.current;
      if (node !== null) window.getSelection()?.selectAllChildren(node);
    }
  };
  return (
    <>
      <Box sx={{ display: 'grid', placeItems: 'center', p: 2, borderRadius: 3, bgcolor: 'action.hover' }}>
        <QrCode value={code} label={labels.trustQr} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, border: 1, borderColor: 'divider', borderRadius: 3, pl: 2, pr: 1, py: 0.5 }}>
        <Box ref={shown} data-phonux-trust-code="" sx={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 'body2.fontSize', overflowWrap: 'anywhere' }}>
          {code}
        </Box>
        <Button size="small" startIcon={<CopyIcon sx={{ fontSize: 14 }} aria-hidden="true" />} onClick={() => void copy()} sx={{ textTransform: 'none', fontWeight: 600 }}>
          {copied ? labels.trustCopied : labels.trustCopy}
        </Button>
      </Box>
      {refused ? <Message>{labels.trustFailed}</Message> : null}
      <Box sx={{ color: 'text.secondary', fontSize: 'body2.fontSize' }}>{labels.trustCodeNote}</Box>
    </>
  );
}

/**
 * The code exchange that adds someone the person trusts: make a code (shown as text and a QR code) or join with one, wait
 * for the other side, and answer. It draws no frame or backdrop, so the app places it in a dialog or a page.
 * @remarks An exchange `trust.pending()` names on mount is picked up where it was; a later `trust` is used for new calls, but
 * the screen does not read `pending()` again, so a different account needs a remount with a new `key`. The screen asks the other side every
 * `pollMs` only while it is mounted and a step is waiting, and stops on unmount.
 * @public
 */
export function TrustScreen(props: TrustScreenProps): React.ReactElement {
  const { trust, onDone, onClose, onChanged, pollMs = 4_000 } = props;
  const labels = useShareLabels(props.labels);
  const [step, setStep] = React.useState<Step>(() => {
    const pending = trust.pending();
    return pending ? { id: 'waiting', exchange: pending, theirName: null } : { id: 'start' };
  });
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [saveAs, setSaveAs] = React.useState('');
  const [length, setLength] = React.useState<Length>('none');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const live = React.useRef(true);
  const changed = React.useRef(onChanged);
  changed.current = onChanged;

  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const exchange = step.id === 'waiting' ? step.exchange : null;
  const progressed = React.useCallback((current: TrustExchange, seen: TrustProgress) => {
    if (!live.current) return;
    if (seen.canSendToThem) changed.current?.();
    if (current.role === 'maker') {
      if (seen.answered) {
        setSaveAs(seen.theirName ?? '');
        setStep({ id: 'decide', exchange: current, theirName: seen.theirName ?? '' });
      } else setStep({ id: 'waiting', exchange: current, theirName: null });
      return;
    }
    if (!current.answered()) {
      setSaveAs(seen.theirName ?? '');
      setStep({ id: 'answer', exchange: current, theirName: seen.theirName ?? '' });
    } else if (seen.answered) setStep({ id: 'result', exchange: current, yes: seen.canSendToThem, theirName: seen.theirName ?? '' });
    else setStep({ id: 'waiting', exchange: current, theirName: seen.theirName });
  }, []);

  React.useEffect(() => {
    if (!exchange) return;
    let stopped = false;
    const look = async (): Promise<void> => {
      try {
        const seen = await exchange.check();
        if (!stopped) progressed(exchange, seen);
      } catch (failure) {
        if (stopped || !live.current) return;
        if (trust.failureOf(failure) === 'ended') {
          exchange.close();
          setStep({ id: 'ended', role: exchange.role });
        }
      }
    };
    void look();
    const timer = setInterval(() => void look(), pollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [exchange, progressed, trust, pollMs]);

  const finish = (): void => {
    changed.current?.();
    onDone();
  };
  const guard = (run: () => Promise<void>) => async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch {
      if (live.current) setError(labels.trustFailed);
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const makeCode = guard(async () => {
    const made = await trust.invite(name.trim());
    if (live.current) setStep({ id: 'code', exchange: made });
  });
  const joinCode = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const joined = await trust.join(code, name.trim());
      const seen = await joined.check();
      if (!live.current) return;
      setSaveAs(seen.theirName ?? '');
      setStep({ id: 'answer', exchange: joined, theirName: seen.theirName ?? '' });
    } catch (failure) {
      const why = trust.failureOf(failure);
      if (live.current) setError(why === 'not-a-code' ? labels.trustNotACode : why === 'ended' ? labels.trustCodeEnded : labels.trustCouldNotReach);
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const allow = (current: TrustExchange, expiresAt: number | undefined): Promise<void> =>
    guard(async () => {
      await current.allow({ name: saveAs.trim(), ...(expiresAt === undefined ? {} : { expiresAt }) });
      if (current.role === 'maker') finish();
      else if (live.current) setStep({ id: 'waiting', exchange: current, theirName: saveAs.trim() });
    })();
  const decline = (current: TrustExchange): Promise<void> =>
    guard(async () => {
      await current.decline();
      if (current.role === 'maker') finish();
      else if (live.current) setStep({ id: 'waiting', exchange: current, theirName: null });
    })();
  const cancel = (current: TrustExchange): void => {
    current.close();
    onDone();
  };

  const hours = (current: TrustExchange): number => Math.max(0, Math.min(24, Math.ceil((current.endsAt - Date.now()) / HOUR_MS)));
  const nameOk = name.trim().length > 0;
  const saveOk = saveAs.trim().length > 0;
  const two = { display: 'flex', gap: 1 } as const;

  const titleId = React.useId();
  const errorId = React.useId();
  let title: string = labels.trustTitle;
  let body: React.ReactNode;
  if (step.id === 'start') {
    body = (
      <>
        <Field label={labels.trustNameLabel} value={name} onChange={setName} autoFocus />
        {error ? <Message>{error}</Message> : null}
        <Button variant="contained" disableElevation disabled={!nameOk || busy} onClick={() => void makeCode()} sx={pill}>
          {labels.trustMakeCode}
        </Button>
        <Button onClick={() => {
            setError(null);
            setStep({ id: 'join' });
          }} sx={pill}>
          {labels.trustHaveCode}
        </Button>
      </>
    );
  } else if (step.id === 'code') {
    const current = step.exchange;
    body = (
      <>
        <CodeBlock code={current.code} labels={labels} />
        <Button variant="contained" disableElevation onClick={() => setStep({ id: 'waiting', exchange: current, theirName: null })} sx={pill}>
          {labels.trustDoneWait}
        </Button>
      </>
    );
  } else if (step.id === 'join') {
    title = labels.trustJoinTitle;
    body = (
      <>
        <Field label={labels.trustCodeLabel} value={code} onChange={setCode} error={error !== null} {...(error ? { describedBy: errorId } : {})} autoFocus mono />
        {error ? <Message id={errorId}>{error}</Message> : null}
        <Field label={labels.trustNameLabel} value={name} onChange={setName} />
        <Button variant="contained" disableElevation disabled={!nameOk || code.trim() === '' || busy} onClick={() => void joinCode()} sx={pill}>
          {labels.trustJoin}
        </Button>
        <Button onClick={() => {
            setError(null);
            setStep({ id: 'start' });
          }} sx={pill}>
          {labels.trustMakeInstead}
        </Button>
      </>
    );
  } else if (step.id === 'waiting') {
    const current = step.exchange;
    const maker = current.role === 'maker';
    title = labels.trustWaitingFor(step.theirName);
    body = (
      <>
        <Box sx={{ color: 'text.secondary' }}>{maker ? labels.trustWaitingBody : labels.trustWaitingAnswer(step.theirName ?? '')}</Box>
        {maker ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, borderRadius: 3, bgcolor: 'action.hover', fontSize: 'body2.fontSize' }}>
            <ClockIcon sx={{ fontSize: 16 }} aria-hidden="true" />
            {labels.trustHoursLeft(hours(current))}
          </Box>
        ) : null}
        <Box sx={two}>
          {maker ? (
            <Button variant="outlined" color="inherit" onClick={() => setStep({ id: 'code', exchange: current })} sx={{ ...pill, flex: 1 }}>
              {labels.trustShowCode}
            </Button>
          ) : null}
          <Button variant="outlined" color="error" onClick={() => cancel(current)} sx={{ ...pill, flex: 1 }}>
            {labels.trustCancel}
          </Button>
        </Box>
      </>
    );
  } else if (step.id === 'decide') {
    const current = step.exchange;
    title = labels.trustWantsToSend(step.theirName || labels.trustTitle);
    body = (
      <>
        <Field label={labels.trustSaveAs} value={saveAs} onChange={setSaveAs} autoFocus />
        <ToggleButtonGroup exclusive fullWidth value={length} onChange={(_event, next: Length | null) => next && setLength(next)} aria-label={labels.trustHowLong} sx={{ bgcolor: 'action.hover', borderRadius: 3, p: 0.5, gap: 0.5 }}>
          {(
            [
              ['none', labels.trustNoEnd],
              ['week', labels.trustOneWeek],
              ['month', labels.trustOneMonth],
            ] as const
          ).map(([value, label]) => (
            <ToggleButton key={value} value={value} sx={{ border: 0, borderRadius: 2.5, textTransform: 'none', '&:not(.Mui-selected)': { color: 'text.primary' } }}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {error ? <Message>{error}</Message> : null}
        <Box sx={two}>
          <Button variant="outlined" color="inherit" disabled={busy} onClick={() => void decline(current)} sx={{ ...pill, flex: 1 }}>
            {labels.trustDecline}
          </Button>
          <Button variant="contained" disableElevation disabled={busy || !saveOk} onClick={() => void allow(current, endOf(length))} sx={{ ...pill, flex: 1 }}>
            {labels.trustAllow}
          </Button>
        </Box>
      </>
    );
  } else if (step.id === 'answer') {
    const current = step.exchange;
    title = labels.trustLetThemTitle(step.theirName || labels.trustTitle);
    body = (
      <>
        <Box sx={{ color: 'text.secondary' }}>{labels.trustLetThemBody(step.theirName)}</Box>
        <Field label={labels.trustSaveAs} value={saveAs} onChange={setSaveAs} autoFocus />
        {error ? <Message>{error}</Message> : null}
        <Box sx={two}>
          <Button variant="outlined" color="inherit" disabled={busy} onClick={() => void decline(current)} sx={{ ...pill, flex: 1 }}>
            {labels.trustNotNow}
          </Button>
          <Button variant="contained" disableElevation disabled={busy || !saveOk} onClick={() => void allow(current, undefined)} sx={{ ...pill, flex: 1 }}>
            {labels.trustLetThem}
          </Button>
        </Box>
      </>
    );
  } else if (step.id === 'result') {
    title = step.yes ? labels.trustSaidYes(step.theirName) : labels.trustDeclined(step.theirName);
    body = (
      <>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', color: 'text.secondary' }}>
          {step.yes ? <CheckIcon sx={{ fontSize: 20 }} aria-hidden="true" /> : null}
          {step.yes ? labels.trustSaidYesBody(step.theirName) : labels.trustDeclinedBody(step.theirName)}
        </Box>
        <Button
          variant="contained"
          disableElevation
          onClick={() => {
            step.exchange.close();
            finish();
          }}
          sx={pill}
        >
          {labels.trustDone}
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <Message>{step.role === 'maker' ? labels.trustCodeEndedMaker : labels.trustCodeEnded}</Message>
        <Button
          variant="contained"
          disableElevation
          onClick={() => {
            setError(null);
            setStep({ id: 'start' });
          }}
          sx={pill}
        >
          {labels.trustMakeCode}
        </Button>
      </>
    );
  }

  const heading = React.useRef<HTMLElement>(null);
  const rootRef = React.useRef<HTMLElement>(null);
  const stepSeen = React.useRef(step.id);
  React.useEffect(() => {
    if (stepSeen.current === step.id) return;
    stepSeen.current = step.id;
    // A step with a field of its own takes focus there; one without would leave it on the page's body, where the button just pressed was.
    const focused = document.activeElement;
    if (!['code', 'waiting', 'result', 'ended'].includes(step.id) || (focused !== null && focused !== document.body && !rootRef.current?.contains(focused))) return;
    heading.current?.focus({ preventScroll: true });
  }, [step.id]);
  return (
    <Box ref={rootRef} role="group" aria-labelledby={titleId} data-phonux-trust="" sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, color: 'text.primary' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box component="h2" id={titleId} ref={heading} tabIndex={-1} sx={{ m: 0, fontSize: '1.25rem', fontWeight: 700, outline: 'none' }}>
          {title}
        </Box>
        {onClose === undefined ? null : (
          <IconButton aria-label={labels.trustClose} onClick={onClose} size="small">
            <CloseIcon sx={{ fontSize: 18 }} aria-hidden="true" />
          </IconButton>
        )}
      </Box>
      {body}
    </Box>
  );
}
