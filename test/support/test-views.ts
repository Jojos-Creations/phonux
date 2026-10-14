/**
 * Views for the row tests, kept apart from any workspace: `registerTestView` remembers a component under a key, and a
 * workspace built by `seededWorkspace` gets a template for each remembered key its entries name. Test files run one per process.
 */
import * as React from 'react';
import { definePanel } from '../../index.js';
import type { PanelSummary, PanelTemplate } from '../../index.js';
import { useFrameClaim } from '../../panelFrameClaim.js';

type View = React.ComponentType<{ panel: PanelSummary }>;

const views = new Map<string, View>();

/** Remembers `Component` as the view of panels whose `view` is `key`. */
export function registerTestView(key: string, Component: View): void {
  views.set(key, Component);
}

/** Draws `View` and claims the frame, so the library's default frame never goes around it. */
function Bare({ View, panel }: { View: View; panel: PanelSummary }): React.ReactElement {
  useFrameClaim('panel');
  return React.createElement(View, { panel });
}

/** A template for `key` and `id`: the remembered view, else `fallback`, drawn bare as a registered view was. */
export function testViewTemplate(key: string, id: string, fallback: View): PanelTemplate {
  const View = views.get(key) ?? fallback;
  return definePanel({ id, view: ({ panel }) => React.createElement(Bare, { View, panel }), settings: { frame: 'none', multiple: true } });
}
