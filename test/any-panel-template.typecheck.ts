/** `npm run typecheck` compiles this: a template made for typed params fits a workspace with no cast, and `addPanel` still checks its params. */
import * as React from 'react';
import { createWorkspace, createWorkspaceColumn, definePanel } from '../index.js';
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

// A second template with other params in the same list, the column and a registration.
type TrackParams = { readonly track: number };
const track = definePanel<TrackParams>({ id: 'track', view: () => React.createElement('i') });
const mixed = createWorkspace({ templates: [album, track, note], mount: false });
mixed.registerTemplate(track);
export const column = createWorkspaceColumn({ templates: [album, track], root: note, mount: false });
// @ts-expect-error each template keeps its own params: the track's are not the album's
mixed.addPanel(track, { params: { album: 'a' } });
void any;
