/** createFakePanel needs no cast anywhere: its props satisfy a view over PanelViewProps, and a wrong state field is refused. */
import type { PanelViewProps, PanelTemplate } from '../index.js';
import { createFakePanel } from '../fakeHost.js';

declare function View(props: PanelViewProps<{ n: number }>): null;

const fake = createFakePanel<{ n: number }>({ id: 'a', title: 'A', params: { n: 1 } });
View(fake.props);

const template: PanelTemplate<{ n: number }> = { id: 'a', view: View, footer: View };
void template;

// @ts-expect-error status is a PanelStatus, not any string
createFakePanel({ status: 'nowhere' });
// @ts-expect-error params must match the declared type
createFakePanel<{ n: number }>({ params: { n: 'one' } });
