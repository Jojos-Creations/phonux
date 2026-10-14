/**
 * The panel API level 1 members the fixture panel relies on, copied by hand, not generated. Before 1.0.0 it is edited with level 1. The fixture's view is
 * assigned to a real template, so TypeScript accepts it only while the real props still provide every member written here.
 */
import type * as React from 'react';

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface LevelOnePanel {
  readonly id: string;
  readonly title?: string;
  readonly live: boolean;
  readonly params?: Json;
}

export interface LevelOneHandle {
  readonly id: string;
  readonly templateId: string;
  getState(): { readonly id: string; readonly status: string; readonly templateId: string };
  subscribe(l: () => void): () => void;
  move(by: number, source?: 'code' | 'person'): { readonly ok: boolean };
}

export interface LevelOneReader {
  list(): readonly { readonly id: string }[];
  getSnapshot(): { readonly panels: readonly { readonly id: string }[] };
}

export type LevelOneProps = { panel: LevelOnePanel; handle: LevelOneHandle; manager: LevelOneReader };

export type LevelOneView = React.ComponentType<LevelOneProps>;
