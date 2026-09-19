/**
 * phone-size-auto-detection: PhoneFrame's size, promoted from PhoneFrame.tsx's
 * own former static PHONE_WIDTH/PHONE_HEIGHT exports to a small module-level
 * store, persisted via electron/main.ts (phone:get-size/phone:set-size, same
 * userData-file pattern as token-byok's byokKeyPath). A plain subscribe/
 * notify store rather than React context: PhoneFrame.tsx and
 * GoalFrontPage.tsx both need the current size and are not otherwise wrapped
 * in a shared provider tree, and this needs to stay SSR-safe under
 * test/goal-front-page.test.ts's renderToStaticMarkup (no live `document`) --
 * useState's initializer runs synchronously with no window/document
 * dependency, and the useEffect subscription simply never fires during SSR,
 * matching every other bridge-backed effect in this codebase.
 */

import * as React from 'react';
import { bridge } from '../ipc/bridge.js';
import { findPhoneModel } from './phoneModels.js';

export interface PhoneSize {
  /** 'default' means "this app's own built-in default", not a PHONE_MODELS entry. */
  modelId: string;
  width: number;
  height: number;
}

/** Unchanged from the pre-existing PhoneFrame.tsx PHONE_WIDTH/PHONE_HEIGHT constants -- upgrading this app must never silently resize anyone who has neither answered the USB popup nor opened Settings. */
export const DEFAULT_PHONE_SIZE: PhoneSize = { modelId: 'default', width: 390, height: 700 };

let current: PhoneSize = DEFAULT_PHONE_SIZE;
const listeners = new Set<() => void>();

export function getPhoneSize(): PhoneSize {
  return current;
}

export function setPhoneSize(size: PhoneSize): void {
  current = size;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePhoneSize(): PhoneSize {
  const [size, setSize] = React.useState(current);
  React.useEffect(() => subscribe(() => setSize(current)), []);
  return size;
}

/** Loads whatever's persisted in the main process, if anything, and applies it. Call once on app mount (GoalFrontPage). A no-op in a non-desktop preview build with no bridge -- same tolerance as every other bridge-only feature here. */
export async function loadPersistedPhoneSize(): Promise<void> {
  try {
    const persisted = await bridge().phone.getSize();
    if (persisted) setPhoneSize(persisted);
  } catch {
    // No desktop bridge -- keep DEFAULT_PHONE_SIZE.
  }
}

/** Applies and persists a chosen model id ('default' resets to the app's built-in default). */
export async function choosePhoneModel(modelId: string): Promise<void> {
  const model = modelId === 'default' ? null : findPhoneModel(modelId);
  const size: PhoneSize = model ? { modelId: model.id, width: model.width, height: model.height } : DEFAULT_PHONE_SIZE;
  setPhoneSize(size);
  try {
    await bridge().phone.setSize(size.modelId, size.width, size.height);
  } catch {
    // No desktop bridge -- in-memory only for this session.
  }
}
