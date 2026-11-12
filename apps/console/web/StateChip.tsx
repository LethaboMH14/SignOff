import { type DisplayState } from '../src/model/desk.js';

/**
 * The symbol for each display state. It is decoration only: the words carry the meaning, and the symbol is hidden from
 * assistive technology. Colour is never the only signal.
 */
export function symbolOf(state: DisplayState): string {
  switch (state) {
    case 'Paid':
      return '✓';
    case 'In progress':
      return '…';
    case 'Held':
    case 'Needs a person':
    case 'Quarantined':
      return '!';
    case 'Refused':
    case 'Failed':
      return '✕';
    case 'Not paid':
      return '–';
    case 'Not confirmed':
      return '?';
    case 'Received':
      return '•';
  }
}

export function slugOf(state: DisplayState): string {
  return state.toLowerCase().replace(/\s+/g, '-');
}

export function StateChip({ state }: { readonly state: DisplayState }) {
  return (
    <span className={`chip chip-${slugOf(state)}`}>
      <span aria-hidden="true" className={state === 'Paid' ? 'tick' : undefined}>
        {symbolOf(state)}
      </span>{' '}
      {state}
    </span>
  );
}
