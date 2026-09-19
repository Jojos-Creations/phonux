import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { bridge } from '../ipc/bridge.js';
import { choosePhoneModel } from './phoneSize.js';

/**
 * phone-size-auto-detection: owns the USB phone-detect popup's own state and
 * wiring -- extracted out of GoalFrontPage.tsx verbatim (2026-09-15 thinning
 * pass), comments included. `rowRef` is GoalFrontPage's own phone-row ref
 * (shared with its ResizeObserver overflow check elsewhere in that file), so
 * it's threaded in rather than owned here.
 */
export function usePhoneUsbDetection(rowRef: RefObject<HTMLDivElement | null>) {
  // phone-size-auto-detection: non-null exactly while the one-time USB-connect
  // popup should show for a just-detected, not-yet-asked-about phone.
  const [usbDetectedPhone, setUsbDetectedPhone] = useState<{ vendorId: number; productId: number } | null>(null);
  // Vertically centers the toast in the empty space ABOVE the phone row
  // (owner feedback, 2026-09-13: "center it in the top space instead of
  // attaching it" -- it was previously pinned just above the row's own top
  // edge). rowRef's offsetTop, relative to the nearest positioned ancestor
  // (the data-goal-front-page container below, position:'relative' for
  // exactly this), equals the height of that empty top gap, since the row
  // itself is centered via margin:auto -- so half of it is the gap's own
  // midpoint. Recomputed on resize while the toast is showing; a static
  // computation would go stale if the window is resized mid-toast.
  const [phoneDetectTop, setPhoneDetectTop] = useState(0);
  useLayoutEffect(() => {
    if (!usbDetectedPhone) return;
    const update = () => setPhoneDetectTop((rowRef.current?.offsetTop ?? 0) / 2);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [usbDetectedPhone]);

  useEffect(() => {
    let unsubUsbDetected: (() => void) | undefined;
    try {
      unsubUsbDetected = bridge().phone.onUsbPhoneDetected((info) => setUsbDetectedPhone(info));
      // A phone already connected before this window finished loading fires
      // the main process's push before this listener above existed to catch
      // it -- Electron doesn't queue/replay it. This pull catches exactly
      // that case (measured live, 2026-09-13: without it, a phone already
      // plugged in at launch never showed the popup at all).
      bridge()
        .phone.getPendingUsbDetection()
        .then((pending) => {
          if (pending) setUsbDetectedPhone(pending);
        })
        .catch(() => {});
    } catch {
      // No desktop bridge (a browser-only preview build) -- USB detection
      // simply never surfaces anything, same as every other bridge-only
      // feature.
    }
    return () => {
      unsubUsbDetected?.();
    };
  }, []);

  return {
    usbDetectedPhone,
    phoneDetectTop,
    dismissPhoneDetect: () => setUsbDetectedPhone(null),
    resizeForDetectedPhone: (modelId: string) => {
      void choosePhoneModel(modelId);
      setUsbDetectedPhone(null);
    },
  };
}
