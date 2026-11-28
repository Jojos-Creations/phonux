import type { PhonuxLabels } from './labels.js';

/** The words of the two move items, until `PhonuxLabels` has keys for them; a host that passes `moveLeft` or `moveRight` anyway is heard. */
export function grabMenuLabels(labels: PhonuxLabels): { moveLeft: string; moveRight: string } {
  const extra = labels as unknown as { moveLeft?: unknown; moveRight?: unknown };
  return {
    moveLeft: typeof extra.moveLeft === 'string' ? extra.moveLeft : 'Move left',
    moveRight: typeof extra.moveRight === 'string' ? extra.moveRight : 'Move right',
  };
}
