import * as React from 'react';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import { resolveLabels, type PhonuxLabels } from './labels.js';
import { PHONE_MODELS, vendorLabelForUsbVendorId } from './phoneModels.js';

/** The props of `PhoneDetectPrompt`. @public */
export interface PhoneDetectPromptProps {
  /** Non-null exactly once, right after the host first sees a phone-like USB device it has not asked about. */
  detected: {
    /** The USB vendor id of the detected device. */
    vendorId: number;
    /** The USB product id of the detected device. */
    productId: number;
  } | null;
  /** Called with the `id` of the picked `PhoneModel` when the person presses Resize. */
  onResize: (modelId: string) => void;
  /** Called when the person dismisses the prompt. */
  onDismiss: () => void;
  /** Overrides of the prompt's text and accessible names (see `PhonuxLabels`); a key left out keeps its English default. */
  labels?: Partial<PhonuxLabels>;
}

/**
 * The one-time "phone connected" notice: a non-blocking toast card, not a modal, with the model picker inline
 * (the PHONE_MODELS list Settings uses; one click resizes). It renders only the card, un-positioned: the host
 * places it. No Portal, because a static render (renderToStaticMarkup) has no `document` for one to target.
 * @public
 */
export function PhoneDetectPrompt({ detected, onResize, onDismiss, labels: given }: PhoneDetectPromptProps) {
  const labels = resolveLabels(given);
  const [modelId, setModelId] = useState(PHONE_MODELS[0]?.id ?? 'default');
  if (!detected) return null;
  return (
    <Box
      data-phone-detect-prompt=""
      role="status"
      aria-label={labels.phoneConnected}
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
          {labels.phoneConnectedText(vendorLabelForUsbVendorId(detected.vendorId))}
        </Typography>
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Box
            component="select"
            data-phone-detect-select=""
            aria-label={labels.phoneModel}
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
          {labels.resize}
        </Button>
        <IconButton size="small" aria-label={labels.dismiss} onClick={onDismiss} sx={{ flexShrink: 0, ml: -0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
    </Box>
  );
}
