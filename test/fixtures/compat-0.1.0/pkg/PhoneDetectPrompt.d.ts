import * as React from 'react';
/** @public */
export interface PhoneDetectPromptProps {
    /** Non-null exactly once, right after the host first sees a phone-like USB device it has not asked about. */
    detected: {
        vendorId: number;
        productId: number;
    } | null;
    onResize: (modelId: string) => void;
    onDismiss: () => void;
}
/**
 * The one-time "phone connected" notice: a non-blocking toast card, not a modal, with the model picker inline
 * (the PHONE_MODELS list Settings uses; one click resizes). It renders only the card, un-positioned: the host
 * places it. No Portal, because a static render (renderToStaticMarkup) has no `document` for one to target.
 * @public
 */
export declare function PhoneDetectPrompt({ detected, onResize, onDismiss }: PhoneDetectPromptProps): React.JSX.Element | null;
