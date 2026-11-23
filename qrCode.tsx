import * as React from 'react';
import qrcode from 'qrcode-generator';

const QUIET_MODULES = 4;

/** What `QrCode` takes. @public */
export interface QrCodeProps {
  /** The exact text the code holds. */
  value: string;
  /** The code's accessible name. */
  label: string;
  /** Width and height in CSS pixels. Defaults to 160. */
  size?: number;
}

/** The dark modules of `value`'s code as one SVG path in module units, and the code's width with its quiet zone. */
function qrPath(value: string): { d: string; span: number } {
  // Type 0 lets the generator pick the smallest square that holds the text at level M.
  const code = qrcode(0, 'M');
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  let d = '';
  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) if (code.isDark(y, x)) d += `M${x + QUIET_MODULES} ${y + QUIET_MODULES}h1v1h-1z`;
  }
  return { d, span: count + 2 * QUIET_MODULES };
}

/**
 * A QR code of `value`, black on white in any theme, with a four-module quiet zone, drawn as one `svg` with `role="img"`.
 * @public
 */
export function QrCode({ value, label, size = 160 }: QrCodeProps): React.ReactElement {
  const { d, span } = React.useMemo(() => qrPath(value), [value]);
  return (
    <svg role="img" aria-label={label} data-phonux-qr="" width={size} height={size} viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8, display: 'block' }}>
      <path d={d} fill="#000" />
    </svg>
  );
}
