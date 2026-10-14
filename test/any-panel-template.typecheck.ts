/** `npm run typecheck` compiles this: a template made for typed params fits a workspace with no cast, and `addPanel` still checks its params. */
import * as React from 'react';
import { createWorkspace, definePanel } from '../index.js';
import type { AnyPanelTemplate } from '../index.js';

type AlbumParams = { readonly album: string };
const album = definePanel<AlbumParams>({ id: 'album', view: () => React.createElement('i') });
const note = definePanel({ id: 'note', view: () => React.createElement('i') });

const ws = createWorkspace({ templates: [album, note], root: album, mount: false });
ws.registerTemplate(album);
const any: AnyPanelTemplate = album;
ws.addPanel(album, { params: { album: 'a' } });
// @ts-expect-error params are still checked against the template they are passed with
ws.addPanel(album, { params: { album: 1 } });
void any;
