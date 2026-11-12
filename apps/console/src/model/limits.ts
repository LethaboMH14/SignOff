/**
 * What a limit change does, decided from the current and the requested value. A lower limit applies at once; a higher
 * one waits for a second operator to approve it. The words are shown beside the field, never a colour alone.
 */

export type LimitChange = 'unchanged' | 'lower' | 'raise';

/** The change a requested limit makes against the current one. Equal values are unchanged. */
export function limitChangeOf(currentMinor: number, requestedMinor: number): LimitChange {
  if (requestedMinor === currentMinor) {
    return 'unchanged';
  }
  return requestedMinor < currentMinor ? 'lower' : 'raise';
}

/** The symbol for a change. It is decoration: the words from {@link limitEffectOf} always appear with it. */
export function limitSymbolOf(change: LimitChange): string {
  switch (change) {
    case 'unchanged':
      return '–';
    case 'lower':
      return '↓';
    case 'raise':
      return '↑';
  }
}

/** The effect of a change in plain words, for the operator who is about to make it. */
export function limitEffectOf(change: LimitChange | null): string {
  switch (change) {
    case null:
      return 'Enter an amount, such as 5000.00.';
    case 'unchanged':
      return 'No change to this limit.';
    case 'lower':
      return 'Lower: applies at once.';
    case 'raise':
      return 'Raise: a second operator must approve it before it applies.';
  }
}
