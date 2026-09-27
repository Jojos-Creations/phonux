import * as React from 'react';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import { PHONE_MODELS, vendorLabelForUsbVendorId } from './phoneModels.js';

/** @public */
export interface PhoneDetectPromptProps {
  /** Non-null exactly once, right after electron/main.ts's wirePhoneUsbDetection first sees a not-yet-asked-about phone-like USB device. */
  detected: { vendorId: number; productId: number } | null;
  onResize: (modelId: string) => void;
  onDismiss: () => void;
}

/**
 * phone-size-auto-detection: the one-time notice for mechanism 1 (USB
 * connect). Owner direction, 2026-09-13: a non-blocking TOAST centered in
 * the empty space above the phone row, not a dimmed full-screen popup (the
 * earlier same-day direction that produced this component's original modal
 * shape) -- the picker itself stays inline (same PHONE_MODELS list Settings
 * uses, one click to resize), only the blocking backdrop goes away.
 *
 * Renders just the card itself, un-positioned -- GoalFrontPage's own render
 * wraps it in a `position: absolute` Box, vertically centered in the gap
 * above the phone row (measured live via the row's own `offsetTop`, not a
 * fixed offset -- owner feedback, 2026-09-13: "center it in the top space
 * instead of attaching it" to the row's own edge). No Portal needed (this
 * file's test harness renders via renderToStaticMarkup with no live
 * `document`, which a Portal can't target).
 *
 * phone-detect-toast-visual-polish, 2026-09-14: owner flagged the toast as
 * still merely "fine for now" after the iteration above. This pass replaces
 * the one-off raw-pixel `sx` values (fontSize:13, gap:1.25, px:1.75, py:1.25)
 * with this app's own typography variant (theme.ts's `caption`) and the same
 * round 8px-grid gap/padding ReloadGateNotice below already uses, so the two
 * toasts read as one design family instead of two independently-tuned ones.
 * `borderRadius: 2.5` is unchanged -- it already equals ReloadGateNotice's
 * hardcoded 15px at this theme's 6px shape unit (2.5 * 6), so the two toasts
 * already shared a corner radius even before this pass.
 * @public
 */
export function PhoneDetectPrompt({ detected, onResize, onDismiss }: PhoneDetectPromptProps) {
  const [modelId, setModelId] = useState(PHONE_MODELS[0]?.id ?? 'default');
  if (!detected) return null;
  return (
    <Box
      data-phone-detect-prompt=""
      role="status"
      aria-label="Phone connected"
      sx={{
        width: 'max-content',
        maxWidth: '90vw',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        boxSizing: 'border-box',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2.5,
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
        px: 1.5,
        py: 1,
      }}
    >
        <SmartphoneIcon fontSize="small" sx={{ color: 'primary.main', flexShrink: 0 }} />
        <Typography variant="caption" component="span" color="text.secondary" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {`${vendorLabelForUsbVendorId(detected.vendorId)} connected`}
        </Typography>
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Box
            component="select"
            data-phone-detect-select=""
            aria-label="Phone model"
            value={modelId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setModelId(e.target.value)}
            sx={(theme) => ({
              width: 240,
              boxSizing: 'border-box',
              font: 'inherit',
              fontSize: theme.typography.caption.fontSize,
              py: 0.75,
              pl: 1,
              pr: 3.5,
              borderRadius: 1.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.default',
              color: 'inherit',
              appearance: 'none',
              WebkitAppearance: 'none',
              cursor: 'pointer',
            })}
          >
            {PHONE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Box>
          <ExpandMoreIcon
            fontSize="small"
            sx={{ position: 'absolute', right: 6, color: 'text.disabled', pointerEvents: 'none' }}
          />
        </Box>
        <Button size="small" variant="contained" disableElevation onClick={() => onResize(modelId)} sx={{ flexShrink: 0 }}>
          Resize
        </Button>
        <IconButton size="small" aria-label="Dismiss" onClick={onDismiss} sx={{ flexShrink: 0, ml: -0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
    </Box>
  );
}
