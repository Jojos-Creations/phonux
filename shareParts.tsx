import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import { createSvgIcon } from '@mui/material/utils';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels, type PhonuxLabels } from './labels.js';

export const MIN_TOUCH_PX = 44;

export const CheckIcon = createSvgIcon(<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />, 'Check');
export const AddIcon = createSvgIcon(<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />, 'Add');
export const BackIcon = createSvgIcon(<path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />, 'ChevronLeft');
export const FileIcon = createSvgIcon(<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zM6 20V4h7v5h5v11z" />, 'InsertDriveFileOutlined');
export const LinkIcon = createSvgIcon(<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1M8 13h8v-2H8zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5" />, 'Link');
export const EndedIcon = createSvgIcon(<path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8" />, 'ErrorOutline');
export const SpaceIcon = createSvgIcon(<path d="M3 3v8h8V3zm6 6H5V5h4zm-6 4v8h8v-8zm6 6H5v-4h4zm4-16v8h8V3zm6 6h-4V5h4zm-6 4v8h8v-8zm6 6h-4v-4h4z" />, 'GridView');
export const PlaylistIcon = createSvgIcon(<path d="M15 6H3v2h12zm0 4H3v2h12zM3 16h8v-2H3zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6z" />, 'QueueMusic');
export const TrackIcon = createSvgIcon(<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3z" />, 'MusicNote');
export const PageIcon = createSvgIcon(<path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2m0 14H5V8h14z" />, 'WebAsset');
export const MoreIcon = createSvgIcon(<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2" />, 'MoreHoriz');

/** What kind of thing is shared. The five named kinds have their own glyph and wording; any other string is a kind the host names itself. @public */
export type ShareKind = 'space' | 'playlist' | 'track' | 'page' | 'file' | (string & {});

/**
 * The thing a `ShareSheet` or `OfferCard` is about, drawn as a header row: a glyph tile, the name and a short line.
 * @public
 */
export interface ShareItem {
  /** What it is. Picks the glyph, the words (`space`, `playlist`) and whether others can edit it. */
  kind: ShareKind;
  /** The item's name; drawn as text only. */
  name: string;
  /** The short line under the name, such as `Space, 3 tabs`. The app writes it, so every language stays the app's. */
  subtitle?: string;
  /** A glyph that replaces the one the kind gets. */
  icon?: React.ReactNode;
  /** Whether others can be given the right to edit it. Defaults to true for `space` and `playlist`, false for every other kind. */
  editable?: boolean;
}

/** Whether the item's People tab offers Can edit and Can view; the kind decides unless the item says. */
export function isEditable(item: ShareItem): boolean {
  return item.editable ?? (item.kind === 'space' || item.kind === 'playlist');
}

/** The glyph of an item kind. */
export function KindIcon({ kind }: { kind: ShareKind }): React.ReactElement {
  switch (kind) {
    case 'space':
      return <SpaceIcon />;
    case 'playlist':
      return <PlaylistIcon />;
    case 'track':
      return <TrackIcon />;
    case 'page':
      return <PageIcon />;
    default:
      return <FileIcon />;
  }
}

/** The item's header row: glyph tile, name and subtitle. */
export function ItemHeader({ item, size = 40 }: { item: ShareItem; size?: number }): React.ReactElement {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <GlyphTile size={size}>{item.icon ?? <KindIcon kind={item.kind} />}</GlyphTile>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.name}</Typography>
        {item.subtitle === undefined ? null : (
          <Typography variant="body2" color="text.secondary">
            {item.subtitle}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/** The kind's name with a capital, for a subtitle such as `File, 48 MB`. */
export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The host's labels with `own` layered over them, so one component can speak differently from the rest of the app. */
export function useShareLabels(own: Partial<PhonuxLabels> | undefined): PhonuxLabels {
  const host = useOptionalHost()?.labels;
  return resolveLabels(own === undefined ? host : { ...host, ...own });
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A byte count as the mockups write it, decimal units and at most one decimal: 48 MB, 1.5 GB. */
export function formatFileSize(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  return `${text} ${UNITS[unit]}`;
}

/** Whole days from `now` to `at`, rounded up so a link with a few hours left still says one day, and never below one. */
export function daysUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 86_400_000));
}

const TONES = ['primary', 'secondary', 'success', 'info', 'warning'] as const;

function toneOf(name: string): (typeof TONES)[number] {
  let sum = 0;
  for (const ch of name) sum += ch.codePointAt(0) ?? 0;
  return TONES[sum % TONES.length] as (typeof TONES)[number];
}

/** A round avatar with the first letter of the name, tinted from the theme by the name so one person keeps one color. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }): React.ReactElement {
  const tone = toneOf(name);
  return (
    <Box
      aria-hidden="true"
      sx={(t: Theme) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: size > 44 ? '1.125rem' : '1rem',
        bgcolor: alpha(t.palette[tone].main, 0.16),
        color: t.palette[tone].dark,
      })}
    >
      {[...name][0]?.toUpperCase() ?? ''}
    </Box>
  );
}

/** A rounded tile holding a file or link glyph in the theme's primary tint. */
export function GlyphTile({ children, tone = 'primary', size = 40 }: { children: React.ReactNode; tone?: 'primary' | 'error'; size?: number }): React.ReactElement {
  return (
    <Box
      aria-hidden="true"
      sx={(t: Theme) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: alpha(t.palette[tone].main, 0.12),
        color: t.palette[tone].main,
      })}
    >
      {children}
    </Box>
  );
}

/** A segmented tab row; the selected tab is the only one in the tab order, and ArrowLeft and ArrowRight move between tabs. */
export function SegmentedTabs<T extends string>({ name, tabs, value, onChange, idPrefix }: { name: string; tabs: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void; idPrefix: string }): React.ReactElement {
  const refs = React.useRef(new Map<T, HTMLButtonElement>());
  const move = (from: number, step: number): void => {
    const next = tabs[(from + step + tabs.length) % tabs.length];
    if (next === undefined) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <Box
      role="tablist"
      aria-label={name}
      sx={(t: Theme) => ({ display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, gap: 0.5, p: 0.5, borderRadius: 3, bgcolor: t.palette.action.hover })}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <Box
            key={tab.id}
            component="button"
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            ref={(el: HTMLButtonElement | null) => {
              if (el === null) refs.current.delete(tab.id);
              else refs.current.set(tab.id, el);
            }}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(i, -1);
              } else if (e.key === 'Home') {
                e.preventDefault();
                move(0, 0);
              } else if (e.key === 'End') {
                e.preventDefault();
                move(tabs.length - 1, 0);
              }
            }}
            sx={(t: Theme) => ({
              minHeight: MIN_TOUCH_PX,
              border: 0,
              borderRadius: 2,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '0.875rem',
              fontWeight: selected ? 600 : 500,
              color: selected ? t.palette.text.primary : t.palette.text.secondary,
              bgcolor: selected ? t.palette.background.paper : 'transparent',
              boxShadow: selected ? 1 : 'none',
            })}
          >
            {tab.label}
          </Box>
        );
      })}
    </Box>
  );
}

/** Controlled when `value` is given, else holds its own state starting at `initial`. */
export function useTabState<T extends string>(value: T | undefined, initial: T, onChange: ((id: T) => void) | undefined): [T, (id: T) => void] {
  const [own, setOwn] = React.useState<T>(initial);
  const current = value ?? own;
  return [
    current,
    (id) => {
      if (value === undefined) setOwn(id);
      onChange?.(id);
    },
  ];
}
