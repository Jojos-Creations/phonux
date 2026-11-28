import * as React from 'react';
import qrcode from 'qrcode-generator';

const QUIET_MODULES = 4;
/** What the largest code (version 40) holds at level M in byte mode. */
const MAX_BYTES = 2331;
/** The width of the smallest code, which an empty tile keeps so a layout does not change with the text. */
const SMALLEST_MODULES = 21;

/** What `QrCode` takes. @public */
export interface QrCodeProps {
  /**
   * The text the code holds, as its UTF-8 bytes, so a scanner reads back the same text for any language or emoji. At
   * most 2331 bytes fit (one ASCII character is one byte, one Japanese character three). A longer value is not
   * drawn and does not throw: the tile has no modules and carries `data-phonux-qr-error="too-long"`.
   */
  value: string;
  /** The code's accessible name. */
  label: string;
  /** Width and height in CSS pixels. Defaults to 160. */
  size?: number;
}

/** The dark modules of `value`'s code as one SVG path in module units, and the code's width with its quiet zone; `error` is set, with no modules, when `value` is too long. */
function qrPath(value: string): { d: string; span: number; error: 'too-long' | null } {
  // The generator keeps the low byte of each character it is given, so each UTF-8 byte goes in as one character.
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > MAX_BYTES) return { d: '', span: SMALLEST_MODULES + 2 * QUIET_MODULES, error: 'too-long' };
  // Type 0 lets the generator pick the smallest square that holds the text at level M.
  const code = qrcode(0, 'M');
  code.addData(String.fromCharCode(...bytes));
  code.make();
  const count = code.getModuleCount();
  let d = '';
  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) if (code.isDark(y, x)) d += `M${x + QUIET_MODULES} ${y + QUIET_MODULES}h1v1h-1z`;
  }
  return { d, span: count + 2 * QUIET_MODULES, error: null };
}

/**
 * A QR code of `value`, black on white in any theme, with a four-module quiet zone, drawn as one `svg` with `role="img"`.
 * @public
 */
export function QrCode({ value, label, size = 160 }: QrCodeProps): React.ReactElement {
  const { d, span, error } = React.useMemo(() => qrPath(value), [value]);
  return (
    <svg role="img" aria-label={label} data-phonux-qr="" data-phonux-qr-error={error ?? undefined} width={size} height={size} viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8, display: 'block' }}>
      <path d={d} fill="#000" />
    </svg>
  );
}
